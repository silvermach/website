/* ============================================================================
 * SilverMach — data/team.js
 * ----------------------------------------------------------------------------
 * Team roster, sponsorship benefit matrix and partner tiers.
 *
 * Portraits and partner logos are now real files under ./assets/ referenced by
 * RELATIVE path, not base64 strings embedded in the page. Relative paths are
 * required for GitHub Pages, which serves projects from a subpath such as
 * user.github.io/repo-name/ — a leading-slash path would resolve to the domain
 * root and 404.
 * Attaches to SM.Data.TEAM / SPONSOR_BENEFITS / TIERS / PARTNERS.
 * ======================================================================== */
(function (root) {
  'use strict';

  var TEAM = [
    {
      name: 'Parimi Potana Sri Sai Yashasvi',
      role: 'Project Manager & Chief Design Engineer',
      img: './assets/team/yashasvi.jpg',
      bio: 'An aspiring motorsport driver with a deep interest in the engineering side of racing. He participated in the IMA Bootcamp 2025, gaining first-hand exposure to Indian Formula 4 machinery and real-world race cars. His passion for motorsport and commitment to continuous learning drive Team SilverMach’s pursuit of excellence.'
    },
    {
      name: 'Amay Bhattacharya',
      role: 'Manufacturing & Quality Lead',
      img: './assets/team/amay.jpg',
      bio: 'An aspiring aerospace engineer with a passion for innovation and engineering design. His experience includes a conceptual Titan lander, a NASA-affiliated asteroid detection campaign, and projects in aerodynamics, fluid dynamics, and CAD design using SolidWorks. Amay brings analytical thinking, creativity, and precision to every challenge.'
    },
    {
      name: 'Jayanth Devaraneni',
      role: 'Enterprise, Branding & Strategy Lead',
      img: './assets/team/jayanth.jpg',
      bio: 'An IB Diploma student with interests in engineering, design, and problem solving. Through personal projects he has developed experience in CAD modelling and technical design, alongside skills in branding, sponsorship outreach, and strategic planning — contributing to both the creative and operational sides of the team.'
    },
    {
      name: 'Abhinav Yanamandra',
      role: 'Performance & Simulation Lead',
      img: './assets/team/abhinav.jpg',
      bio: 'Brings a strong foundation in computational fluid dynamics (CFD) and advanced mechanics, with a proven track record of reliable, high-efficiency engineering solutions. His work on complex aviation projects, including gliders and UAVs, shows a meticulous approach to design and structural integrity.'
    },
    {
      name: 'B Rohan Krishna',
      role: 'Compliance, CAD & Documentation Lead',
      img: './assets/team/rohan.jpg',
      bio: 'Specializes in engineering drawings and CAD, contributing precise technical models for the competition. At an aquaculture firm he helped design a moving aquabot and supported pond-deployed products that entered real use — learning manufacturability, material selection, and risk mitigation firsthand.'
    }
  ];

  var SPONSOR_BENEFITS = [
    { b: 'Logo on Pit Display', t: [1, 1, 1, 1, 1] },
    { b: 'Social Media Mentions', t: [1, 1, 1, 1, 1] },
    { b: 'Logo on Team Jersey', t: [1, 1, 1, 1, 0] },
    { b: 'Recognition in Outreach Material', t: [1, 1, 1, 0, 0] },
    { b: 'Logo on Race Car', t: [1, 1, 0, 0, 0] },
    { b: 'Exclusive Title Sponsor Status', t: [1, 0, 0, 0, 0] },
    { b: 'Logo on Portfolio Cover & Major Campaign Assets', t: [1, 0, 0, 0, 0] }
  ];

  var TIERS = [
    { n: 'Title Sponsor', a: '₹ 1,25,000+', c: 'title' },
    { n: 'Platinum Sponsor', a: '₹ 75,000+', c: 'platinum' },
    { n: 'Gold Sponsor', a: '₹ 35,000+', c: 'gold' },
    { n: 'Silver Sponsor', a: '₹ 15,000+', c: 'silver' },
    { n: 'Bronze Sponsor', a: '₹ 5,000+', c: 'bronze' }
  ];

  var PARTNERS = [
    { name: 'Silver Oaks', role: 'Sponsor', img: './assets/sponsors/silver-oaks.jpg', inkind: false },
    { name: 'Lit By Humanity', role: 'Sponsor', img: './assets/sponsors/lit-by-humanity.jpg', inkind: false },
    { name: 'S.H.E.', role: 'In-Kind Sponsor', img: './assets/sponsors/she.jpg', inkind: true },
    { name: 'Udaan', role: 'In-Kind Sponsor', img: './assets/sponsors/udaan.jpg', inkind: true }
  ];

  root.SM = root.SM || {};
  root.SM.Data = root.SM.Data || {};
  root.SM.Data.TEAM = TEAM;
  root.SM.Data.SPONSOR_BENEFITS = SPONSOR_BENEFITS;
  root.SM.Data.TIERS = TIERS;
  root.SM.Data.PARTNERS = PARTNERS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
