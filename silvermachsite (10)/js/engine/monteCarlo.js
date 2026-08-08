/* ============================================================================
 * SilverMach Engineering Analysis Suite — monteCarlo.js
 * ----------------------------------------------------------------------------
 * Stochastic race-outcome simulator.
 *
 * PHYSICAL MODEL
 * --------------
 * The chain, in order:
 *
 *   8 g CO2 canister
 *     → time-dependent thrust      F_thrust(t) = F₀ e^(−t/τ)      [thrust.js]
 *     → thrust direction           θ (default 0°, geometry-derived)
 *     → forward component          F_fwd(t) = F_thrust(t) cos θ
 *     → wheel-angle scrub drag     F_scrub = Σ μ_s N_i |sin δ_i|
 *     → aerodynamic drag           F_drag  = ½ ρ Cd A v²
 *     → net force                  ΣF = F_fwd(t) − F_scrub − F_drag
 *     → acceleration               a = ΣF / m
 *     → velocity, distance         numeric integration
 *     → race performance           finish time = travel + reaction
 *
 * WHY THE SOLVER CHANGED
 * ----------------------
 * The previous version used a closed-form solution (tanh / ln cosh). That
 * solution is only valid for CONSTANT thrust. Making thrust time-dependent —
 * which is physically required for a blowdown canister — removes the closed
 * form, because ∫ e^(−t/τ) against a quadratic drag term has no elementary
 * inverse. Numerical integration is therefore not a downgrade, it is what the
 * corrected physics demands.
 *
 * To keep 100,000 trials interactive the solver is split:
 *   • POWERED PHASE (0 → 5τ, short): RK4 with a precomputed thrust table.
 *   • COAST PHASE (thrust = 0): solved EXACTLY in closed form, including the
 *     constant scrub term, so the long tail costs O(1) instead of thousands of
 *     steps. The coast closed forms are unit-tested against RK4.
 *
 * WHEEL ANGLE — DEFINITION AND CONVENTION
 * ---------------------------------------
 *   Quantity:     static toe angle δ of each wheel.
 *   Reference:    the car's longitudinal axis (its direction of travel along
 *                 the guide line).
 *   Sign:         + = leading edge of the wheel points outboard (toe-out),
 *                 − = inboard (toe-in). Only |δ| affects the magnitude of the
 *                 scrub, so the sign is recorded but the drag is symmetric.
 *   Unit:         degrees.
 *   Distribution: δ_i ~ N(0, σ_δ), independent per wheel.
 *   Count:        FOUR independent variables (front-left, front-right,
 *                 rear-left, rear-right). Four is physically justified here
 *                 because each wheel is separately located and bonded — there
 *                 is no track rod, axle beam or steering linkage tying any pair
 *                 together, so no correlation between them is defensible.
 *                 A single shared σ_δ is used because all four come from the
 *                 same build process; only the realisations are independent.
 *   Effect:       a wheel running at angle δ to the direction of travel scrubs
 *                 laterally. The lateral velocity component is v sin δ, and the
 *                 opposing friction force projects back onto the travel axis:
 *                     F_scrub,i = μ_s · N_i · |sin δ_i|,   N_i = m g / 4
 *                 summed over the four wheels. This is a genuine retarding
 *                 force in the equation of motion, not a displayed statistic.
 *   Source:       ENGINEERING ASSUMPTION. The team has no measured alignment
 *                 data, so σ_δ = 0.5° is an estimate of achievable hand-build
 *                 tolerance, exposed in the UI so it can be corrected the
 *                 moment real measurements exist. NOT A MEASUREMENT.
 *   μ_s:          ENGINEERING ASSUMPTION, 0.30 — a representative scrubbing
 *                 (sliding) coefficient for a plastic wheel on the track
 *                 surface. NOT MEASURED.
 *
 * Attaches to `SM.MonteCarlo`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;
  var T = root.SM.Thrust;

  /** Physical constants. Documented and overridable — never silently assumed. */
  var PHYSICS = {
    airDensity: 1.225,      // kg/m³, dry air at 15 °C, sea level
    frontalArea: 0.0026,    // m², representative F1-in-Schools body cross-section
    gravity: 9.80665,       // m/s²
    scrubCoefficient: 0.30, // ASSUMPTION — wheel scrub friction coefficient
    integrationStep: 0.001  // s, RK4 step through the powered phase
  };

  var K_EPSILON = 1e-12;    // below this, treat aerodynamic drag as absent
  var R_EPSILON = 1e-12;    // below this, treat scrub force as absent

  /* ----------------------------------------------------------------- RNG */

  /**
   * Deterministic PRNG (mulberry32) for reproducible tests and verification.
   * @param {number} seed
   * @returns {function(): number} uniform in [0,1)
   */
  function createSeededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Normally distributed sample via the Box–Muller transform.
   *
   *     Z = √(−2 ln U₁) · cos(2π U₂),    U₁ ∈ (0,1], U₂ ∈ [0,1)
   *
   * U₁ is redrawn until strictly positive, because ln(0) = −∞ would propagate
   * −Infinity → NaN through the rest of the pipeline. This is stateless: no
   * cached second variate, so results depend only on the supplied RNG stream.
   */
  function normalRandom(mean, stdDev, rng) {
    var random = rng || Math.random;
    if (!(stdDev > 0)) return mean;
    var u1 = 0;
    do { u1 = random(); } while (!(u1 > 0));
    var u2 = random();
    var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stdDev * z;
  }

  /**
   * Truncated normal sample, constrained to [lo, hi] by rejection sampling.
   * Physical inputs (mass, drag, thrust, reaction time) cannot be negative, so
   * a raw normal draw must be rejected rather than clamped where possible —
   * clamping would pile probability mass onto the boundary and bias results.
   *
   * @returns {{value:number, rejections:number, clamped:boolean}}
   */
  function truncatedNormal(mean, stdDev, lo, hi, rng, maxAttempts) {
    var attempts = maxAttempts || 100;
    if (!(stdDev > 0)) {
      var fixed = U.clamp(mean, lo, hi);
      return { value: fixed, rejections: 0, clamped: fixed !== mean };
    }
    for (var i = 0; i < attempts; i++) {
      var v = normalRandom(mean, stdDev, rng);
      if (v >= lo && v <= hi) return { value: v, rejections: i, clamped: false };
    }
    return { value: U.clamp(mean, lo, hi), rejections: attempts, clamped: true };
  }

  /* ------------------------------------------------------- wheel scrub */

  /**
   * Retarding force from four independently misaligned wheels.
   *
   *     F_scrub = Σᵢ μ_s · (m g / 4) · |sin δᵢ|
   *
   * Velocity-independent (Coulomb friction), so it acts as a constant retard
   * in both the powered and coasting phases.
   *
   * @param {number[]} anglesDeg  four toe angles in degrees
   * @param {number} massKg
   * @param {number} mu
   * @param {number} g
   * @returns {number} newtons, ≥ 0
   */
  var WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

  /**
   * Build the structural wheel set from four toe angles.
   *
   * The four wheels are kept as named entities rather than four loose numbers
   * so the physical distinction between them survives through the model and
   * into the exported data.
   *
   * LOAD DISTRIBUTION (§29) — EQUAL STATIC LOADING, m·g/4 per wheel.
   * This is the assumption the existing model already relied on and it is
   * retained deliberately rather than replaced. The project holds no measured
   * centre-of-gravity position, no wheelbase dimension and no corner-weight
   * data, so any front/rear split would be invented. Equal loading is the
   * defensible default for a symmetric four-wheel car with no measured CG, and
   * it leaves the four TOE ANGLES fully independent, which is the physical
   * distinction that actually matters here. Documented, not hidden.
   *
   * @param {number[]|Object} toe  four angles in degrees, or a wheels object
   * @param {number} massKg
   * @param {number} g
   * @returns {Object} keyed by WHEEL_KEYS, each {toeDeg, loadN}
   */
  function buildWheels(toe, massKg, g) {
    var loadPerWheel = (massKg * g) / 4;   // equal static loading — see above
    var wheels = {};
    var isArray = Object.prototype.toString.call(toe) === '[object Array]';
    for (var i = 0; i < WHEEL_KEYS.length; i++) {
      var key = WHEEL_KEYS[i];
      var angle = isArray ? toe[i] : (toe[key] ? toe[key].toeDeg : 0);
      wheels[key] = { toeDeg: angle, loadN: loadPerWheel };
    }
    return wheels;
  }

  /**
   * Scrub resistance from ONE wheel.
   *
   *     F_scrub,i = μ_s · N_i · |sin δ_i|
   *
   * Each wheel's contribution is computed individually and only then summed
   * (§11 of the brief). Raw angles are never added together — summing angles
   * first would make four wheels at 1° indistinguishable from one wheel at 4°,
   * which is physically wrong because sin is non-linear.
   *
   * Degrees → radians happens exactly HERE and nowhere else in the wheel path.
   *
   * @returns {number} newtons, ≥ 0
   */
  function wheelScrub(wheel, mu) {
    return mu * wheel.loadN * Math.abs(Math.sin(wheel.toeDeg * Math.PI / 180));
  }

  /**
   * Total scrub retard: the sum of the four individually computed forces.
   * Velocity-independent (Coulomb friction), so it acts as a constant retard in
   * both the powered and coasting phases.
   *
   * Accepts either a wheels object or a plain [FL, FR, RL, RR] array so the
   * previously published signature keeps working (§17: preserve public APIs).
   *
   * @returns {number} newtons, ≥ 0
   */
  function scrubForce(toeOrWheels, massKg, mu, g) {
    var wheels = buildWheels(toeOrWheels, massKg, g);
    var total = 0;
    for (var i = 0; i < WHEEL_KEYS.length; i++) {
      total += wheelScrub(wheels[WHEEL_KEYS[i]], mu);   // per-wheel, then sum
    }
    return total;
  }

  /* ------------------------------------------------------- coast phase */

  /**
   * EXACT solution of the unpowered phase.
   *
   *     m dv/dt = −(R + k v²)
   *
   * Distance travelled while decelerating from v₀ to v:
   *     x = (m / 2k) · ln( (R + k v₀²) / (R + k v²) )
   * Maximum reachable distance (v → 0):
   *     x_max = (m / 2k) · ln(1 + k v₀² / R)
   * Time, from  v(t) = v_c tan(arctan(v₀/v_c) − ω t),
   *     v_c = √(R/k),  ω = √(Rk)/m
   *
   * All degenerate branches (R→0, k→0, both→0) are handled analytically rather
   * than by letting a division by zero produce NaN.
   *
   * @returns {{time:number, exitVelocity:number, finished:boolean}}
   */
  function coastPhase(massKg, k, R, v0, distance) {
    if (!(distance > 0)) return { time: 0, exitVelocity: v0, finished: true };
    if (!(v0 > 0)) return { time: Infinity, exitVelocity: 0, finished: false };

    var hasDrag = k > K_EPSILON;
    var hasScrub = R > R_EPSILON;

    /* ---- no resistance at all: constant velocity ---- */
    if (!hasDrag && !hasScrub) {
      return { time: distance / v0, exitVelocity: v0, finished: true };
    }

    /* ---- scrub only: uniform deceleration ---- */
    if (!hasDrag) {
      var a = R / massKg;
      var xMaxLinear = (v0 * v0) / (2 * a);
      if (distance >= xMaxLinear) {
        return { time: Infinity, exitVelocity: 0, finished: false };
      }
      // distance = v₀t − ½at²  ⟹  t = (v₀ − √(v₀² − 2 a d)) / a
      var disc = v0 * v0 - 2 * a * distance;
      var tLin = (v0 - Math.sqrt(Math.max(0, disc))) / a;
      return { time: tLin, exitVelocity: v0 - a * tLin, finished: true };
    }

    /* ---- drag only: the classic 1/(1+ct) solution ---- */
    if (!hasScrub) {
      var mOverK = massKg / k;
      var tDrag = (mOverK / v0) * (Math.exp((k * distance) / massKg) - 1);
      var vDrag = v0 * Math.exp(-(k * distance) / massKg);
      return { time: tDrag, exitVelocity: vDrag, finished: true };
    }

    /* ---- both: arctan solution, with stall detection ---- */
    var xMax = (massKg / (2 * k)) * Math.log(1 + (k * v0 * v0) / R);
    if (distance >= xMax) {
      // The car scrubs to a standstill before the line.
      return { time: Infinity, exitVelocity: 0, finished: false };
    }
    var vSq = ((R + k * v0 * v0) * Math.exp((-2 * k * distance) / massKg) - R) / k;
    var vExit = Math.sqrt(Math.max(0, vSq));
    var vChar = Math.sqrt(R / k);
    var omega = Math.sqrt(R * k) / massKg;
    var tArc = (Math.atan(v0 / vChar) - Math.atan(vExit / vChar)) / omega;
    return { time: tArc, exitVelocity: vExit, finished: true };
  }

  /* ------------------------------------------------------ full solution */

  /**
   * Solve one run.
   *
   * @param {number} massKg
   * @param {number} dragCoefficient   Cd, ≥ 0
   * @param {number} peakThrustN       F₀
   * @param {number} trackLengthM
   * @param {number} scrubN            constant retard from wheel misalignment
   * @param {Object} phys              PHYSICS-shaped object
   * @param {Object} thrustCfg         {tau, thrustAngle}
   * @param {Object} [table]           precomputed decay table (perf only)
   * @returns {{travelTime:number, maxVelocity:number, peakAcceleration:number,
   *            finished:boolean, distanceAtBurnout:number,
   *            velocityAtBurnout:number, finishedDuringThrust:boolean}}
   */
  function solveRun(massKg, dragCoefficient, peakThrustN, trackLengthM,
                    scrubN, phys, thrustCfg, table) {
    var m = massKg;
    var L = trackLengthM;
    var k = 0.5 * phys.airDensity * dragCoefficient * phys.frontalArea;
    var R = scrubN || 0;
    var tau = thrustCfg.tau;
    var cosTheta = Math.cos((thrustCfg.thrustAngle || 0) * Math.PI / 180);
    var F0 = peakThrustN * cosTheta;          // forward component at t = 0

    var peakAcceleration = (F0 - R) / m;      // t=0: v=0 so aerodynamic drag=0

    var dt = table ? table.dt : phys.integrationStep;
    var steps = table ? table.steps : Math.ceil(T.burnDuration(tau) / dt);
    var full = table ? table.full : null;
    var half = table ? table.half : null;

    var v = 0, x = 0, t = 0;
    var maxVelocity = 0;
    var finishedDuringThrust = false;
    var travelTime = 0;

    /* ---- powered phase: RK4 on (x, v) ---- */
    function accel(decay, vel) {
      var drag = k * vel * vel;
      return (F0 * decay - R - drag) / m;
    }

    /** One RK4 step of size h, sampling the decay at absolute times. */
    function rk4Step(tAbs, h, vIn, xIn) {
      var d0 = T.thrustAt(tAbs, 1, tau);
      var dM = T.thrustAt(tAbs + h * 0.5, 1, tau);
      var d1 = T.thrustAt(tAbs + h, 1, tau);
      var a1 = accel(d0, vIn), x1 = vIn;
      var a2 = accel(dM, vIn + 0.5 * h * a1), x2 = vIn + 0.5 * h * a1;
      var a3 = accel(dM, vIn + 0.5 * h * a2), x3 = vIn + 0.5 * h * a2;
      var a4 = accel(d1, vIn + h * a3), x4 = vIn + h * a3;
      return {
        v: vIn + (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4),
        x: xIn + (h / 6) * (x1 + 2 * x2 + 2 * x3 + x4)
      };
    }

    // Largest velocity change permitted inside a single RK4 step. Beyond this
    // the quadratic drag term is evaluated far from the true trajectory and the
    // scheme goes unstable.
    var MAX_DV_PER_STEP = 5;      // m/s
    var MAX_SUBSTEPS = 100000;    // hard iteration budget for one outer step

    for (var i = 0; i < steps; i++) {
      // Sample the decay at i*dt, not at an accumulated t: repeatedly adding dt
      // drifts the final sample a few ULPs past the 5τ burn boundary, where
      // thrustAt() returns 0 while the exactly-indexed table still returns
      // e^-5. Indexing both paths identically keeps them bit-for-bit equal.
      var tGrid = i * dt;
      var dFull = full ? full[i] : T.thrustAt(tGrid, 1, tau);
      var vNext, xNext;

      // ADAPTIVE SUBSTEPPING. A very light car has an enormous initial
      // acceleration (a = F/m), so one fixed 1 ms step would change v by more
      // than the physical velocity itself and RK4 would diverge to Infinity —
      // NaN race times that previously reached the statistics layer unnoticed.
      // Subdivision engages only when needed, so the common case is untouched.
      //
      // The step size is recomputed from the CURRENT state on every substep,
      // not once from the state at the top of the outer step. That distinction
      // is the whole fix: a 1e-6 g sample starts at a ≈ 2e10 m/s², and a step
      // count derived from that one number is both astronomically large and
      // still wrong a moment later, because quadratic drag pulls the car to
      // terminal velocity within microseconds and the acceleration collapses
      // by ten orders of magnitude. Recomputing h = Δv_max/|a| each time makes
      // the substeps tiny exactly while they need to be and lets them reopen to
      // the full outer step as soon as the trajectory flattens — a handful of
      // substeps in practice instead of millions.
      var aEst = Math.abs(accel(dFull, v));
      var subs = (aEst * dt > MAX_DV_PER_STEP) ? 2 : 1;

      if (subs === 1) {
        // Fast path: tabulated decay factors, no extra exp() calls.
        var dHalf = half ? half[i] : T.thrustAt(tGrid + dt * 0.5, 1, tau);
        var dNext = full ? full[i + 1] : T.thrustAt(tGrid + dt, 1, tau);
        var k1v = accel(dFull, v), k1x = v;
        var k2v = accel(dHalf, v + 0.5 * dt * k1v), k2x = v + 0.5 * dt * k1v;
        var k3v = accel(dHalf, v + 0.5 * dt * k2v), k3x = v + 0.5 * dt * k2v;
        var k4v = accel(dNext, v + dt * k3v), k4x = v + dt * k3v;
        vNext = v + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
        xNext = x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      } else {
        var sv = v, sx = x;
        var rem = dt;                 // outer-step time still to be covered
        var tLocal = tGrid;
        var minH = dt / MAX_SUBSTEPS; // floor: guarantees the loop terminates
        var q = 0;
        while (rem > 0 && q < MAX_SUBSTEPS) {
          var aNow = Math.abs(accel(T.thrustAt(tLocal, 1, tau), sv));
          var h = (aNow * rem > MAX_DV_PER_STEP) ? (MAX_DV_PER_STEP / aNow) : rem;
          if (!(h > 0) || !isFinite(h)) h = rem;   // aNow == 0 or non-finite
          if (h < minH) h = minH;
          if (h > rem) h = rem;

          var st = rk4Step(tLocal, h, sv, sx);
          if (!isFinite(st.v) || !isFinite(st.x)) { sv = st.v; sx = st.x; break; }
          sv = st.v; sx = st.x;
          if (sv < 0) sv = 0;
          if (sv > maxVelocity) maxVelocity = sv;
          tLocal += h; rem -= h; q++;
          if (sx >= L) break;
        }
        vNext = sv; xNext = sx;
      }

      if (vNext < 0) vNext = 0;   // scrub can stop the car; it cannot reverse it

      // DIVERGENCE GUARD. If integration has gone non-finite despite
      // substepping, report a numerical failure rather than letting
      // NaN/Infinity masquerade as a completed race (§26).
      if (!isFinite(vNext) || !isFinite(xNext)) {
        return {
          travelTime: NaN, maxVelocity: maxVelocity,
          peakAcceleration: peakAcceleration,
          finished: false, diverged: true, finishedDuringThrust: false,
          distanceAtBurnout: x, velocityAtBurnout: v
        };
      }

      if (xNext >= L) {
        var frac = (xNext > x) ? (L - x) / (xNext - x) : 0;
        travelTime = t + frac * dt;
        maxVelocity = Math.max(maxVelocity, v + frac * (vNext - v));
        return {
          travelTime: travelTime, maxVelocity: maxVelocity,
          peakAcceleration: peakAcceleration,
          finished: true, diverged: false, finishedDuringThrust: true,
          distanceAtBurnout: xNext, velocityAtBurnout: vNext
        };
      }

      v = vNext; x = xNext; t += dt;
      if (v > maxVelocity) maxVelocity = v;
    }

    /* ---- coast phase: exact ---- */
    var coast = coastPhase(m, k, R, v, L - x);
    if (!coast.finished) {
      // Physically the car never reaches the line. Reported honestly rather
      // than silently returning a fabricated time.
      return {
        travelTime: Infinity,
        maxVelocity: maxVelocity,
        peakAcceleration: peakAcceleration,
        finished: false,
        finishedDuringThrust: false,
        distanceAtBurnout: x,
        velocityAtBurnout: v
      };
    }

    return {
      travelTime: t + coast.time,
      maxVelocity: maxVelocity,
      peakAcceleration: peakAcceleration,
      finished: true,
      finishedDuringThrust: finishedDuringThrust,
      distanceAtBurnout: x,
      velocityAtBurnout: v
    };
  }

  /* --------------------------------------------------------- validation */

  /**
   * Validate and normalise a simulation configuration.
   * Throws descriptive RangeErrors — never returns partially-valid state.
   */
  function validateConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') {
      throw new TypeError('Simulation configuration object is required.');
    }
    function pick(path, fallback) {
      return cfg[path] !== undefined ? cfg[path] : fallback;
    }

    var out = {
      massMean: U.requireNumber(cfg.massMean, 'Vehicle mass mean (g)', { min: 0, exclusiveMin: true }),
      massStdDev: U.requireNumber(cfg.massStdDev, 'Vehicle mass standard deviation (g)', { min: 0 }),
      dragMean: U.requireNumber(cfg.dragMean, 'Drag coefficient mean', { min: 0 }),
      dragStdDev: U.requireNumber(cfg.dragStdDev, 'Drag coefficient standard deviation', { min: 0 }),
      forceMean: U.requireNumber(cfg.forceMean, 'Peak thrust mean (N)', { min: 0, exclusiveMin: true }),
      forceStdDev: U.requireNumber(cfg.forceStdDev, 'Peak thrust standard deviation (N)', { min: 0 }),
      reactionMean: U.requireNumber(cfg.reactionMean, 'Reaction time mean (s)', { min: 0 }),
      reactionStdDev: U.requireNumber(cfg.reactionStdDev, 'Reaction time standard deviation (s)', { min: 0 }),
      // FOUR INDEPENDENT TOE-ANGLE UNCERTAINTIES, one per corner.
      // Each wheel carries its own sigma so a build with, say, a well-set front
      // axle and a sloppier rear can be modelled honestly. wheelAngleStdDev is
      // retained ONLY as the per-corner default, so an existing caller that
      // passes the old single value still gets exactly its previous behaviour.
      wheelAngleStdDev: U.requireNumber(pick('wheelAngleStdDev', 0.5),
        'Wheel alignment standard deviation (°)', { min: 0, max: 30 }),
      wheelAngleStdDevFL: U.requireNumber(
        pick('wheelAngleStdDevFL', pick('wheelAngleStdDev', 0.5)),
        'Front-left toe standard deviation (°)', { min: 0, max: 30 }),
      wheelAngleStdDevFR: U.requireNumber(
        pick('wheelAngleStdDevFR', pick('wheelAngleStdDev', 0.5)),
        'Front-right toe standard deviation (°)', { min: 0, max: 30 }),
      wheelAngleStdDevRL: U.requireNumber(
        pick('wheelAngleStdDevRL', pick('wheelAngleStdDev', 0.5)),
        'Rear-left toe standard deviation (°)', { min: 0, max: 30 }),
      wheelAngleStdDevRR: U.requireNumber(
        pick('wheelAngleStdDevRR', pick('wheelAngleStdDev', 0.5)),
        'Rear-right toe standard deviation (°)', { min: 0, max: 30 }),
      // Coefficient of friction mu. The nominal value defaults to the existing
      // PHYSICS.scrubCoefficient so an unmodified run reproduces exactly what it
      // did before. Its uncertainty defaults to ZERO because the team has taken
      // no friction measurement: inventing a spread here would be fabricating
      // experimental data. The field is user-editable so a measured or assumed
      // spread can be entered deliberately.
      frictionMean: U.requireNumber(pick('frictionMean', PHYSICS.scrubCoefficient),
        'Coefficient of friction mu', { min: 0, max: 2 }),
      frictionStdDev: U.requireNumber(pick('frictionStdDev', 0),
        'Coefficient of friction standard deviation', { min: 0, max: 1 }),
      trackLength: U.requireNumber(cfg.trackLength, 'Track length (m)', { min: 0, exclusiveMin: true }),
      runs: U.requireNumber(cfg.runs, 'Number of simulations', { min: 1, max: 5000000, integer: true }),
      thrust: {
        tau: U.requireNumber(
          cfg.thrust && cfg.thrust.tau !== undefined ? cfg.thrust.tau : T.THRUST_DEFAULTS.tau,
          'Thrust decay time constant τ (s)', { min: 0, exclusiveMin: true, max: 5 }),
        thrustAngle: U.requireNumber(
          cfg.thrust && cfg.thrust.thrustAngle !== undefined
            ? cfg.thrust.thrustAngle : T.THRUST_DEFAULTS.thrustAngle,
          'Thrust misalignment angle (°)', { min: -89, max: 89 }),
        co2Mass: U.requireNumber(
          cfg.thrust && cfg.thrust.co2Mass !== undefined
            ? cfg.thrust.co2Mass : T.THRUST_DEFAULTS.co2Mass,
          'CO2 charge (g)', { min: 0, exclusiveMin: true }),
        exhaustVelocity: U.requireNumber(
          cfg.thrust && cfg.thrust.exhaustVelocity !== undefined
            ? cfg.thrust.exhaustVelocity : T.THRUST_DEFAULTS.exhaustVelocity,
          'Effective exhaust velocity (m/s)', { min: 0, exclusiveMin: true })
      },
      physics: {
        airDensity: U.requireNumber(
          cfg.physics && cfg.physics.airDensity !== undefined ? cfg.physics.airDensity : PHYSICS.airDensity,
          'Air density (kg/m³)', { min: 0, exclusiveMin: true }),
        frontalArea: U.requireNumber(
          cfg.physics && cfg.physics.frontalArea !== undefined ? cfg.physics.frontalArea : PHYSICS.frontalArea,
          'Frontal area (m²)', { min: 0, exclusiveMin: true }),
        gravity: PHYSICS.gravity,
        scrubCoefficient: U.requireNumber(
          cfg.physics && cfg.physics.scrubCoefficient !== undefined
            ? cfg.physics.scrubCoefficient : PHYSICS.scrubCoefficient,
          'Wheel scrub coefficient', { min: 0 }),
        integrationStep: PHYSICS.integrationStep
      },
      // Optional deterministic seed (§25). Absent by default, so ordinary use
      // stays genuinely random. Carried on the config so a reproduction case
      // can be described entirely by its configuration object; an explicitly
      // supplied rng argument still wins, keeping one authoritative source of
      // randomness per run rather than two competing ones.
      seed: cfg.seed === undefined || cfg.seed === null ? null
        : U.requireNumber(cfg.seed, 'Random seed', { integer: true })
    };
    return out;
  }

  /* --------------------------------------------------------- simulation */

  /**
   * Allocate the flat typed-array result store.
   * One Float64Array per metric — contiguous memory, no per-trial objects.
   */
  function allocateTrials(n) {
    return {
      count: n,
      simulationNumber: new Float64Array(n),
      mass: new Float64Array(n),          // grams
      drag: new Float64Array(n),          // Cd
      launchForce: new Float64Array(n),   // N, peak thrust F₀
      reactionTime: new Float64Array(n),  // s
      wheelFL: new Float64Array(n),       // deg, front-left toe
      wheelFR: new Float64Array(n),       // deg, front-right toe
      wheelRL: new Float64Array(n),       // deg, rear-left toe
      wheelRR: new Float64Array(n),       // deg, rear-right toe
      friction: new Float64Array(n),      // mu, sampled coefficient of friction
      scrubForce: new Float64Array(n),    // N, total wheel scrub retard
      acceleration: new Float64Array(n),  // m/s², peak (t=0)
      maxVelocity: new Float64Array(n),   // m/s
      travelTime: new Float64Array(n),    // s, excluding reaction
      finishTime: new Float64Array(n)     // s, including reaction
    };
  }

  /** Sample one trial and write it into the store at index i. */
  function runTrial(i, cfg, trials, rng, table, counters) {
    // Sample order: mass → drag → thrust → reaction → four wheel angles.
    var sMass = truncatedNormal(cfg.massMean, cfg.massStdDev, 1e-6, Infinity, rng);
    var sDrag = truncatedNormal(cfg.dragMean, cfg.dragStdDev, 0, Infinity, rng);
    var sForce = truncatedNormal(cfg.forceMean, cfg.forceStdDev, 1e-6, Infinity, rng);
    var sReact = truncatedNormal(cfg.reactionMean, cfg.reactionStdDev, 0, Infinity, rng);

    counters.rejections += sMass.rejections + sDrag.rejections +
                           sForce.rejections + sReact.rejections;
    if (sMass.clamped || sDrag.clamped || sForce.clamped || sReact.clamped) {
      counters.clamps++;
    }

    // Coefficient of friction. Sampled through the same truncated-normal path
    // as every other uncertain input, and only when a spread has actually been
    // supplied: with sigma = 0 the value is the nominal mu and no random number
    // is drawn, so the existing random stream — and therefore every existing
    // seeded result — is byte-for-byte unchanged by this addition.
    var muValue = cfg.frictionMean;
    if (cfg.frictionStdDev > 0) {
      var sMu = truncatedNormal(cfg.frictionMean, cfg.frictionStdDev, 0, Infinity, rng);
      muValue = sMu.value;
      counters.rejections += sMu.rejections;
      if (sMu.clamped) counters.clamps++;
    }

    // Four independent toe angles, unbounded sign (toe-in and toe-out alike).
    // Four separate draws from four separate distributions: nothing is sampled
    // once and copied, and no single deviation is distributed across the car.
    //   FL ~ N(0, sigma_FL)   FR ~ N(0, sigma_FR)
    //   RL ~ N(0, sigma_RL)   RR ~ N(0, sigma_RR)
    var fl = normalRandom(0, cfg.wheelAngleStdDevFL, rng);
    var fr = normalRandom(0, cfg.wheelAngleStdDevFR, rng);
    var rl = normalRandom(0, cfg.wheelAngleStdDevRL, rng);
    var rr = normalRandom(0, cfg.wheelAngleStdDevRR, rng);

    var massG = sMass.value;
    var massKg = massG / 1000;
    var scrub = scrubForce([fl, fr, rl, rr], massKg,
      muValue, cfg.physics.gravity);

    var solved = solveRun(massKg, sDrag.value, sForce.value, cfg.trackLength,
      scrub, cfg.physics, cfg.thrust, table);

    if (solved.finishedDuringThrust) counters.finishedUnderPower++;
    if (!solved.finished) counters.didNotFinish++;
    if (solved.diverged) counters.diverged++;

    trials.simulationNumber[i] = i + 1;
    trials.mass[i] = massG;
    trials.drag[i] = sDrag.value;
    trials.launchForce[i] = sForce.value;
    trials.reactionTime[i] = sReact.value;
    trials.wheelFL[i] = fl;
    trials.wheelFR[i] = fr;
    trials.wheelRL[i] = rl;
    trials.wheelRR[i] = rr;
    trials.friction[i] = muValue;
    trials.scrubForce[i] = scrub;
    trials.acceleration[i] = solved.peakAcceleration;
    trials.maxVelocity[i] = solved.maxVelocity;
    trials.travelTime[i] = solved.travelTime;
    trials.finishTime[i] = solved.travelTime + sReact.value;
  }

  function newCounters() {
    return { rejections: 0, clamps: 0, finishedUnderPower: 0, didNotFinish: 0, diverged: 0 };
  }

  function buildDiagnostics(cfg, counters, elapsedMs) {
    var n = cfg.runs;
    return {
      runs: n,
      elapsedMs: elapsedMs,
      truncationRejections: counters.rejections,
      clampedTrials: counters.clamps,
      finishedUnderPower: counters.finishedUnderPower,
      finishedUnderPowerFraction: counters.finishedUnderPower / n,
      didNotFinish: counters.didNotFinish,
      didNotFinishFraction: counters.didNotFinish / n,
      diverged: counters.diverged,
      divergedFraction: counters.diverged / n,
      wheelAngleStdDevFL: cfg.wheelAngleStdDevFL,
      wheelAngleStdDevFR: cfg.wheelAngleStdDevFR,
      wheelAngleStdDevRL: cfg.wheelAngleStdDevRL,
      wheelAngleStdDevRR: cfg.wheelAngleStdDevRR,
      frictionMean: cfg.frictionMean,
      frictionStdDev: cfg.frictionStdDev,
      frictionSampled: cfg.frictionStdDev > 0,
      peakThrustN: cfg.forceMean,
      impulseNs: cfg.forceMean * cfg.thrust.tau *
                 (1 - Math.exp(-T.BURN_TIME_CONSTANTS)),
      burnDurationS: T.burnDuration(cfg.thrust.tau)
    };
  }

  /**
   * Run the simulation synchronously. Deterministic when `rng` is supplied.
   */
  function runSimulation(rawConfig, rng) {
    var cfg = validateConfig(rawConfig);
    var n = cfg.runs;
    var trials = allocateTrials(n);
    var counters = newCounters();
    var started = Date.now();

    var table = T.decayTable(cfg.thrust.tau, cfg.physics.integrationStep,
      T.burnDuration(cfg.thrust.tau));

    if (!rng && cfg.seed !== null) rng = createSeededRandom(cfg.seed);

    for (var i = 0; i < n; i++) runTrial(i, cfg, trials, rng, table, counters);

    return {
      config: cfg,
      trials: trials,
      diagnostics: buildDiagnostics(cfg, counters, Date.now() - started)
    };
  }

  /**
   * Chunked, non-blocking runner. Yields to the event loop between chunks so
   * the browser can paint progress and stays responsive.
   */
  function runSimulationAsync(rawConfig, opts) {
    opts = opts || {};
    var cfg;
    try {
      cfg = validateConfig(rawConfig);
    } catch (err) {
      return Promise.reject(err);
    }

    var n = cfg.runs;
    var rng = opts.rng;
    if (!rng && cfg.seed !== null) rng = createSeededRandom(cfg.seed);
    var chunk = Math.max(500, opts.chunkSize || 10000);
    var trials = allocateTrials(n);
    var counters = newCounters();
    var table = T.decayTable(cfg.thrust.tau, cfg.physics.integrationStep,
      T.burnDuration(cfg.thrust.tau));

    var i = 0;
    var started = Date.now();

    return new Promise(function (resolve, reject) {
      function step() {
        try {
          var end = Math.min(i + chunk, n);
          for (; i < end; i++) runTrial(i, cfg, trials, rng, table, counters);

          if (typeof opts.onProgress === 'function') opts.onProgress(i, n);

          if (i < n) {
            setTimeout(step, 0);
          } else {
            resolve({
              config: cfg,
              trials: trials,
              diagnostics: buildDiagnostics(cfg, counters, Date.now() - started)
            });
          }
        } catch (err) {
          reject(err);
        }
      }
      step();
    });
  }

  root.SM = root.SM || {};
  root.SM.MonteCarlo = {
    PHYSICS: PHYSICS,
    WHEEL_KEYS: WHEEL_KEYS,
    buildWheels: buildWheels,
    wheelScrub: wheelScrub,
    K_EPSILON: K_EPSILON,
    createSeededRandom: createSeededRandom,
    normalRandom: normalRandom,
    truncatedNormal: truncatedNormal,
    scrubForce: scrubForce,
    coastPhase: coastPhase,
    solveRun: solveRun,
    validateConfig: validateConfig,
    allocateTrials: allocateTrials,
    runSimulation: runSimulation,
    runSimulationAsync: runSimulationAsync
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
