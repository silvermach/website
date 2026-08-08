/* ============================================================================
 * SilverMach — reaction.js
 * ----------------------------------------------------------------------------
 * F1-style start-light reaction test.
 *
 * Self-contained: this file adds behaviour for the #reaction-test card and
 * touches nothing else on the page. It reuses the site's existing card, button
 * and colour conventions rather than introducing a visual system of its own.
 *
 * STATE MACHINE
 *   IDLE        nothing running; the start control is live
 *   COUNTDOWN   lights illuminating one at a time
 *   READY       all five lit, waiting out a randomised hold
 *   REACTION    lights out, clock running, waiting for the input
 *   RESULT      a valid time was measured
 *   FALSE_START the input arrived during COUNTDOWN or READY
 *
 * TIMING
 *   performance.now() is the only clock used for the measurement. It is a
 *   monotonic, sub-millisecond timer that is unaffected by wall-clock changes.
 *   Nothing is inferred from CSS animation duration, frame counts, setInterval
 *   tick counts or rounded seconds: the reaction time is exactly the difference
 *   between two performance.now() readings.
 *
 * TIMER HYGIENE
 *   Every pending timeout id is held in one array and cleared on every state
 *   transition, so a restart can never leave an earlier sequence running. The
 *   input listeners are bound once at init and gated on the current state, so
 *   no listener is ever added twice or left stale between attempts.
 * ========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var card = doc.getElementById('reaction-test');
  if (!card) return;   // page has no reaction test

  var LIGHT_COUNT = 5;
  var LIGHT_INTERVAL_MS = 1000;   // gap between successive lights coming on

  /* Randomised hold AFTER the fifth light, before the lights go out.
     A uniform draw across a wide window: the spread is more than four seconds,
     so the moment cannot be anticipated by counting, and no two attempts share
     a hold time in any useful way. Real F1 uses roughly this range. */
  var HOLD_MIN_MS = 800;
  var HOLD_MAX_MS = 5000;

  var lightsEl = doc.getElementById('rt-lights');
  var statusEl = doc.getElementById('rt-status');
  var resultEl = doc.getElementById('rt-result');
  var startBtn = doc.getElementById('rt-start');
  var padEl = doc.getElementById('rt-pad');

  var state = 'IDLE';
  var timers = [];
  var reactionStart = 0;      // performance.now() reading when the lights went out
  var lights = [];
  var best = null;            // best valid time this session, ms

  /** Clear every pending timeout. Called on every transition, without exception. */
  function clearTimers() {
    for (var i = 0; i < timers.length; i++) root.clearTimeout(timers[i]);
    timers = [];
  }

  /**
   * Schedule work and keep the id only while it is genuinely pending. A timer
   * that has already fired removes its own id, so `timers` always reflects what
   * is actually outstanding rather than accumulating dead handles.
   */
  function later(fn, ms) {
    var id = root.setTimeout(function () {
      var at = timers.indexOf(id);
      if (at !== -1) timers.splice(at, 1);
      fn();
    }, ms);
    timers.push(id);
  }

  function buildLights() {
    lightsEl.innerHTML = '';
    lights = [];
    for (var i = 0; i < LIGHT_COUNT; i++) {
      var light = doc.createElement('span');
      light.className = 'rt-light';
      lightsEl.appendChild(light);
      lights.push(light);
    }
  }

  function setLit(count) {
    for (var i = 0; i < lights.length; i++) {
      lights[i].classList.toggle('lit', i < count);
    }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setResult(text, kind) {
    if (!resultEl) return;
    resultEl.textContent = text || '';
    resultEl.className = 'rt-result' + (kind ? ' ' + kind : '');
  }

  function bestSuffix() {
    return best === null ? '' : '  ·  best this session ' + best.toFixed(1) + ' ms';
  }

  /* ------------------------------------------------------------- states */

  function toIdle() {
    clearTimers();
    state = 'IDLE';
    setLit(0);
    setStatus('Wait for all five lights, then react the instant they go out.');
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
    card.classList.remove('armed');
  }

  function start() {
    if (state === 'COUNTDOWN' || state === 'READY' || state === 'REACTION') return;
    clearTimers();
    state = 'COUNTDOWN';
    setLit(0);
    setResult('');
    setStatus('Lights out — go.');
    startBtn.disabled = true;
    startBtn.textContent = 'Running…';
    card.classList.add('armed');

    for (var i = 1; i <= LIGHT_COUNT; i++) {
      (function (n) {
        later(function () {
          if (state !== 'COUNTDOWN') return;
          setLit(n);
          if (n === LIGHT_COUNT) toReady();
        }, LIGHT_INTERVAL_MS * n);
      })(i);
    }
  }

  function toReady() {
    state = 'READY';
    // Uniform on [HOLD_MIN_MS, HOLD_MAX_MS]. Drawn fresh for every attempt.
    var hold = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    later(function () {
      if (state !== 'READY') return;
      toReaction();
    }, hold);
  }

  function toReaction() {
    state = 'REACTION';
    setLit(0);
    // The measurement clock starts on the same tick that clears the lights.
    reactionStart = root.performance.now();
  }

  function respond() {
    if (state === 'COUNTDOWN' || state === 'READY') {
      falseStart();
      return;
    }
    if (state !== 'REACTION') return;

    // reactionTime = eventTime - reactionStartTime, both from performance.now()
    var elapsed = root.performance.now() - reactionStart;

    clearTimers();
    state = 'RESULT';
    if (best === null || elapsed < best) best = elapsed;
    setResult(elapsed.toFixed(1) + ' ms', 'ok');
    setStatus('Valid start.' + bestSuffix());
    startBtn.disabled = false;
    startBtn.textContent = 'Go Again';
    card.classList.remove('armed');
  }

  function falseStart() {
    clearTimers();
    state = 'FALSE_START';
    setLit(0);
    // No time is computed here. A response before the lights go out has no
    // reaction interval to measure, so recording one would be meaningless and
    // would look like an impossibly fast result.
    setResult('False start', 'bad');
    setStatus('You went before the lights went out — no time recorded.' + bestSuffix());
    startBtn.disabled = false;
    startBtn.textContent = 'Try Again';
    card.classList.remove('armed');
  }

  /* ------------------------------------------------------------- input */

  function onPad(event) {
    // Only the states that expect input do anything; every other state ignores
    // the event entirely, so a stray click can never corrupt a later attempt.
    if (state === 'IDLE' || state === 'RESULT' || state === 'FALSE_START') return;
    event.preventDefault();
    respond();
  }

  function onKey(event) {
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (state === 'IDLE' || state === 'RESULT' || state === 'FALSE_START') return;
    event.preventDefault();
    respond();
  }

  /* -------------------------------------------------------------- boot */

  function init() {
    buildLights();
    // Bound exactly once, here. Nothing is added or removed per attempt, so
    // handlers cannot accumulate across restarts.
    startBtn.addEventListener('click', function () {
      if (state === 'COUNTDOWN' || state === 'READY') { falseStart(); return; }
      start();
    });
    padEl.addEventListener('pointerdown', onPad);
    padEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); respond(); }
    });
    doc.addEventListener('keydown', onKey);
    toIdle();
  }

  root.SM = root.SM || {};
  root.SM.Reaction = {
    init: init,
    start: start,
    respond: respond,
    reset: toIdle,
    getState: function () { return state; },
    // Exposed for verification only; not used by the page itself.
    _config: { LIGHT_COUNT: LIGHT_COUNT, LIGHT_INTERVAL_MS: LIGHT_INTERVAL_MS,
               HOLD_MIN_MS: HOLD_MIN_MS, HOLD_MAX_MS: HOLD_MAX_MS },
    _pendingTimers: function () { return timers.length; }
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
