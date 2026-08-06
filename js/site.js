/* ============================================================================
 * SilverMach — site.js
 * ----------------------------------------------------------------------------
 * Shared site chrome and content rendering: interactive car part selector, part
 * panels, team grid, sponsorship table and tiers, partner logos, race-day
 * countdown, scroll progress / nav state, fade-in observer and the particle
 * backdrop.
 *
 * Extracted verbatim in behaviour from the old inline <script>, with three
 * corrections:
 *   • Images come from ./assets/ by relative path instead of inline base64.
 *   • Every DOM lookup is null-guarded so this one file can serve both
 *     index.html and greenmach.html, which contain different subsets of the
 *     sections. Previously a missing element would throw and abort the rest of
 *     the script.
 *   • selectPart() no longer assumes the 3D viewer exists; car3d.js registers a
 *     highlight hook when (and only when) it initialises successfully.
 * ======================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var PARTS = (root.SM && root.SM.Data && root.SM.Data.PARTS) || [];
  var Data = (root.SM && root.SM.Data) || {};
  var LOGO = './assets/logo.png';

  function el(id) { return doc.getElementById(id); }

  /* --------------------------------------------------------------- logos */

  function applyLogos() {
    ['nav-logo', 'hero-logo', 'footer-logo'].forEach(function (id) {
      var node = el(id);
      if (node) node.src = LOGO;
    });
  }

  /* ---------------------------------------------- interactive car tabs */

  var tabsEl = null;

  /**
   * No-op until car3d.js replaces it. Keeps selectPart() safe when WebGL is
   * unavailable or three.js could not be loaded.
   */
  root.SM = root.SM || {};
  if (typeof root.SM.highlightCarPart !== 'function') {
    root.SM.highlightCarPart = function () {};
  }

  function selectPart(key) {
    var part = null;
    for (var i = 0; i < PARTS.length; i++) {
      if (PARTS[i].key === key) { part = PARTS[i]; break; }
    }
    if (!part) return;

    var fields = {
      'pd-name': part.name,
      'pd-sub': part.sub,
      'pd-tech': part.tech,
      'pd-manufacture': part.manufacture,
      'pd-sustain': part.sustain,
      'pd-material': part.material,
      'pd-outreach': part.outreach
    };
    Object.keys(fields).forEach(function (id) {
      var node = el(id);
      if (node) node.textContent = fields[id];
    });

    if (tabsEl) {
      var buttons = tabsEl.children;
      for (var b = 0; b < buttons.length; b++) {
        buttons[b].classList.toggle('active', buttons[b].dataset.key === key);
      }
    }
    root.SM.highlightCarPart(key);
  }

  function buildCarTabs() {
    tabsEl = el('part-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    PARTS.forEach(function (part, index) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.textContent = part.label;
      button.dataset.key = part.key;
      if (index === 0) button.classList.add('active');
      button.addEventListener('click', function () { selectPart(part.key); });
      tabsEl.appendChild(button);
    });
  }

  function buildPartPanels() {
    var grid = el('panel-grid');
    if (!grid) return;
    grid.innerHTML = '';
    PARTS.forEach(function (part, index) {
      var card = doc.createElement('div');
      card.className = 'panel fade';
      card.innerHTML =
        '<div class="num">0' + (index + 1) + '</div>' +
        '<h3>' + part.name + '</h3>' +
        '<p>' + part.tech + '</p>' +
        '<div class="tagrow"><span class="tag cyan">Sustainability</span>' +
        '<span class="tag">STEM Outreach</span></div>';
      grid.appendChild(card);
    });
  }

  /* ------------------------------------------------------------- team */

  function buildTeam() {
    var grid = el('team-grid');
    if (!grid || !Data.TEAM) return;
    grid.innerHTML = '';
    Data.TEAM.forEach(function (member) {
      var card = doc.createElement('div');
      card.className = 'member fade';
      card.innerHTML =
        '<div class="avatar"><img src="' + member.img + '" alt="' + member.name +
        '" loading="lazy"></div>' +
        '<h3>' + member.name + '</h3>' +
        '<div class="role">' + member.role + '</div>' +
        '<p class="bio">' + member.bio + '</p>';
      grid.appendChild(card);
    });
  }

  /* -------------------------------------------------------- sponsorship */

  function buildSponsorTable() {
    var tbody = el('sponsor-tbody');
    if (!tbody || !Data.SPONSOR_BENEFITS) return;
    tbody.innerHTML = '';
    Data.SPONSOR_BENEFITS.forEach(function (row) {
      var tr = doc.createElement('tr');
      tr.innerHTML = '<td>' + row.b + '</td>' + row.t.map(function (v) {
        return '<td>' + (v ? '<span class="chk">✓</span>' : '') + '</td>';
      }).join('');
      tbody.appendChild(tr);
    });
  }

  function buildTiers() {
    var list = el('tier-list');
    if (!list || !Data.TIERS) return;
    list.innerHTML = '';
    Data.TIERS.forEach(function (tier) {
      var card = doc.createElement('div');
      card.className = 'tier-card ' + tier.c;
      card.innerHTML = '<div class="tname">' + tier.n + '</div>' +
                       '<div class="tamt">' + tier.a + '</div>';
      list.appendChild(card);
    });
  }

  function buildPartners() {
    var grid = el('partners-grid');
    if (!grid || !Data.PARTNERS) return;
    grid.innerHTML = '';
    Data.PARTNERS.forEach(function (partner) {
      var card = doc.createElement('div');
      card.className = 'partner-card';
      card.innerHTML =
        '<img src="' + partner.img + '" alt="' + partner.name + '" loading="lazy">' +
        '<div class="partner-name">' + partner.name + '</div>' +
        '<div class="partner-role' + (partner.inkind ? ' inkind' : '') + '">' +
        partner.role + '</div>';
      grid.appendChild(card);
    });
  }

  /* -------------------------------------------------------- countdown */

  function startCountdown() {
    var nodes = {
      d: el('dd-days'), h: el('dd-hours'), m: el('dd-mins'), s: el('dd-secs')
    };
    if (!nodes.d || !nodes.h || !nodes.m || !nodes.s) return;
    var foot = el('countdown-foot');
    var target = new Date('2026-08-09T00:00:00+05:30').getTime();

    function pad(n) { return String(n).padStart(2, '0'); }

    function tick() {
      var now = Date.now();
      var diff = target - now;
      if (diff <= 0) {
        nodes.d.textContent = '00';
        nodes.h.textContent = '00';
        nodes.m.textContent = '00';
        nodes.s.textContent = '00';
        if (foot) foot.innerHTML = '<b>RACE DAY.</b> SilverMach is on the grid.';
        return;
      }
      var days = Math.floor(diff / 86400000); diff -= days * 86400000;
      var hours = Math.floor(diff / 3600000); diff -= hours * 3600000;
      var mins = Math.floor(diff / 60000); diff -= mins * 60000;
      var secs = Math.floor(diff / 1000);
      nodes.d.textContent = pad(days);
      nodes.h.textContent = pad(hours);
      nodes.m.textContent = pad(mins);
      nodes.s.textContent = pad(secs);
      root.setTimeout(tick, 1000 - (now % 1000));
    }
    tick();
  }

  /* ------------------------------------------- scroll, fades, backdrop */

  function startScrollEffects() {
    if (typeof root.IntersectionObserver === 'function') {
      var io = new root.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      doc.querySelectorAll('.fade').forEach(function (node) { io.observe(node); });
    } else {
      // Without IntersectionObserver, reveal everything rather than hide it.
      doc.querySelectorAll('.fade').forEach(function (node) { node.classList.add('in'); });
    }

    var progress = el('progress');
    var nav = el('nav');
    root.addEventListener('scroll', function () {
      var top = doc.documentElement.scrollTop;
      var height = doc.documentElement.scrollHeight - root.innerHeight;
      if (progress && height > 0) progress.style.width = (top / height * 100) + '%';
      if (nav) nav.classList.toggle('scrolled', top > 40);
    }, { passive: true });
  }

  function startParticles(linkColour) {
    var canvas = el('bg-canvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var width, height, points;
    var stroke = linkColour || '42,214,238';

    function resize() {
      width = canvas.width = root.innerWidth;
      height = canvas.height = root.innerHeight;
      points = Array.from({ length: Math.min(70, Math.floor(width / 22)) }, function () {
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          r: Math.random() * 1.4 + 0.4
        };
      });
    }
    resize();
    root.addEventListener('resize', resize);

    (function loop() {
      ctx.clearRect(0, 0, width, height);
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fillStyle = 'rgba(150,160,170,.5)';
        ctx.fill();
      }
      for (var a = 0; a < points.length; a++) {
        for (var b = a + 1; b < points.length; b++) {
          var pa = points[a], pb = points[b];
          var dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.strokeStyle = 'rgba(' + stroke + ',' + (0.10 * (1 - dist / 130)) + ')';
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }
      root.requestAnimationFrame(loop);
    })();
  }

  /* ------------------------------------------------------------- boot */

  function init() {
    applyLogos();
    buildCarTabs();
    buildPartPanels();
    buildTeam();
    buildSponsorTable();
    buildTiers();
    buildPartners();
    startCountdown();
    startScrollEffects();
    startParticles(doc.body.dataset.particleColour);
    if (PARTS.length) selectPart(PARTS[0].key);
  }

  root.SM.Site = { init: init, selectPart: selectPart };
  root.selectPart = selectPart;   // preserved for any inline handler

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
