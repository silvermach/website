/* ============================================================================
 * SilverMach — greenmach.js
 * ----------------------------------------------------------------------------
 * Behaviour unique to greenmach.html:
 *   • animated statistic counters (150+ students, 3 partners, 5 SDGs, 35–45 g)
 *   • SDG flip cards
 *   • the sustainability-lens interactive car viewer
 *
 * The car copy is NOT duplicated here. It reads SM.Data.PARTS — the same source
 * index.html uses — so the five information categories exist in exactly one
 * place. The previous version carried a second, hand-copied GM_PARTS array that
 * would silently drift out of sync with the main page.
 *
 * Site chrome (logos, nav, countdown, fades, particle backdrop) comes from
 * js/site.js, which is shared by both pages.
 * ======================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var PARTS = (root.SM && root.SM.Data && root.SM.Data.PARTS) || [];

  function el(id) { return doc.getElementById(id); }

  /* ------------------------------------------------ animated statistics */

  /**
   * Count each `.counter` up to its data-target when it scrolls into view.
   * Falls back to writing the final value immediately when
   * IntersectionObserver is unavailable, so the numbers are never left at 0.
   */
  function startCounters() {
    var counters = doc.querySelectorAll('.counter');
    if (!counters.length) return;

    function animate(node) {
      var target = Number(node.dataset.target);
      var suffix = node.dataset.suffix || '';
      if (!Number.isFinite(target)) return;
      var duration = 1400;
      var started = null;

      function step(timestamp) {
        if (started === null) started = timestamp;
        var progress = Math.min(1, (timestamp - started) / duration);
        var eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(target * eased) + suffix;
        if (progress < 1) root.requestAnimationFrame(step);
      }
      root.requestAnimationFrame(step);
    }

    if (typeof root.IntersectionObserver !== 'function') {
      for (var i = 0; i < counters.length; i++) {
        counters[i].textContent = counters[i].dataset.target +
          (counters[i].dataset.suffix || '');
      }
      return;
    }

    // threshold 0 fires as soon as any part of the tile enters the viewport.
    // A higher threshold (the previous value was 0.4) can never fire for an
    // element that is taller than the space available to it, which would leave
    // the statistic frozen at 0 on short viewports.
    var observer = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        animate(entry.target);
      });
    }, { threshold: 0 });

    for (var c = 0; c < counters.length; c++) observer.observe(counters[c]);
  }

  /* ------------------------------------------------------- SDG flip cards */

  /**
   * Bound once here rather than via an inline onclick per card, and made
   * keyboard accessible: the cards convey real content, so they must be
   * reachable without a pointer.
   */
  function bindSdgCards() {
    var cards = doc.querySelectorAll('.sdg-card');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', 'Flip card for more detail');
        card.removeAttribute('onclick');

        function toggle() { card.classList.toggle('flipped'); }
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        });
      })(cards[i]);
    }
  }

  /* ------------------------------------------- interactive car (GreenMach) */

  var gmTabs = null;

  function selectGreenMachPart(key) {
    var part = null;
    for (var i = 0; i < PARTS.length; i++) {
      if (PARTS[i].key === key) { part = PARTS[i]; break; }
    }
    if (!part) return;

    var fields = {
      'gmpd-name': part.name,
      'gmpd-sub': part.sub,
      'gmpd-tech': part.tech,
      'gmpd-manufacture': part.manufacture,
      'gmpd-sustain': part.sustain,
      'gmpd-material': part.material,
      'gmpd-outreach': part.outreach
    };
    Object.keys(fields).forEach(function (id) {
      var node = el(id);
      if (node) node.textContent = fields[id];
    });

    if (gmTabs) {
      for (var b = 0; b < gmTabs.children.length; b++) {
        gmTabs.children[b].classList.toggle('active',
          gmTabs.children[b].dataset.key === key);
      }
    }

    // Mirrors what site.js already does on index.html, so the 3D viewer and the
    // tab strip stay in step. No-op when the viewer has not booted.
    if (root.SM && typeof root.SM.highlightCarPart === 'function') {
      root.SM.highlightCarPart(key);
    }
  }

  function buildCarTabs() {
    gmTabs = el('gmcar-tabs');
    if (!gmTabs || !PARTS.length) return;
    gmTabs.innerHTML = '';
    PARTS.forEach(function (part, index) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.textContent = part.label;
      button.dataset.key = part.key;
      if (index === 0) button.classList.add('active');
      button.addEventListener('click', function () { selectGreenMachPart(part.key); });
      gmTabs.appendChild(button);
    });
    selectGreenMachPart(PARTS[0].key);
  }

  /* ------------------------------------------------------------- boot */

  function init() {
    startCounters();
    bindSdgCards();
    buildCarTabs();
  }

  root.SM = root.SM || {};
  root.SM.GreenMach = { init: init, selectPart: selectGreenMachPart };
  root.selectGMPart = selectGreenMachPart;   // preserved for any inline handler

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
