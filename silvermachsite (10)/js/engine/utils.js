/* ============================================================================
 * SilverMach Engineering Analysis Suite — utils.js
 * ----------------------------------------------------------------------------
 * Environment-agnostic helpers. No DOM access. Safe to load in Node or browser.
 * Attaches to the global namespace `SM.Utils`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var EPSILON = 1e-12;

  /* ---------------------------------------------------------------- numbers */

  /** True only for real, finite numbers (rejects NaN, Infinity, non-numbers). */
  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  /**
   * Coerce a value to a finite number or throw a descriptive error.
   * @param {*} v
   * @param {string} label   Field name used in the error message.
   * @param {{min?:number,max?:number,integer?:boolean,exclusiveMin?:boolean}} [opts]
   * @returns {number}
   */
  function requireNumber(v, label, opts) {
    opts = opts || {};
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!isFiniteNumber(n)) {
      throw new RangeError(label + ' must be a finite number (received: ' + String(v) + ').');
    }
    if (opts.integer && !Number.isInteger(n)) {
      throw new RangeError(label + ' must be an integer (received: ' + n + ').');
    }
    if (opts.min !== undefined) {
      if (opts.exclusiveMin ? n <= opts.min : n < opts.min) {
        throw new RangeError(
          label + ' must be ' + (opts.exclusiveMin ? 'greater than ' : 'at least ') +
          opts.min + ' (received: ' + n + ').'
        );
      }
    }
    if (opts.max !== undefined && n > opts.max) {
      throw new RangeError(label + ' must be at most ' + opts.max + ' (received: ' + n + ').');
    }
    return n;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Fixed-decimal formatting that never emits "NaN" or "-0". */
  function fmt(v, decimals) {
    if (!isFiniteNumber(v)) return '—';
    var d = decimals === undefined ? 3 : decimals;
    var s = v.toFixed(d);
    return s === (-0).toFixed(d) ? (0).toFixed(d) : s;
  }

  /** Thousands-separated integer formatting. */
  function fmtInt(v) {
    if (!isFiniteNumber(v)) return '—';
    return Math.round(v).toLocaleString('en-US');
  }

  function fmtPercent(fraction, decimals) {
    if (!isFiniteNumber(fraction)) return '—';
    return fmt(fraction * 100, decimals === undefined ? 2 : decimals) + '%';
  }

  /* -------------------------------------------------------------------- ids */

  /** RFC-4122 v4 UUID, using the strongest source available. */
  function uuid() {
    var c = root.crypto || root.msCrypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
      var b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
             hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
             hex.slice(10, 16).join('');
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ---------------------------------------------------------------- binning */

  /**
   * Freedman–Diaconis optimal bin count, falling back to Sturges when the
   * interquartile range degenerates (e.g. heavily tied data).
   * @param {ArrayLike<number>} sorted  Ascending-sorted samples.
   * @returns {number} bin count >= 1
   */
  function optimalBinCount(sorted) {
    var n = sorted.length;
    if (n < 2) return 1;
    var min = sorted[0], max = sorted[n - 1];
    var range = max - min;
    if (!(range > 0)) return 1;

    var q1 = quantileSorted(sorted, 0.25);
    var q3 = quantileSorted(sorted, 0.75);
    var iqr = q3 - q1;

    var binWidth = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0;
    var count = binWidth > 0
      ? Math.ceil(range / binWidth)
      : Math.ceil(Math.log2(n) + 1); // Sturges

    return clamp(Math.round(count), 1, 500);
  }

  /**
   * Linear-interpolation quantile on an ascending-sorted array.
   * Matches the "type 7" definition used by R's default and NumPy.
   */
  function quantileSorted(sorted, p) {
    var n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    var pos = clamp(p, 0, 1) * (n - 1);
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * Ascending numeric sort into a *new* Float64Array (leaves input untouched).
   * @param {ArrayLike<number>} values
   * @returns {Float64Array}
   */
  function sortedCopy(values) {
    var out = new Float64Array(values.length);
    for (var i = 0; i < values.length; i++) out[i] = values[i];
    out.sort();
    return out;
  }

  /* ---------------------------------------------------------------- asserts */

  function AssertionError(message) {
    var e = new Error(message);
    e.name = 'AssertionError';
    return e;
  }

  function assert(condition, message) {
    if (!condition) throw AssertionError(message || 'Assertion failed');
  }

  function assertClose(actual, expected, tolerance, message) {
    var tol = tolerance === undefined ? 1e-9 : tolerance;
    if (!isFiniteNumber(actual)) {
      throw AssertionError((message || 'assertClose') + ': actual is not finite (' + actual + ')');
    }
    var diff = Math.abs(actual - expected);
    if (diff > tol) {
      throw AssertionError(
        (message || 'assertClose') + ': expected ' + expected + ' ± ' + tol +
        ', got ' + actual + ' (Δ=' + diff + ')'
      );
    }
  }

  /** Deep scan for NaN / undefined / null leaking into a result structure. */
  function findInvalidNumbers(obj, path, acc) {
    path = path || '$';
    acc = acc || [];
    if (obj === null || obj === undefined) {
      acc.push(path + ' is ' + String(obj));
      return acc;
    }
    if (typeof obj === 'number') {
      if (!Number.isFinite(obj)) acc.push(path + ' = ' + String(obj));
      return acc;
    }
    if (ArrayBuffer.isView(obj) || Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) findInvalidNumbers(obj[i], path + '[' + i + ']', acc);
      return acc;
    }
    if (typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        findInvalidNumbers(obj[keys[k]], path + '.' + keys[k], acc);
      }
    }
    return acc;
  }

  root.SM = root.SM || {};
  root.SM.Utils = {
    EPSILON: EPSILON,
    isFiniteNumber: isFiniteNumber,
    requireNumber: requireNumber,
    clamp: clamp,
    lerp: lerp,
    fmt: fmt,
    fmtInt: fmtInt,
    fmtPercent: fmtPercent,
    uuid: uuid,
    optimalBinCount: optimalBinCount,
    quantileSorted: quantileSorted,
    sortedCopy: sortedCopy,
    assert: assert,
    assertClose: assertClose,
    AssertionError: AssertionError,
    findInvalidNumbers: findInvalidNumbers
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
