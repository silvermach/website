/* ============================================================================
 * SilverMach Engineering Analysis Suite — monteCarlo.js
 * ----------------------------------------------------------------------------
 * Stochastic race-outcome simulator.
 *
 * PHYSICAL MODEL
 * --------------
 * A CO2 cartridge delivers approximately constant thrust F for a discharge
 * duration T, after which the car coasts. The only resistive force modelled is
 * aerodynamic drag, quadratic in velocity:
 *
 *     D(v) = k v²,      k = ½ ρ Cd A
 *
 * Rolling/bearing resistance is deliberately excluded: it is not one of the
 * four stochastic inputs in the specification, and including a constant
 * retarding term introduces a non-physical "car stops before the line" failure
 * mode. The model is therefore thrust + aerodynamic drag, starting from rest.
 *
 * Both phases are solved in CLOSED FORM rather than by numerical integration.
 * This removes discretisation error entirely and makes each trial O(1), which
 * is what allows 100,000+ trials to run without freezing the browser.
 *
 *   Phase 1 — thrust on, 0 ≤ t ≤ T:
 *       m dv/dt = F − k v²
 *       v_term = √(F/k),   α = √(F k)/m
 *       v(t)   = v_term · tanh(α t)
 *       x(t)   = (m/k) · ln( cosh(α t) )
 *       t(x)   = arccosh( e^(k x / m) ) / α
 *
 *   Phase 2 — coasting from (x₁, v₁):
 *       m dv/dt = − k v²
 *       v(τ)   = v₁ / (1 + (k v₁/m) τ)
 *       x(τ)   = x₁ + (m/k) · ln(1 + (k v₁/m) τ)
 *       τ(Δx)  = (m / (k v₁)) · ( e^(k Δx / m) − 1 )
 *
 *   Drag-free limit (k → 0) is handled analytically as a separate branch to
 *   avoid division by zero: uniform acceleration then constant velocity.
 *
 * Total finish time = travel time + driver reaction delay.
 * Attaches to `SM.MonteCarlo`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;

  /** Physical constants. Documented and overridable — never silently assumed. */
  var PHYSICS = {
    airDensity: 1.225,      // kg/m³, dry air at 15 °C, sea level
    frontalArea: 0.0026,    // m², representative F1-in-Schools body cross-section
    thrustDuration: 0.20    // s, nominal 8 g CO2 cartridge discharge window
  };

  var K_EPSILON = 1e-12;    // below this, treat drag as absent

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
   *
   * @param {number} mean
   * @param {number} stdDev  Must be ≥ 0. Zero yields the mean exactly.
   * @param {function(): number} [rng=Math.random]
   * @returns {number}
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
   * Physical inputs (mass, drag, force, reaction time) cannot be negative, so
   * a raw normal draw must be rejected rather than clamped where possible —
   * clamping would pile probability mass onto the boundary and bias results.
   * After `maxAttempts` rejections the value is clamped as a last resort and
   * the caller is informed via the returned rejection counter.
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

  /* ------------------------------------------------------------- physics */

  /**
   * Exact solution of a single run.
   *
   * @param {number} massKg
   * @param {number} dragCoefficient   Cd, dimensionless, ≥ 0
   * @param {number} thrustN
   * @param {number} trackLengthM
   * @param {{airDensity:number,frontalArea:number,thrustDuration:number}} phys
   * @returns {{travelTime:number, maxVelocity:number, peakAcceleration:number,
   *            finishedDuringThrust:boolean, distanceAtBurnout:number,
   *            velocityAtBurnout:number}}
   */
  function solveRun(massKg, dragCoefficient, thrustN, trackLengthM, phys) {
    var m = massKg;
    var F = thrustN;
    var L = trackLengthM;
    var T = phys.thrustDuration;
    var k = 0.5 * phys.airDensity * dragCoefficient * phys.frontalArea;

    var peakAcceleration = F / m; // at t=0 velocity is zero, so drag is zero

    /* ---- drag-free analytical branch ---- */
    if (k < K_EPSILON) {
      var a = F / m;
      var xBurn = 0.5 * a * T * T;
      var vBurn = a * T;
      if (xBurn >= L) {
        var tFin = Math.sqrt(2 * L / a);
        return {
          travelTime: tFin,
          maxVelocity: a * tFin,
          peakAcceleration: peakAcceleration,
          finishedDuringThrust: true,
          distanceAtBurnout: xBurn,
          velocityAtBurnout: vBurn
        };
      }
      return {
        travelTime: T + (L - xBurn) / vBurn,
        maxVelocity: vBurn,
        peakAcceleration: peakAcceleration,
        finishedDuringThrust: false,
        distanceAtBurnout: xBurn,
        velocityAtBurnout: vBurn
      };
    }

    /* ---- Phase 1: powered, quadratic drag ---- */
    var vTerm = Math.sqrt(F / k);
    var alpha = Math.sqrt(F * k) / m;
    var mOverK = m / k;

    // Distance covered by burnout: x = (m/k) ln(cosh(αT))
    var coshAT = Math.cosh(alpha * T);
    var xBurnout = mOverK * Math.log(coshAT);
    var vBurnout = vTerm * Math.tanh(alpha * T);

    if (xBurnout >= L) {
      // Finishes while still under power. Invert x(t) for t.
      // cosh(αt) = e^(kL/m)  →  t = arccosh(e^(kL/m)) / α
      var arg = Math.exp((k * L) / m);
      var tFinish = Math.acosh(arg) / alpha;
      return {
        travelTime: tFinish,
        maxVelocity: vTerm * Math.tanh(alpha * tFinish),
        peakAcceleration: peakAcceleration,
        finishedDuringThrust: true,
        distanceAtBurnout: xBurnout,
        velocityAtBurnout: vBurnout
      };
    }

    /* ---- Phase 2: coasting, drag only ---- */
    // τ = (m / (k v₁)) (e^(k Δx / m) − 1)
    var remaining = L - xBurnout;
    var tau = (mOverK / vBurnout) * (Math.exp((k * remaining) / m) - 1);

    return {
      travelTime: T + tau,
      maxVelocity: vBurnout,       // coasting only decelerates, so burnout is peak
      peakAcceleration: peakAcceleration,
      finishedDuringThrust: false,
      distanceAtBurnout: xBurnout,
      velocityAtBurnout: vBurnout
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
    var out = {
      massMean: U.requireNumber(cfg.massMean, 'Vehicle mass mean (g)', { min: 0, exclusiveMin: true }),
      massStdDev: U.requireNumber(cfg.massStdDev, 'Vehicle mass standard deviation (g)', { min: 0 }),
      dragMean: U.requireNumber(cfg.dragMean, 'Drag coefficient mean', { min: 0 }),
      dragStdDev: U.requireNumber(cfg.dragStdDev, 'Drag coefficient standard deviation', { min: 0 }),
      forceMean: U.requireNumber(cfg.forceMean, 'Launch force mean (N)', { min: 0, exclusiveMin: true }),
      forceStdDev: U.requireNumber(cfg.forceStdDev, 'Launch force standard deviation (N)', { min: 0 }),
      reactionMean: U.requireNumber(cfg.reactionMean, 'Reaction time mean (s)', { min: 0 }),
      reactionStdDev: U.requireNumber(cfg.reactionStdDev, 'Reaction time standard deviation (s)', { min: 0 }),
      trackLength: U.requireNumber(cfg.trackLength, 'Track length (m)', { min: 0, exclusiveMin: true }),
      runs: U.requireNumber(cfg.runs, 'Number of simulations', { min: 1, max: 5000000, integer: true }),
      physics: {
        airDensity: U.requireNumber(
          cfg.physics && cfg.physics.airDensity !== undefined ? cfg.physics.airDensity : PHYSICS.airDensity,
          'Air density (kg/m³)', { min: 0, exclusiveMin: true }),
        frontalArea: U.requireNumber(
          cfg.physics && cfg.physics.frontalArea !== undefined ? cfg.physics.frontalArea : PHYSICS.frontalArea,
          'Frontal area (m²)', { min: 0, exclusiveMin: true }),
        thrustDuration: U.requireNumber(
          cfg.physics && cfg.physics.thrustDuration !== undefined ? cfg.physics.thrustDuration : PHYSICS.thrustDuration,
          'Thrust duration (s)', { min: 0, exclusiveMin: true })
      }
    };
    return out;
  }

  /* --------------------------------------------------------- simulation */

  /**
   * Allocate the flat typed-array result store.
   * One Float64Array per metric — contiguous memory, no per-trial objects,
   * which is what keeps 100,000+ trials cheap in both time and heap.
   */
  function allocateTrials(n) {
    return {
      count: n,
      simulationNumber: new Float64Array(n),
      mass: new Float64Array(n),          // grams (as entered by the user)
      drag: new Float64Array(n),          // Cd
      launchForce: new Float64Array(n),   // N
      reactionTime: new Float64Array(n),  // s
      acceleration: new Float64Array(n),  // m/s², peak (t=0)
      maxVelocity: new Float64Array(n),   // m/s
      travelTime: new Float64Array(n),    // s, excluding reaction
      finishTime: new Float64Array(n)     // s, including reaction
    };
  }

  /**
   * Run the simulation synchronously. Deterministic when `rng` is supplied.
   *
   * @param {Object} rawConfig
   * @param {function(): number} [rng]
   * @returns {{config:Object, trials:Object, diagnostics:Object}}
   */
  function runSimulation(rawConfig, rng) {
    var cfg = validateConfig(rawConfig);
    var n = cfg.runs;
    var phys = cfg.physics;
    var trials = allocateTrials(n);

    var rejections = 0;
    var clamps = 0;
    var finishedUnderPower = 0;
    var started = Date.now();

    for (var i = 0; i < n; i++) {
      // Sample order per specification: mass → drag → launch force → reaction.
      var sMass = truncatedNormal(cfg.massMean, cfg.massStdDev, 1e-6, Infinity, rng);
      var sDrag = truncatedNormal(cfg.dragMean, cfg.dragStdDev, 0, Infinity, rng);
      var sForce = truncatedNormal(cfg.forceMean, cfg.forceStdDev, 1e-6, Infinity, rng);
      var sReact = truncatedNormal(cfg.reactionMean, cfg.reactionStdDev, 0, Infinity, rng);

      rejections += sMass.rejections + sDrag.rejections + sForce.rejections + sReact.rejections;
      if (sMass.clamped || sDrag.clamped || sForce.clamped || sReact.clamped) clamps++;

      var massG = sMass.value;
      var solved = solveRun(massG / 1000, sDrag.value, sForce.value, cfg.trackLength, phys);
      if (solved.finishedDuringThrust) finishedUnderPower++;

      trials.simulationNumber[i] = i + 1;
      trials.mass[i] = massG;
      trials.drag[i] = sDrag.value;
      trials.launchForce[i] = sForce.value;
      trials.reactionTime[i] = sReact.value;
      trials.acceleration[i] = solved.peakAcceleration;
      trials.maxVelocity[i] = solved.maxVelocity;
      trials.travelTime[i] = solved.travelTime;
      trials.finishTime[i] = solved.travelTime + sReact.value;
    }

    return {
      config: cfg,
      trials: trials,
      diagnostics: {
        runs: n,
        elapsedMs: Date.now() - started,
        truncationRejections: rejections,
        clampedTrials: clamps,
        finishedUnderPower: finishedUnderPower,
        finishedUnderPowerFraction: finishedUnderPower / n
      }
    };
  }

  /**
   * Chunked, non-blocking runner. Yields to the event loop between chunks so
   * the browser can paint progress and stays responsive even at 1e6 trials.
   *
   * @param {Object} rawConfig
   * @param {{chunkSize?:number, onProgress?:function(number, number):void,
   *          rng?:function():number}} [opts]
   * @returns {Promise<{config:Object, trials:Object, diagnostics:Object}>}
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
    var phys = cfg.physics;
    var rng = opts.rng;
    var chunk = Math.max(500, opts.chunkSize || 10000);
    var trials = allocateTrials(n);

    var i = 0;
    var rejections = 0, clamps = 0, finishedUnderPower = 0;
    var started = Date.now();

    return new Promise(function (resolve, reject) {
      function step() {
        try {
          var end = Math.min(i + chunk, n);
          for (; i < end; i++) {
            var sMass = truncatedNormal(cfg.massMean, cfg.massStdDev, 1e-6, Infinity, rng);
            var sDrag = truncatedNormal(cfg.dragMean, cfg.dragStdDev, 0, Infinity, rng);
            var sForce = truncatedNormal(cfg.forceMean, cfg.forceStdDev, 1e-6, Infinity, rng);
            var sReact = truncatedNormal(cfg.reactionMean, cfg.reactionStdDev, 0, Infinity, rng);

            rejections += sMass.rejections + sDrag.rejections + sForce.rejections + sReact.rejections;
            if (sMass.clamped || sDrag.clamped || sForce.clamped || sReact.clamped) clamps++;

            var massG = sMass.value;
            var solved = solveRun(massG / 1000, sDrag.value, sForce.value, cfg.trackLength, phys);
            if (solved.finishedDuringThrust) finishedUnderPower++;

            trials.simulationNumber[i] = i + 1;
            trials.mass[i] = massG;
            trials.drag[i] = sDrag.value;
            trials.launchForce[i] = sForce.value;
            trials.reactionTime[i] = sReact.value;
            trials.acceleration[i] = solved.peakAcceleration;
            trials.maxVelocity[i] = solved.maxVelocity;
            trials.travelTime[i] = solved.travelTime;
            trials.finishTime[i] = solved.travelTime + sReact.value;
          }

          if (typeof opts.onProgress === 'function') opts.onProgress(i, n);

          if (i < n) {
            // setTimeout(0) reliably yields in every environment, including Node.
            setTimeout(step, 0);
          } else {
            resolve({
              config: cfg,
              trials: trials,
              diagnostics: {
                runs: n,
                elapsedMs: Date.now() - started,
                truncationRejections: rejections,
                clampedTrials: clamps,
                finishedUnderPower: finishedUnderPower,
                finishedUnderPowerFraction: finishedUnderPower / n
              }
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
    K_EPSILON: K_EPSILON,
    createSeededRandom: createSeededRandom,
    normalRandom: normalRandom,
    truncatedNormal: truncatedNormal,
    solveRun: solveRun,
    validateConfig: validateConfig,
    allocateTrials: allocateTrials,
    runSimulation: runSimulation,
    runSimulationAsync: runSimulationAsync
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
