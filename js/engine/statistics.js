/* ============================================================================
 * SilverMach Engineering Analysis Suite — statistics.js
 * ----------------------------------------------------------------------------
 * Pure descriptive-statistics and distribution engine. Operates on any
 * ArrayLike<number> (including Float64Array). No DOM access, no hardcoded
 * results — every value is derived from the supplied sample.
 * Attaches to `SM.Statistics`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;

  /* ------------------------------------------------------ central tendency */

  function sum(values) {
    // Neumaier compensated summation — keeps precision across 1e5+ terms.
    var s = 0, c = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var t = s + v;
      if (Math.abs(s) >= Math.abs(v)) c += (s - t) + v;
      else c += (v - t) + s;
      s = t;
    }
    return s + c;
  }

  function mean(values) {
    if (values.length === 0) return NaN;
    return sum(values) / values.length;
  }

  /** Median from an already-sorted ascending array. */
  function medianSorted(sorted) {
    var n = sorted.length;
    if (n === 0) return NaN;
    var mid = n >> 1;
    return (n % 2) ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function median(values) {
    return medianSorted(U.sortedCopy(values));
  }

  /**
   * Mode of a continuous distribution, estimated as the midpoint of the
   * highest-frequency bin. A raw value-count mode is meaningless for
   * continuous data (every sample is typically unique), so binned frequency
   * estimation is the correct approach here.
   * @returns {{value:number, binStart:number, binEnd:number, count:number, binCount:number}}
   */
  function modeBinned(values, binCount) {
    var sorted = U.sortedCopy(values);
    var n = sorted.length;
    if (n === 0) return { value: NaN, binStart: NaN, binEnd: NaN, count: 0, binCount: 0 };

    var bins = binCount || U.optimalBinCount(sorted);
    var min = sorted[0], max = sorted[n - 1];
    if (!(max > min)) {
      return { value: min, binStart: min, binEnd: max, count: n, binCount: 1 };
    }
    var width = (max - min) / bins;
    var counts = new Uint32Array(bins);
    for (var i = 0; i < n; i++) {
      var idx = Math.floor((sorted[i] - min) / width);
      if (idx >= bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }
    var best = 0;
    for (var b = 1; b < bins; b++) if (counts[b] > counts[best]) best = b;
    var start = min + best * width;
    return {
      value: start + width / 2,
      binStart: start,
      binEnd: start + width,
      count: counts[best],
      binCount: bins
    };
  }

  /* ----------------------------------------------------------- dispersion */

  /**
   * Variance. Two-pass algorithm (numerically stable).
   * @param {ArrayLike<number>} values
   * @param {boolean} [sample=false]  true → sample variance (n-1 divisor).
   */
  function variance(values, sample) {
    var n = values.length;
    if (n === 0) return NaN;
    var divisor = sample ? n - 1 : n;
    if (divisor <= 0) return 0;
    var m = mean(values);
    var acc = 0, c = 0;
    for (var i = 0; i < n; i++) {
      var d = values[i] - m;
      var term = d * d;
      var t = acc + term;
      if (Math.abs(acc) >= Math.abs(term)) c += (acc - t) + term;
      else c += (term - t) + acc;
      acc = t;
    }
    return (acc + c) / divisor;
  }

  function stdDev(values, sample) {
    var v = variance(values, sample);
    return v >= 0 ? Math.sqrt(v) : NaN;
  }

  function min(values) {
    if (values.length === 0) return NaN;
    var m = values[0];
    for (var i = 1; i < values.length; i++) if (values[i] < m) m = values[i];
    return m;
  }

  function max(values) {
    if (values.length === 0) return NaN;
    var m = values[0];
    for (var i = 1; i < values.length; i++) if (values[i] > m) m = values[i];
    return m;
  }

  function range(values) {
    return max(values) - min(values);
  }

  function skewness(values) {
    var n = values.length;
    if (n < 3) return NaN;
    var m = mean(values), s = stdDev(values, false);
    if (!(s > 0)) return 0;
    var acc = 0;
    for (var i = 0; i < n; i++) acc += Math.pow((values[i] - m) / s, 3);
    return acc / n;
  }

  /** Excess kurtosis (normal distribution → 0). */
  function kurtosis(values) {
    var n = values.length;
    if (n < 4) return NaN;
    var m = mean(values), s = stdDev(values, false);
    if (!(s > 0)) return 0;
    var acc = 0;
    for (var i = 0; i < n; i++) acc += Math.pow((values[i] - m) / s, 4);
    return acc / n - 3;
  }

  /* ---------------------------------------------------------- percentiles */

  function percentile(values, p) {
    return U.quantileSorted(U.sortedCopy(values), p / 100);
  }

  /**
   * Batch percentiles from one sort pass.
   * @param {ArrayLike<number>} values
   * @param {number[]} ps  Percentile points in 0..100.
   * @returns {Object<string, number>} keyed by the percentile as a string.
   */
  function percentiles(values, ps) {
    var sorted = U.sortedCopy(values);
    var out = {};
    for (var i = 0; i < ps.length; i++) {
      out[String(ps[i])] = U.quantileSorted(sorted, ps[i] / 100);
    }
    return out;
  }

  /**
   * 95% confidence interval **of the mean** — the statistical precision of our
   * estimate of the mean, narrowing as n grows: mean ± z · σ/√n.
   */
  function confidenceIntervalMean(values, z) {
    var n = values.length;
    if (n < 2) return { low: NaN, high: NaN, marginOfError: NaN, standardError: NaN };
    var zz = z === undefined ? 1.959963984540054 : z; // two-tailed 95%
    var m = mean(values);
    var se = stdDev(values, true) / Math.sqrt(n);
    var moe = zz * se;
    return { low: m - moe, high: m + moe, marginOfError: moe, standardError: se };
  }

  /**
   * 95% interval **of outcomes** — the empirical 2.5th–97.5th percentile band
   * describing where 95% of individual race results actually land. This is the
   * figure that matters operationally; it does not narrow as n grows.
   */
  function interval95(values) {
    var sorted = U.sortedCopy(values);
    return {
      low: U.quantileSorted(sorted, 0.025),
      high: U.quantileSorted(sorted, 0.975)
    };
  }

  /* -------------------------------------------------- target probabilities */

  /** Empirical P(X < threshold) as a fraction of the sample. */
  function probabilityBelow(values, threshold) {
    var n = values.length;
    if (n === 0) return NaN;
    var count = 0;
    for (var i = 0; i < n; i++) if (values[i] < threshold) count++;
    return count / n;
  }

  function targetProbabilities(values, thresholds) {
    var out = {};
    for (var i = 0; i < thresholds.length; i++) {
      out[String(thresholds[i])] = probabilityBelow(values, thresholds[i]);
    }
    return out;
  }

  /* ------------------------------------------------------- distributions */

  /**
   * Histogram with absolute counts and normalised density.
   * Density is scaled so that Σ(density · binWidth) = 1, making it directly
   * comparable with a probability density function.
   */
  function histogram(values, binCount) {
    var sorted = U.sortedCopy(values);
    var n = sorted.length;
    if (n === 0) return { bins: [], binWidth: 0, binCount: 0, min: NaN, max: NaN, maxCount: 0 };

    var bins = binCount || U.optimalBinCount(sorted);
    var lo = sorted[0], hi = sorted[n - 1];
    if (!(hi > lo)) { hi = lo + 1; bins = 1; }
    var width = (hi - lo) / bins;
    var counts = new Uint32Array(bins);

    for (var i = 0; i < n; i++) {
      var idx = Math.floor((sorted[i] - lo) / width);
      if (idx >= bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }

    var out = new Array(bins);
    var maxCount = 0;
    for (var b = 0; b < bins; b++) {
      if (counts[b] > maxCount) maxCount = counts[b];
      var start = lo + b * width;
      out[b] = {
        index: b,
        start: start,
        end: start + width,
        center: start + width / 2,
        count: counts[b],
        density: counts[b] / (n * width)
      };
    }
    return { bins: out, binWidth: width, binCount: bins, min: lo, max: hi, maxCount: maxCount };
  }

  /** Empirical CDF, thinned to at most `maxPoints` samples for plotting. */
  function empiricalCDF(values, maxPoints) {
    var sorted = U.sortedCopy(values);
    var n = sorted.length;
    if (n === 0) return [];
    var limit = maxPoints || 400;
    var step = Math.max(1, Math.floor(n / limit));
    var pts = [];
    for (var i = 0; i < n; i += step) {
      pts.push({ x: sorted[i], y: (i + 1) / n });
    }
    // Always terminate exactly at 1.0 so the curve is complete.
    if (pts.length === 0 || pts[pts.length - 1].x !== sorted[n - 1]) {
      pts.push({ x: sorted[n - 1], y: 1 });
    } else {
      pts[pts.length - 1].y = 1;
    }
    return pts;
  }

  /* -------------------------------------------------- normal distribution */

  /**
   * Standard normal CDF via Hart's rational approximation (the double-precision
   * formulation popularised by Graeme West). Absolute error < 1e-15 — three
   * orders of magnitude better than the Abramowitz & Stegun series, which
   * matters because the CDF overlay, target probabilities and Q–Q plot are all
   * built on it. Φ(0) evaluates to exactly 0.5.
   */
  function standardNormalCDF(z) {
    if (!U.isFiniteNumber(z)) return NaN;
    var az = Math.abs(z);
    var p;

    if (az > 37) {
      p = 0;
    } else {
      var e = Math.exp(-az * az / 2);
      if (az < 7.07106781186547) {
        var b = 3.52624965998911e-02 * az + 0.700383064443688;
        b = b * az + 6.37396220353165;
        b = b * az + 33.912866078383;
        b = b * az + 112.079291497871;
        b = b * az + 221.213596169931;
        b = b * az + 220.206867912376;

        var c = 8.83883476483184e-02 * az + 1.75566716318264;
        c = c * az + 16.064177579207;
        c = c * az + 86.7807322029461;
        c = c * az + 296.564248779674;
        c = c * az + 637.333633378831;
        c = c * az + 793.826512519948;
        c = c * az + 440.413735824752;

        p = e * b / c;
      } else {
        // Continued-fraction tail for the far reaches of the distribution.
        var d = az + 0.65;
        d = az + 4 / d;
        d = az + 3 / d;
        d = az + 2 / d;
        d = az + 1 / d;
        p = e / (d * 2.506628274631);
      }
    }
    return z > 0 ? 1 - p : p;
  }

  /** Error function, derived from the high-accuracy normal CDF. erf(0) === 0. */
  function erf(x) {
    if (x === 0) return 0;
    return 2 * standardNormalCDF(x * Math.SQRT2) - 1;
  }

  function normalPDF(x, mu, sigma) {
    if (!(sigma > 0)) return NaN;
    var z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }

  function normalCDF(x, mu, sigma) {
    if (!(sigma > 0)) return NaN;
    return standardNormalCDF((x - mu) / sigma);
  }

  /**
   * Inverse standard normal CDF (probit) — Acklam's rational approximation,
   * |ε| < 1.15e-9 across the open interval (0,1).
   */
  function normalInverseCDF(p) {
    if (!(p > 0) || !(p < 1)) return NaN;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var pLow = 0.02425, pHigh = 1 - pLow, q, r, x;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
          (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // One Halley refinement step for full double precision.
    var e = normalCDF(x, 0, 1) - p;
    var u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  /**
   * Fitted normal PDF curve spanning ±`sigmas` standard deviations.
   * @returns {{x:number,y:number}[]}
   */
  function normalCurve(mu, sigma, points, sigmas) {
    var pts = [];
    if (!(sigma > 0)) return pts;
    var n = points || 120;
    var spread = sigmas || 4;
    var lo = mu - spread * sigma, hi = mu + spread * sigma;
    for (var i = 0; i <= n; i++) {
      var x = lo + (hi - lo) * (i / n);
      pts.push({ x: x, y: normalPDF(x, mu, sigma) });
    }
    return pts;
  }

  /** Theoretical normal CDF curve over the same span. */
  function normalCDFCurve(mu, sigma, points, sigmas) {
    var pts = [];
    if (!(sigma > 0)) return pts;
    var n = points || 120;
    var spread = sigmas || 4;
    var lo = mu - spread * sigma, hi = mu + spread * sigma;
    for (var i = 0; i <= n; i++) {
      var x = lo + (hi - lo) * (i / n);
      pts.push({ x: x, y: normalCDF(x, mu, sigma) });
    }
    return pts;
  }

  /**
   * Normal Q–Q plot points: theoretical quantile vs observed quantile.
   * Uses the Blom plotting position (i-0.375)/(n+0.25).
   * @returns {{points:{x:number,y:number}[], refLine:{x:number,y:number}[]}}
   */
  function qqPoints(values, maxPoints) {
    var sorted = U.sortedCopy(values);
    var n = sorted.length;
    if (n < 2) return { points: [], refLine: [] };

    var mu = mean(sorted), sigma = stdDev(sorted, true);
    var limit = maxPoints || 300;
    var step = Math.max(1, Math.floor(n / limit));
    var pts = [];
    for (var i = 0; i < n; i += step) {
      var p = (i + 1 - 0.375) / (n + 0.25);
      var z = normalInverseCDF(p);
      if (U.isFiniteNumber(z)) pts.push({ x: z, y: sorted[i] });
    }
    // Reference line y = mu + sigma * z over the plotted z-range.
    var refLine = [];
    if (pts.length > 1 && sigma > 0) {
      var zLo = pts[0].x, zHi = pts[pts.length - 1].x;
      refLine = [
        { x: zLo, y: mu + sigma * zLo },
        { x: zHi, y: mu + sigma * zHi }
      ];
    }
    return { points: pts, refLine: refLine };
  }

  /* ------------------------------------------------------------- summary */

  /**
   * Full descriptive summary of a sample. Everything here is computed from
   * the data — no constants, no placeholders.
   * @param {ArrayLike<number>} values
   * @param {{thresholds?:number[], percentilePoints?:number[]}} [opts]
   */
  function summarize(values, opts) {
    opts = opts || {};
    var thresholds = opts.thresholds || [1.00, 0.95, 0.90];
    var pPoints = opts.percentilePoints || [25, 50, 75, 90, 99];

    var n = values.length;
    if (n === 0) {
      throw new RangeError('Cannot summarise an empty sample.');
    }

    var sorted = U.sortedCopy(values);
    var m = mean(sorted);
    var sd = stdDev(sorted, true);
    var modeInfo = modeBinned(sorted);

    var pct = {};
    for (var i = 0; i < pPoints.length; i++) {
      pct[String(pPoints[i])] = U.quantileSorted(sorted, pPoints[i] / 100);
    }

    return {
      count: n,
      mean: m,
      median: medianSorted(sorted),
      mode: modeInfo.value,
      modeDetail: modeInfo,
      variance: variance(sorted, true),
      stdDev: sd,
      min: sorted[0],
      max: sorted[n - 1],
      range: sorted[n - 1] - sorted[0],
      skewness: skewness(sorted),
      kurtosis: kurtosis(sorted),
      percentiles: pct,
      confidenceIntervalMean: confidenceIntervalMean(sorted),
      interval95: {
        low: U.quantileSorted(sorted, 0.025),
        high: U.quantileSorted(sorted, 0.975)
      },
      targetProbabilities: targetProbabilities(sorted, thresholds)
    };
  }

  root.SM = root.SM || {};
  root.SM.Statistics = {
    sum: sum,
    mean: mean,
    median: median,
    medianSorted: medianSorted,
    modeBinned: modeBinned,
    variance: variance,
    stdDev: stdDev,
    min: min,
    max: max,
    range: range,
    skewness: skewness,
    kurtosis: kurtosis,
    percentile: percentile,
    percentiles: percentiles,
    confidenceIntervalMean: confidenceIntervalMean,
    interval95: interval95,
    probabilityBelow: probabilityBelow,
    targetProbabilities: targetProbabilities,
    histogram: histogram,
    empiricalCDF: empiricalCDF,
    erf: erf,
    standardNormalCDF: standardNormalCDF,
    normalPDF: normalPDF,
    normalCDF: normalCDF,
    normalInverseCDF: normalInverseCDF,
    normalCurve: normalCurve,
    normalCDFCurve: normalCDFCurve,
    qqPoints: qqPoints,
    summarize: summarize
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
