/* ============================================================================
 * SilverMach — data/parts.js
 * ----------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for car component copy. Consumed by the interactive
 * car viewer on index.html and the sustainability-lens viewer on greenmach.html,
 * so a correction here reaches both pages and cannot drift.
 *
 * MATERIALS — the only two materials the team actually uses:
 *   • Main car body ............ low-density polyurethane foam
 *   • Every other component .... 3D-printed PETG
 *     (nose, wings, wheels, front wheel support, wheel caps, helmet, halo)
 *
 * The CO2 canister is a sealed consumable supplied to competition spec; it is
 * not manufactured by the team and is therefore not described as one of the
 * team's materials.
 *
 * No other material is claimed anywhere in this file. Earlier revisions
 * described balsa/basswood, PLA, hardwood offcuts, polymer wheels, steel axles
 * and filler — none of those were correct and all have been removed.
 * Attaches to SM.Data.PARTS.
 * ======================================================================== */
(function (root) {
  'use strict';

  var PARTS = [
    {
      key: 'body',
      label: 'Body / Aero',
      name: 'Aerodynamic Body',
      sub: 'Chassis & Bodywork',
      tech: 'This is our actual Open Nationals body, sculpted in Fusion 360 and shown here straight from our CAD file. The shell is shaped to slice through air with minimum drag, validated in simulation before a single chip of material is removed.',
      manufacture: 'Machined from a low-density polyurethane foam blank following the CAD toolpath, then hand-finished with progressively finer grits to hold the simulated aero surface within tight tolerance.',
      sustain: 'A more aerodynamic shape means less energy wasted pushing air — the same principle that makes real road cars more efficient and lower-emission.',
      material: 'Low-density polyurethane foam. It is the only material used for the main body, chosen because it delivers a usable stiffness-to-weight ratio at very low mass and machines cleanly enough to hold an aerodynamic surface.',
      outreach: 'A perfect demo for showing students how shape changes speed. An airflow visual instantly connects physics class to a real, fast object.'
    },
    {
      key: 'frontwing',
      label: 'Wings',
      name: 'Aero Wings',
      sub: 'Aerodynamics & Stability',
      tech: 'Front and rear wings manage airflow as it hits and leaves the car, keeping it stable and pointed straight down the track at launch.',
      manufacture: '3D-printed in PETG on an FDM printer directly from the CAD wing profile, letting us iterate an angle-of-attack change overnight instead of re-cutting stock.',
      sustain: 'Designed digitally first, so we prototype in pixels rather than scrapping physical parts — cutting material waste during iteration.',
      material: '3D-printed PETG, the single material used for every component other than the main body. PETG was chosen for its toughness and dimensional stability: thin wing sections survive handling and repeated track runs without becoming brittle.',
      outreach: 'A hands-on lesson in downforce and balance that students can feel by changing a single angle and re-racing.'
    },
    {
      key: 'wheels',
      label: 'Wheels & Axles',
      name: 'Wheels, Caps & Front Support',
      sub: 'Rotation & Friction',
      tech: 'True axle alignment and carefully balanced wheels keep the car rolling straight and true, so as much of its stored energy as possible goes into forward motion instead of wobble or scrub. Our Monte Carlo model treats the toe angle of all four wheels as a stochastic input for exactly this reason.',
      manufacture: 'Wheels, wheel caps and the front wheel support are 3D-printed in PETG from the CAD geometry, then deburred and checked for roundness and free rotation before assembly.',
      sustain: 'Reducing friction is the cleanest performance gain there is — every bit of energy saved is energy not wasted, a core idea in efficient mobility.',
      material: '3D-printed PETG for the wheels, wheel caps and front wheel support. Printing them lets us re-cut a single component when alignment is out of tolerance instead of discarding a whole assembly.',
      outreach: 'Friction is one of the most teachable forces. Spinning a well-aligned vs. misaligned axle is an unforgettable classroom moment — and it maps directly onto the wheel-angle variable in our simulator.'
    },
    {
      key: 'co2',
      label: 'Power Source',
      name: 'CO₂ Power Cartridge',
      sub: 'Energy & Propulsion',
      tech: 'A single 8 g CO₂ cartridge releases a burst of gas that thrusts the car forward — a real-world demonstration of Newton’s third law and stored energy. Its thrust is not constant: pressure falls as the canister empties, which is why our simulator models thrust as a decaying function of time rather than a fixed force.',
      manufacture: 'The cartridge is a sealed consumable supplied to competition specification — we do not manufacture it. It seats into a PETG-printed breech bored to the regulation diameter and is checked for a leak-free fit before every run.',
      sustain: 'A fixed, measured energy source teaches energy budgeting: you can’t add more power, so you must waste less. Every gram of mass and every unit of drag we remove buys speed from the same 8 g of CO₂.',
      material: 'The cartridge itself is a supplied steel consumable, not a team material. The breech that holds it is 3D-printed PETG like every other non-body component.',
      outreach: 'The standout moment of any demo — students watch stored energy become motion in under a second, then ask how to make it go further.'
    },
    {
      key: 'materials',
      label: 'Halo & Materials',
      name: 'Halo, Helmet & Cockpit',
      sub: 'Safety, Mass & Manufacturing',
      tech: 'The halo and helmet mirror real F1 safety structures, while every material is chosen for the best strength-to-weight ratio — removing every gram that doesn’t earn its place while keeping the car safe and legal.',
      manufacture: 'Halo, helmet and cockpit details are 3D-printed in PETG and bonded to the machined foam body, which keeps the safety structures crisp without adding the mass a machined equivalent would.',
      sustain: 'Using just two materials across the whole car keeps the build simple to source, simple to explain and simple to account for — there is no long tail of offcuts in different materials to manage.',
      material: '3D-printed PETG for the halo, helmet and cockpit, bonded to the low-density polyurethane foam body. Those two materials account for the entire car.',
      outreach: 'Lets students weigh trade-offs like real engineers: strong vs. light vs. manufacturable — there’s no single right answer, just good decisions.'
    }
  ];

  root.SM = root.SM || {};
  root.SM.Data = root.SM.Data || {};
  root.SM.Data.PARTS = PARTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
