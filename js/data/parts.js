/* ============================================================================
 * SilverMach — data/parts.js
 * ----------------------------------------------------------------------------
 * The five car components, each carrying all five information categories:
 * engineering function, manufacturing method, sustainability impact, material
 * choice and STEM outreach application. Shared by the interactive car viewer on
 * index.html and the sustainability-lens viewer on greenmach.html.
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
      manufacture: 'CNC-milled from a billet blank on a 3-axis router following the CAD toolpath, then hand-finished with progressively finer grits to hold the simulated aero surface within tight tolerance.',
      sustain: 'A more aerodynamic shape means less energy wasted pushing air — the same principle that makes real road cars more efficient and lower-emission.',
      material: 'Balsa/basswood core chosen for its strength-to-weight ratio and easy re-machinability, so a mis-cut blank is re-used for the next iteration rather than binned.',
      outreach: 'A perfect demo for showing students how shape changes speed. An airflow visual instantly connects physics class to a real, fast object.'
    },
    {
      key: 'frontwing',
      label: 'Wings',
      name: 'Aero Wings',
      sub: 'Aerodynamics & Stability',
      tech: 'Front and rear wings manage airflow as it hits and leaves the car, keeping it stable and pointed straight down the track at launch.',
      manufacture: '3D-printed in PLA on an FDM printer directly from the CAD wing profile, letting us iterate an angle-of-attack change overnight instead of re-cutting stock.',
      sustain: 'Designed digitally first, so we prototype in pixels rather than scrapping physical parts — cutting material waste during iteration.',
      material: 'PLA is a bio-based, compostable plastic derived from corn starch — chosen over petroleum-based filaments for lower embodied carbon in prototyping.',
      outreach: 'A hands-on lesson in downforce and balance that students can feel by changing a single angle and re-racing.'
    },
    {
      key: 'wheels',
      label: 'Wheels & Axles',
      name: 'Wheels & Axles',
      sub: 'Rotation & Friction',
      tech: 'True axle alignment and carefully balanced wheels keep the car rolling straight and true, so as much of its stored energy as possible goes into forward motion instead of wobble or drag.',
      manufacture: 'Wheels are precision-turned on a lathe and polished for roundness; axle bores are reamed and pressure-tested for a true, low-friction fit against the rail.',
      sustain: 'Reducing friction is the cleanest performance gain there is — every bit of energy saved is energy not wasted, a core idea in efficient mobility.',
      material: 'Lightweight polymer wheels paired with steel axles — reusable across multiple builds instead of being consumed each race, cutting recurring material demand.',
      outreach: 'Friction is one of the most teachable forces. Spinning a well-aligned vs. misaligned axle is an unforgettable classroom moment.'
    },
    {
      key: 'co2',
      label: 'Power Source',
      name: 'CO₂ Power Cartridge',
      sub: 'Energy & Propulsion',
      tech: 'A single CO₂ cartridge releases a burst of gas that thrusts the car forward — a real-world demonstration of Newton’s third law and stored energy.',
      manufacture: 'A single commercial cartridge is seated and sealed into a machined breech bored to the regulation diameter, verified for a leak-free fit before every run.',
      sustain: 'A fixed, measured energy source teaches energy budgeting: you can’t add more power, so you must waste less. We handle every spent cartridge responsibly.',
      material: 'Steel cartridge shells are collected after firing and sent for metal recycling rather than general waste — closing the loop on our one true consumable.',
      outreach: 'The standout moment of any demo — students watch stored energy become motion in under a second, then ask how to make it go further.'
    },
    {
      key: 'materials',
      label: 'Halo & Materials',
      name: 'Halo, Cockpit & Materials',
      sub: 'Safety, Mass & Manufacturing',
      tech: 'The halo and cockpit mirror real F1 safety structures, while every material is chosen for the best strength-to-weight ratio — removing every gram that doesn’t earn its place while keeping the car safe and legal.',
      manufacture: 'Laser-cut and hand-assembled from offcuts of the main body blank, so the safety structure is built almost entirely from what would otherwise be scrap.',
      sustain: 'Lighter, responsibly-sourced materials and precise manufacturing mean less raw material used and less offcut waste sent to the bin.',
      material: 'Sustainably-sourced hardwood offcuts and a dab of lightweight filler — no material is bought new solely for the halo, it is scavenged from the body stage.',
      outreach: 'Lets students weigh trade-offs like real engineers: strong vs. light vs. sustainable — there’s no single right answer, just good decisions.'
    }
  ];

  root.SM = root.SM || {};
  root.SM.Data = root.SM.Data || {};
  root.SM.Data.PARTS = PARTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
