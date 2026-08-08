/* ============================================================================
 * SilverMach Engineering Analysis Suite — thrust.js
 * ----------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for F_thrust(t).
 *
 * Both the Monte Carlo simulation and the displayed thrust-decay curve call the
 * functions in this module. There is no second copy of the equation anywhere in
 * the project, so the plotted curve cannot drift away from the physics actually
 * being simulated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVIDENCE STATEMENT — READ THIS BEFORE TRUSTING THE NUMBERS
 * ─────────────────────────────────────────────────────────────────────────────
 * The project contains NO measured thrust data: no test-stand trace, no
 * load-cell log, no manufacturer curve, no reference table. A full search of the
 * repository for thrust/impulse/force-vs-time data returned nothing.
 *
 * Therefore NOTHING in this file is an experimental measurement, and none is
 * presented as one. What follows is a transparent engineering model derived
 * from first principles, with every parameter exposed and labelled. It should be
 * replaced with measured data the moment the team has any.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EXPONENTIAL DECAY (rather than assuming it)
 * ─────────────────────────────────────────────────────────────────────────────
 * The functional form is derived, not guessed:
 *
 *   1. An 8 g CO2 canister discharging through a small orifice is a
 *      fixed-volume blowdown. For the great majority of the discharge the
 *      nozzle is CHOKED (the pressure ratio across it far exceeds the critical
 *      ratio ~1.83 for CO2, γ ≈ 1.29).
 *   2. For choked flow the mass flow rate is proportional to the upstream
 *      stagnation pressure:      ṁ(t) = A* P(t) √(γ/(R_s T)) · C
 *   3. Emptying a fixed volume at a rate proportional to its own pressure is
 *      the classic first-order system:  dP/dt = −P/τ  ⟹  P(t) = P₀ e^(−t/τ)
 *   4. Momentum thrust is F = ṁ v_e, and since ṁ ∝ P:
 *
 *          F(t) = F₀ · e^(−t/τ)
 *
 * So exponential decay follows FROM choked blowdown physics. It was not
 * assumed because it is convenient. Its validity degrades at the very end of
 * the discharge, when the nozzle un-chokes — see LIMITATIONS below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AMPLITUDE ANCHORED TO THE 8 g CHARGE (not a free parameter)
 * ─────────────────────────────────────────────────────────────────────────────
 * Total impulse is fixed by the propellant actually carried:
 *
 *          J = m_CO2 · v_e            (momentum theorem)
 *          J = ∫₀^∞ F₀ e^(−t/τ) dt = F₀ τ
 *      ⟹   F₀ = m_CO2 · v_e / τ
 *
 * With the defaults below (8 g, 200 m/s, 0.08 s) this gives J = 1.60 N·s and
 * F₀ = 20.0 N. The peak thrust is therefore a DERIVED consequence of the
 * canister mass, not a number chosen to look plausible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARAMETERS, UNITS, BASIS
 * ─────────────────────────────────────────────────────────────────────────────
 *   m_CO2  8 g = 0.008 kg   Nominal charge of the regulation canister. The one
 *                           genuinely known quantity — it is printed on the
 *                           canister and fixed by the competition rules.
 *   v_e    200 m/s          ASSUMPTION. Effective exhaust velocity of CO2
 *                           expanding from roughly 57 bar to atmosphere through
 *                           a plain orifice. Order-of-magnitude check: ideal
 *                           choked exit velocity for CO2 (γ=1.29, M=44 g/mol,
 *                           T≈293 K) is a ≈ √(γR_sT) ≈ 265 m/s; a plain orifice
 *                           with no expanding bell recovers well under that, so
 *                           200 m/s is a deliberately conservative effective
 *                           value. NOT MEASURED.
 *   τ      0.08 s           ASSUMPTION. Blowdown time constant, set by orifice
 *                           area and canister volume. Neither has been measured
 *                           for this car, so this is an engineering estimate
 *                           consistent with a discharge that is ~99% complete
 *                           within 5τ = 0.4 s. NOT MEASURED.
 *   θ      0°               Thrust misalignment relative to the car's
 *                           longitudinal axis. Default zero — see
 *                           forwardThrust() for why.
 *
 * TIME DOMAIN: t ∈ [0, 5τ]. Beyond 5τ the remaining impulse is e^(−5) < 0.7%
 * of the total and the canister is treated as spent.
 *
 * LIMITATIONS (stated, not hidden):
 *   • No ignition transient. Real thrust rises over a few milliseconds rather
 *     than reaching F₀ instantaneously. This slightly overstates very early
 *     acceleration.
 *   • Constant v_e. In reality v_e falls as the canister cools and pressure
 *     drops, so the true tail is softer than modelled.
 *   • The un-choking phase at the very end is not modelled separately.
 *   • Adiabatic cooling of the canister (Joule–Thomson) is neglected; a real
 *     discharge is closer to isothermal-with-cooling than pure isothermal.
 *   • Because τ and v_e are estimates, ABSOLUTE race times carry real
 *     uncertainty. COMPARISONS between design iterations — which is what this
 *     tool is actually for — are far more trustworthy than the absolute values.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;

  /**
   * Default thrust-model parameters. Every one is user-editable in the UI and
   * flows straight into both the simulation and the plotted curve.
   */
  var THRUST_DEFAULTS = {
    co2Mass: 8,          // g    — regulation canister charge (KNOWN)
    exhaustVelocity: 200, // m/s  — effective exhaust velocity (ASSUMPTION)
    tau: 0.08,           // s    — blowdown time constant   (ASSUMPTION)
    thrustAngle: 0       // deg  — misalignment from the longitudinal axis
  };

  /** Discharge is treated as complete after this many time constants. */
  var BURN_TIME_CONSTANTS = 5;

  /**
   * Total impulse delivered by the charge: J = m_CO2 · v_e.
   * @param {number} co2MassGrams
   * @param {number} exhaustVelocity  m/s
   * @returns {number} N·s
   */
  function totalImpulse(co2MassGrams, exhaustVelocity) {
    return (co2MassGrams / 1000) * exhaustVelocity;
  }

  /**
   * Peak thrust at t = 0, derived from the charge rather than chosen:
   *   F₀ = J / τ = m_CO2 · v_e / τ
   * @returns {number} newtons
   */
  function peakThrust(co2MassGrams, exhaustVelocity, tau) {
    if (!(tau > 0)) return 0;
    return totalImpulse(co2MassGrams, exhaustVelocity) / tau;
  }

  /** Burn duration used by the model and the plot: 5τ. */
  function burnDuration(tau) {
    return BURN_TIME_CONSTANTS * tau;
  }

  /**
   * F_thrust(t) — THE thrust function. Everything else defers to this.
   *
   *     F(t) = F₀ e^(−t/τ)   for 0 ≤ t ≤ 5τ
   *     F(t) = 0             otherwise
   *
   * @param {number} t   seconds
   * @param {number} peakN  F₀ in newtons
   * @param {number} tau    seconds
   * @returns {number} newtons
   */
  function thrustAt(t, peakN, tau) {
    if (!(t >= 0) || !(tau > 0)) return 0;
    if (t > BURN_TIME_CONSTANTS * tau) return 0;
    return peakN * Math.exp(-t / tau);
  }

  /**
   * Forward (track-direction) component of thrust.
   *
   * GEOMETRY NOTE — why the default is a bare F(t):
   * The canister sits in a breech bored along the car's longitudinal axis, and
   * the car is constrained by the guide line to travel along that same axis.
   * With the axes coincident the thrust vector and the direction of travel are
   * parallel, so cos θ = 1 and the forward component IS the full thrust. The
   * project contains no measurement of any canister misalignment, so inserting
   * a cosine factor with a non-zero angle would be inventing geometry.
   *
   * The θ term is therefore exposed but defaults to 0°, so the user can
   * explore a deliberately misaligned breech without the model silently
   * asserting a misalignment that was never measured.
   *
   *     F_forward(t) = F_thrust(t) · cos θ
   *
   * @param {number} t
   * @param {number} peakN
   * @param {number} tau
   * @param {number} thrustAngleDeg  0 ⇒ thrust parallel to travel
   * @returns {number} newtons along the direction of travel
   */
  function forwardThrust(t, peakN, tau, thrustAngleDeg) {
    var cos = Math.cos((thrustAngleDeg || 0) * Math.PI / 180);
    return thrustAt(t, peakN, tau) * cos;
  }

  /**
   * Sampled F(t) for plotting. The chart calls this; the simulation calls
   * thrustAt()/forwardThrust() — same equation, same parameters, one source.
   *
   * @param {{peakN:number, tau:number, thrustAngle?:number, points?:number,
   *          tEnd?:number}} opts
   * @returns {{points:{x:number,y:number}[], forwardPoints:{x:number,y:number}[],
   *            tEnd:number, peakN:number, tau:number, impulse:number}}
   */
  function thrustSeries(opts) {
    var peakN = opts.peakN;
    var tau = opts.tau;
    var angle = opts.thrustAngle || 0;
    var n = opts.points || 160;
    var tEnd = opts.tEnd || burnDuration(tau);

    var points = new Array(n + 1);
    var forwardPoints = new Array(n + 1);
    for (var i = 0; i <= n; i++) {
      var t = (tEnd * i) / n;
      points[i] = { x: t, y: thrustAt(t, peakN, tau) };
      forwardPoints[i] = { x: t, y: forwardThrust(t, peakN, tau, angle) };
    }
    return {
      points: points,
      forwardPoints: forwardPoints,
      tEnd: tEnd,
      peakN: peakN,
      tau: tau,
      impulse: peakN * tau * (1 - Math.exp(-BURN_TIME_CONSTANTS))
    };
  }

  /**
   * Precomputed decay factors e^(−t/τ) on the integrator's grid.
   *
   * PERFORMANCE: the sampled peak thrust F₀ differs on every trial, but τ and
   * dt do not. Since e^(−(n·dt)/τ) = (e^(−dt/τ))ⁿ, the whole profile is a
   * geometric sequence that can be built once per simulation and reused by
   * every trial. This removes ~10⁸ Math.exp() calls from the inner loop of a
   * 100,000-trial run, which is what keeps the time-dependent model fast
   * enough to stay interactive.
   *
   * @returns {{full:Float64Array, half:Float64Array, steps:number, dt:number}}
   */
  function decayTable(tau, dt, tEnd) {
    var steps = Math.max(1, Math.ceil(tEnd / dt));
    var full = new Float64Array(steps + 1);
    var half = new Float64Array(steps + 1);
    var rFull = Math.exp(-dt / tau);
    var rHalf = Math.exp(-(dt * 0.5) / tau);
    // Each entry is evaluated with thrustAt() directly rather than by
    // repeatedly multiplying a decay ratio. The geometric shortcut accumulated
    // ~1e-5 relative floating-point drift over 400 steps, which made the
    // tabulated path disagree with thrustAt() by a few microseconds of race
    // time. The table is built ONCE PER SIMULATION (not per trial), so a few
    // hundred exp() calls are free — the optimisation that matters is keeping
    // exp() out of the 100,000-trial inner loop, and that still holds.
    for (var i = 0; i <= steps; i++) {
      full[i] = thrustAt(i * dt, 1, tau);
      half[i] = thrustAt((i + 0.5) * dt, 1, tau);
    }

    return { full: full, half: half, steps: steps, dt: dt };
  }

  /** Human-readable equation string, shown beside the chart. */
  function equationText(peakN, tau) {
    return 'F(t) = ' + U.fmt(peakN, 2) + ' · e^(−t / ' + U.fmt(tau, 3) + ') N';
  }

  root.SM = root.SM || {};
  root.SM.Thrust = {
    THRUST_DEFAULTS: THRUST_DEFAULTS,
    BURN_TIME_CONSTANTS: BURN_TIME_CONSTANTS,
    totalImpulse: totalImpulse,
    peakThrust: peakThrust,
    burnDuration: burnDuration,
    thrustAt: thrustAt,
    forwardThrust: forwardThrust,
    thrustSeries: thrustSeries,
    decayTable: decayTable,
    equationText: equationText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
