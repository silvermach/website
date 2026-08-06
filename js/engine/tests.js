/* ============================================================================
 * SilverMach Engineering Analysis Suite — tests.js
 * ----------------------------------------------------------------------------
 * Validation suite for the computational engine. Runs in Node (`node js/tests.js`)
 * and in the browser (`SM.Tests.run()` → console table).
 *
 * The physics closed forms are cross-validated against an INDEPENDENT RK4
 * numerical integration of the governing ODEs, so a mistake in the analytic
 * derivation cannot pass silently.
 * ========================================================================== */
(function (root) {
  'use strict';

  // Browser-only: every engine module is loaded ahead of this file by
  // tests.html via ordinary <script> tags, so SM.* is already populated.
  if (!root.SM || !root.SM.Utils) {
    throw new Error('tests.js: load the engine modules before this file.');
  }

  var U = root.SM.Utils;
  var S = root.SM.Statistics;
  var MC = root.SM.MonteCarlo;
  var P = root.SM.Pareto;
  var G = root.SM.Genealogy;
  var C = root.SM.Charts;
  var X = root.SM.Export;

  var results = [];
  var currentGroup = '';

  function group(name) { currentGroup = name; }

  function test(name, fn) {
    try {
      fn();
      results.push({ group: currentGroup, name: name, pass: true, error: null });
    } catch (err) {
      results.push({ group: currentGroup, name: name, pass: false, error: err.message });
    }
  }

  function expectThrows(fn, matcher, label) {
    var threw = false, message = '';
    try { fn(); } catch (e) { threw = true; message = e.message; }
    U.assert(threw, (label || 'expected a throw') + ' but nothing was thrown');
    if (matcher) {
      U.assert(
        matcher instanceof RegExp ? matcher.test(message) : message.indexOf(matcher) !== -1,
        (label || 'throw') + ': message "' + message + '" did not match ' + matcher
      );
    }
  }

  /* ==================================================================== */
  group('utils');

  test('isFiniteNumber rejects NaN, Infinity and non-numbers', function () {
    U.assert(U.isFiniteNumber(1.5), '1.5 should be finite');
    U.assert(!U.isFiniteNumber(NaN), 'NaN must be rejected');
    U.assert(!U.isFiniteNumber(Infinity), 'Infinity must be rejected');
    U.assert(!U.isFiniteNumber(-Infinity), '-Infinity must be rejected');
    U.assert(!U.isFiniteNumber('3'), 'string must be rejected');
    U.assert(!U.isFiniteNumber(null), 'null must be rejected');
    U.assert(!U.isFiniteNumber(undefined), 'undefined must be rejected');
  });

  test('requireNumber enforces bounds with descriptive errors', function () {
    U.assertClose(U.requireNumber('42.5', 'Field'), 42.5, 1e-12);
    expectThrows(function () { U.requireNumber('abc', 'Mass'); }, /Mass must be a finite number/, 'non-numeric');
    expectThrows(function () { U.requireNumber(-1, 'Mass', { min: 0 }); }, /Mass must be at least 0/, 'below min');
    expectThrows(function () { U.requireNumber(0, 'Mass', { min: 0, exclusiveMin: true }); }, /greater than 0/, 'exclusive min');
    expectThrows(function () { U.requireNumber(11, 'Complexity', { max: 10 }); }, /at most 10/, 'above max');
    expectThrows(function () { U.requireNumber(1.5, 'Runs', { integer: true }); }, /must be an integer/, 'non-integer');
  });

  test('quantileSorted matches the type-7 definition', function () {
    var d = new Float64Array([2, 4, 4, 4, 5, 5, 7, 9]);
    U.assertClose(U.quantileSorted(d, 0.00), 2, 1e-12, 'p0');
    U.assertClose(U.quantileSorted(d, 0.25), 4, 1e-12, 'p25');
    U.assertClose(U.quantileSorted(d, 0.50), 4.5, 1e-12, 'p50');
    U.assertClose(U.quantileSorted(d, 0.75), 5.5, 1e-12, 'p75');
    U.assertClose(U.quantileSorted(d, 1.00), 9, 1e-12, 'p100');
  });

  test('sortedCopy does not mutate its input', function () {
    var original = [3, 1, 2];
    var sorted = U.sortedCopy(original);
    U.assert(original[0] === 3 && original[1] === 1 && original[2] === 2, 'input was mutated');
    U.assert(sorted[0] === 1 && sorted[2] === 3, 'copy is not sorted');
  });

  test('uuid produces distinct RFC-4122 v4 strings', function () {
    var re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var seen = {};
    for (var i = 0; i < 500; i++) {
      var id = U.uuid();
      U.assert(re.test(id), 'malformed uuid: ' + id);
      U.assert(!seen[id], 'duplicate uuid generated');
      seen[id] = true;
    }
  });

  test('findInvalidNumbers detects NaN and undefined in nested structures', function () {
    var bad = U.findInvalidNumbers({ a: 1, b: { c: NaN }, d: [1, undefined] });
    U.assert(bad.length === 2, 'expected 2 problems, found ' + bad.length + ': ' + bad.join('; '));
    var clean = U.findInvalidNumbers({ a: 1, b: { c: 2 }, d: [3, 4] });
    U.assert(clean.length === 0, 'clean object flagged: ' + clean.join('; '));
  });

  /* ==================================================================== */
  group('statistics');

  var KNOWN = new Float64Array([2, 4, 4, 4, 5, 5, 7, 9]);

  test('mean, median, min, max, range on a known sample', function () {
    U.assertClose(S.mean(KNOWN), 5, 1e-12, 'mean');
    U.assertClose(S.median(KNOWN), 4.5, 1e-12, 'median');
    U.assertClose(S.min(KNOWN), 2, 1e-12, 'min');
    U.assertClose(S.max(KNOWN), 9, 1e-12, 'max');
    U.assertClose(S.range(KNOWN), 7, 1e-12, 'range');
  });

  test('population and sample variance/stdDev are distinct and correct', function () {
    U.assertClose(S.variance(KNOWN, false), 4, 1e-12, 'population variance');
    U.assertClose(S.stdDev(KNOWN, false), 2, 1e-12, 'population sd');
    U.assertClose(S.variance(KNOWN, true), 32 / 7, 1e-12, 'sample variance');
    U.assertClose(S.stdDev(KNOWN, true), Math.sqrt(32 / 7), 1e-12, 'sample sd');
  });

  test('compensated sum stays exact across many terms', function () {
    var n = 200000;
    var arr = new Float64Array(n);
    for (var i = 0; i < n; i++) arr[i] = 0.1;
    U.assertClose(S.sum(arr), n * 0.1, 1e-6, 'sum of 0.1 x ' + n);
  });

  test('median handles odd-length samples', function () {
    U.assertClose(S.median(new Float64Array([5, 1, 3])), 3, 1e-12);
  });

  test('binned mode locates the densest region', function () {
    // Tight cluster at 10 plus a sparse tail — the mode must sit in the cluster.
    var arr = [];
    for (var i = 0; i < 1000; i++) arr.push(10 + (i % 10) * 0.001);
    for (var j = 0; j < 20; j++) arr.push(50 + j);
    var m = S.modeBinned(new Float64Array(arr));
    U.assert(m.value > 9 && m.value < 12, 'mode ' + m.value + ' is not inside the cluster');
    U.assert(m.count > 100, 'modal bin count too low: ' + m.count);
  });

  test('mode of a degenerate (constant) sample equals that constant', function () {
    var m = S.modeBinned(new Float64Array([7, 7, 7, 7]));
    U.assertClose(m.value, 7, 1e-12);
  });

  test('percentiles are monotone non-decreasing and inside the data range', function () {
    var pcts = S.percentiles(KNOWN, [0, 10, 25, 50, 75, 90, 99, 100]);
    var keys = [0, 10, 25, 50, 75, 90, 99, 100];
    var previous = -Infinity;
    for (var i = 0; i < keys.length; i++) {
      var v = pcts[String(keys[i])];
      U.assert(U.isFiniteNumber(v), 'percentile ' + keys[i] + ' is not finite');
      U.assert(v >= previous - 1e-12, 'percentiles not monotone at ' + keys[i]);
      U.assert(v >= 2 - 1e-12 && v <= 9 + 1e-12, 'percentile ' + keys[i] + ' outside range: ' + v);
      previous = v;
    }
  });

  test('probabilityBelow is exact and bounded to [0,1]', function () {
    U.assertClose(S.probabilityBelow(KNOWN, 5), 4 / 8, 1e-12, 'P(x<5)');
    U.assertClose(S.probabilityBelow(KNOWN, 0), 0, 1e-12, 'P(x<0)');
    U.assertClose(S.probabilityBelow(KNOWN, 100), 1, 1e-12, 'P(x<100)');
  });

  test('CI of the mean narrows as n grows; outcome interval does not', function () {
    var rng1 = MC.createSeededRandom(11);
    var rng2 = MC.createSeededRandom(11);
    var small = new Float64Array(500), large = new Float64Array(50000);
    for (var i = 0; i < small.length; i++) small[i] = MC.normalRandom(1, 0.05, rng1);
    for (var j = 0; j < large.length; j++) large[j] = MC.normalRandom(1, 0.05, rng2);

    var ciSmall = S.confidenceIntervalMean(small);
    var ciLarge = S.confidenceIntervalMean(large);
    var widthSmall = ciSmall.high - ciSmall.low;
    var widthLarge = ciLarge.high - ciLarge.low;
    U.assert(widthLarge < widthSmall, 'CI of the mean did not narrow with n');

    var oiLarge = S.interval95(large);
    U.assert((oiLarge.high - oiLarge.low) > widthLarge * 5,
      'outcome interval should be far wider than the CI of the mean');
    // 95% band of N(1, 0.05) is approximately 1 ± 0.098
    U.assertClose(oiLarge.low, 1 - 1.96 * 0.05, 0.006, 'outcome interval low');
    U.assertClose(oiLarge.high, 1 + 1.96 * 0.05, 0.006, 'outcome interval high');
  });

  test('histogram counts sum to n and density integrates to 1', function () {
    var rng = MC.createSeededRandom(7);
    var data = new Float64Array(20000);
    for (var i = 0; i < data.length; i++) data[i] = MC.normalRandom(0.95, 0.04, rng);
    var h = S.histogram(data);
    var total = 0, integral = 0;
    for (var b = 0; b < h.bins.length; b++) {
      total += h.bins[b].count;
      integral += h.bins[b].density * h.binWidth;
    }
    U.assert(total === data.length, 'bin counts sum to ' + total + ', expected ' + data.length);
    U.assertClose(integral, 1, 1e-9, 'density integral');
  });

  test('empirical CDF is monotone and terminates at exactly 1', function () {
    var rng = MC.createSeededRandom(3);
    var data = new Float64Array(5000);
    for (var i = 0; i < data.length; i++) data[i] = MC.normalRandom(1, 0.1, rng);
    var cdf = S.empiricalCDF(data, 200);
    U.assert(cdf.length > 100, 'too few CDF points');
    var prevX = -Infinity, prevY = -Infinity;
    for (var j = 0; j < cdf.length; j++) {
      U.assert(cdf[j].x >= prevX - 1e-12, 'CDF x not monotone at ' + j);
      U.assert(cdf[j].y >= prevY - 1e-12, 'CDF y not monotone at ' + j);
      U.assert(cdf[j].y >= 0 && cdf[j].y <= 1 + 1e-12, 'CDF y out of [0,1]: ' + cdf[j].y);
      prevX = cdf[j].x; prevY = cdf[j].y;
    }
    U.assertClose(cdf[cdf.length - 1].y, 1, 1e-12, 'CDF endpoint');
  });

  test('erf and normalCDF match reference values to near machine precision', function () {
    U.assert(S.erf(0) === 0, 'erf(0) must be exactly 0, got ' + S.erf(0));
    U.assertClose(S.erf(1), 0.842700792949715, 1e-13, 'erf(1)');
    U.assertClose(S.erf(-1), -0.842700792949715, 1e-13, 'erf(-1)');
    U.assertClose(S.erf(2), 0.995322265018953, 1e-13, 'erf(2)');
    U.assert(S.normalCDF(0, 0, 1) === 0.5, 'Phi(0) must be exactly 0.5');
    U.assertClose(S.normalCDF(1.959963984540054, 0, 1), 0.975, 1e-14, 'Phi(1.96)');
    U.assertClose(S.normalCDF(-1.959963984540054, 0, 1), 0.025, 1e-14, 'Phi(-1.96)');
    U.assertClose(S.normalCDF(-1, 0, 1), 0.158655253931457, 1e-14, 'Phi(-1)');
    U.assertClose(S.normalCDF(3, 0, 1), 0.998650101968370, 1e-14, 'Phi(3)');
    // Hart's algorithm guarantees ~1e-15 ABSOLUTE accuracy, so far out in the
    // tail the meaningful measure is relative error. Assert that directly.
    var tailExpected = 9.865876450376946e-10;
    var tailActual = S.normalCDF(-6, 0, 1);
    var relative = Math.abs(tailActual - tailExpected) / tailExpected;
    U.assert(relative < 1e-8, 'Phi(-6) relative error too large: ' + relative);
    U.assertClose(S.standardNormalCDF(2.5) + S.standardNormalCDF(-2.5), 1, 1e-15, 'symmetry');
    U.assert(S.normalCDF(-40, 0, 1) === 0, 'extreme tail should underflow to exactly 0');
    U.assert(S.normalCDF(40, 0, 1) === 1, 'extreme upper tail should saturate to exactly 1');
  });

  test('normalPDF integrates to 1 and peaks at the mean', function () {
    var mu = 0.95, sigma = 0.04, lo = mu - 8 * sigma, hi = mu + 8 * sigma;
    var steps = 20000, dx = (hi - lo) / steps, integral = 0;
    for (var i = 0; i < steps; i++) {
      integral += S.normalPDF(lo + (i + 0.5) * dx, mu, sigma) * dx;
    }
    U.assertClose(integral, 1, 1e-6, 'PDF integral');
    U.assert(S.normalPDF(mu, mu, sigma) > S.normalPDF(mu + sigma, mu, sigma), 'PDF not peaked at mean');
  });

  test('normalInverseCDF round-trips against normalCDF', function () {
    var ps = [0.001, 0.01, 0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975, 0.99, 0.999];
    for (var i = 0; i < ps.length; i++) {
      var z = S.normalInverseCDF(ps[i]);
      U.assert(U.isFiniteNumber(z), 'probit(' + ps[i] + ') not finite');
      U.assertClose(S.normalCDF(z, 0, 1), ps[i], 1e-13, 'round-trip at p=' + ps[i]);
    }
    U.assertClose(S.normalInverseCDF(0.975), 1.959963984540054, 1e-11, 'probit(0.975)');
    U.assertClose(S.normalInverseCDF(0.5), 0, 1e-12, 'probit(0.5)');
    U.assertClose(S.normalInverseCDF(0.025), -1.959963984540054, 1e-11, 'probit(0.025)');
    U.assert(!U.isFiniteNumber(S.normalInverseCDF(0)), 'probit(0) must not be finite');
    U.assert(!U.isFiniteNumber(S.normalInverseCDF(1)), 'probit(1) must not be finite');
  });

  test('skewness ≈ 0 and excess kurtosis ≈ 0 for a normal sample', function () {
    var rng = MC.createSeededRandom(99);
    var data = new Float64Array(120000);
    for (var i = 0; i < data.length; i++) data[i] = MC.normalRandom(0, 1, rng);
    U.assertClose(S.skewness(data), 0, 0.03, 'skewness');
    U.assertClose(S.kurtosis(data), 0, 0.06, 'excess kurtosis');
  });

  test('summarize returns a complete, finite report', function () {
    var rng = MC.createSeededRandom(5);
    var data = new Float64Array(10000);
    for (var i = 0; i < data.length; i++) data[i] = MC.normalRandom(0.96, 0.05, rng);
    var s = S.summarize(data);
    var invalid = U.findInvalidNumbers({
      mean: s.mean, median: s.median, mode: s.mode, variance: s.variance,
      stdDev: s.stdDev, min: s.min, max: s.max, range: s.range,
      skewness: s.skewness, kurtosis: s.kurtosis,
      percentiles: s.percentiles, ci: s.confidenceIntervalMean,
      oi: s.interval95, probs: s.targetProbabilities
    });
    U.assert(invalid.length === 0, 'non-finite values in summary: ' + invalid.join('; '));
    U.assert(s.count === 10000, 'count mismatch');
    U.assert(s.min <= s.median && s.median <= s.max, 'median outside [min,max]');
    U.assert(s.range >= 0, 'negative range');
  });

  test('summarize rejects an empty sample', function () {
    expectThrows(function () { S.summarize(new Float64Array(0)); }, /empty sample/, 'empty summarize');
  });

  /* ==================================================================== */
  group('monteCarlo: sampling');

  test('normalRandom converges to the requested mean and stdDev', function () {
    var rng = MC.createSeededRandom(2024);
    var n = 200000;
    var data = new Float64Array(n);
    var mu = 60, sd = 2;
    for (var i = 0; i < n; i++) data[i] = MC.normalRandom(mu, sd, rng);

    var sampleMean = S.mean(data);
    var sampleSd = S.stdDev(data, true);
    // Standard error of the mean is sd/sqrt(n) ≈ 0.00447; 5 SE is a safe gate.
    U.assertClose(sampleMean, mu, 5 * sd / Math.sqrt(n), 'sample mean');
    U.assertClose(sampleSd, sd, sd * 0.02, 'sample stdDev');
  });

  test('normalRandom output is normally distributed (tail proportions)', function () {
    var rng = MC.createSeededRandom(4242);
    var n = 200000;
    var within1 = 0, within2 = 0, within3 = 0;
    for (var i = 0; i < n; i++) {
      var z = Math.abs(MC.normalRandom(0, 1, rng));
      if (z <= 1) within1++;
      if (z <= 2) within2++;
      if (z <= 3) within3++;
    }
    U.assertClose(within1 / n, 0.682689, 0.006, '1-sigma proportion');
    U.assertClose(within2 / n, 0.954500, 0.004, '2-sigma proportion');
    U.assertClose(within3 / n, 0.997300, 0.002, '3-sigma proportion');
  });

  test('normalRandom survives an RNG that returns zero (log guard)', function () {
    // First draw is 0 — without the U1>0 guard this yields -Infinity → NaN.
    var queue = [0, 0, 0, 0.5, 0.25];
    var idx = 0;
    var rng = function () { return idx < queue.length ? queue[idx++] : 0.5; };
    var v = MC.normalRandom(10, 3, rng);
    U.assert(U.isFiniteNumber(v), 'guard failed, produced ' + v);
  });

  test('normalRandom with zero stdDev returns the mean exactly', function () {
    U.assertClose(MC.normalRandom(7.5, 0, MC.createSeededRandom(1)), 7.5, 0, 'sd=0');
  });

  test('normalRandom never emits NaN across a large stream', function () {
    var rng = MC.createSeededRandom(31337);
    for (var i = 0; i < 300000; i++) {
      var v = MC.normalRandom(0.15, 0.02, rng);
      if (!U.isFiniteNumber(v)) throw new Error('non-finite sample at i=' + i + ': ' + v);
    }
  });

  test('truncatedNormal respects its bounds and reports clamping', function () {
    var rng = MC.createSeededRandom(8);
    for (var i = 0; i < 20000; i++) {
      var r = MC.truncatedNormal(0.1, 0.5, 0, Infinity, rng);
      U.assert(r.value >= 0, 'sample below lower bound: ' + r.value);
      U.assert(U.isFiniteNumber(r.value), 'non-finite truncated sample');
    }
    // Impossible constraint → must clamp rather than loop forever.
    var impossible = MC.truncatedNormal(5, 1, 100, 200, rng, 20);
    U.assert(impossible.clamped === true, 'expected clamped=true');
    U.assert(impossible.value >= 100 && impossible.value <= 200, 'clamp fell outside bounds');
  });

  test('seeded RNG is reproducible and uniform in [0,1)', function () {
    var a = MC.createSeededRandom(777), b = MC.createSeededRandom(777);
    for (var i = 0; i < 1000; i++) {
      var x = a(), y = b();
      U.assert(x === y, 'seeded streams diverged at ' + i);
      U.assert(x >= 0 && x < 1, 'uniform out of range: ' + x);
    }
    var acc = 0, n = 100000, r = MC.createSeededRandom(12);
    for (var j = 0; j < n; j++) acc += r();
    U.assertClose(acc / n, 0.5, 0.01, 'uniform mean');
  });

  /* ==================================================================== */
  group('monteCarlo: physics');

  /**
   * Independent RK4 reference integrator for  m dv/dt = F - k v²,  dx/dt = v.
   * Used to cross-validate the closed-form solution.
   */
  function rk4Phase(m, F, k, x0, v0, tEnd, steps) {
    var dt = tEnd / steps;
    var x = x0, v = v0;
    function acc(vel) { return (F - k * vel * vel) / m; }
    for (var i = 0; i < steps; i++) {
      var k1v = acc(v),            k1x = v;
      var k2v = acc(v + 0.5 * dt * k1v), k2x = v + 0.5 * dt * k1v;
      var k3v = acc(v + 0.5 * dt * k2v), k3x = v + 0.5 * dt * k2v;
      var k4v = acc(v + dt * k3v),       k4x = v + dt * k3v;
      v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    }
    return { x: x, v: v };
  }

  test('closed-form phase 1 matches RK4 integration', function () {
    var phys = MC.PHYSICS;
    var m = 0.060, F = 9, Cd = 0.28;
    var k = 0.5 * phys.airDensity * Cd * phys.frontalArea;
    var T = phys.thrustDuration;

    var vTerm = Math.sqrt(F / k);
    var alpha = Math.sqrt(F * k) / m;
    var closedX = (m / k) * Math.log(Math.cosh(alpha * T));
    var closedV = vTerm * Math.tanh(alpha * T);

    var ref = rk4Phase(m, F, k, 0, 0, T, 40000);
    U.assertClose(closedX, ref.x, 1e-9, 'burnout distance');
    U.assertClose(closedV, ref.v, 1e-9, 'burnout velocity');
  });

  test('closed-form phase 2 (coast) matches RK4 integration', function () {
    var phys = MC.PHYSICS;
    var m = 0.060, Cd = 0.28;
    var k = 0.5 * phys.airDensity * Cd * phys.frontalArea;
    var v0 = 29.5, tau = 0.6;

    var closedV = v0 / (1 + (k * v0 / m) * tau);
    var closedX = (m / k) * Math.log(1 + (k * v0 / m) * tau);

    var ref = rk4Phase(m, 0, k, 0, v0, tau, 40000);
    U.assertClose(closedX, ref.x, 1e-9, 'coast distance');
    U.assertClose(closedV, ref.v, 1e-9, 'coast velocity');
  });

  test('solveRun total time matches an end-to-end RK4 simulation', function () {
    var phys = MC.PHYSICS;
    var massKg = 0.060, F = 9, Cd = 0.28, L = 20;
    var k = 0.5 * phys.airDensity * Cd * phys.frontalArea;
    var T = phys.thrustDuration;

    var solved = MC.solveRun(massKg, Cd, F, L, phys);

    // Reference: integrate powered phase to T, then coast until x >= L.
    var p1 = rk4Phase(massKg, F, k, 0, 0, T, 40000);
    var dt = 1e-6, x = p1.x, v = p1.v, t = T, guard = 0;
    while (x < L && guard++ < 20000000) {
      var a = (-k * v * v) / massKg;
      v += a * dt;
      x += v * dt;
      t += dt;
    }
    U.assert(x >= L, 'reference integration never reached the finish line');
    U.assertClose(solved.travelTime, t, 2e-5, 'total travel time vs RK4/Euler reference');
    U.assertClose(solved.velocityAtBurnout, p1.v, 1e-9, 'burnout velocity');
    U.assert(!solved.finishedDuringThrust, 'should not finish inside the thrust window here');
  });

  test('drag-free branch reproduces uniform-acceleration kinematics', function () {
    var phys = { airDensity: 1.225, frontalArea: 0.0026, thrustDuration: 0.2 };
    var m = 0.06, F = 9, L = 20;
    var r = MC.solveRun(m, 0, F, L, phys);

    var a = F / m;                       // 150 m/s²
    var xBurn = 0.5 * a * phys.thrustDuration * phys.thrustDuration;  // 3 m
    var vBurn = a * phys.thrustDuration; // 30 m/s
    var expected = phys.thrustDuration + (L - xBurn) / vBurn;

    U.assertClose(r.travelTime, expected, 1e-12, 'drag-free travel time');
    U.assertClose(r.maxVelocity, vBurn, 1e-12, 'drag-free max velocity');
    U.assertClose(r.peakAcceleration, a, 1e-12, 'drag-free peak acceleration');
  });

  test('drag-free short track finishes inside the thrust window', function () {
    var phys = { airDensity: 1.225, frontalArea: 0.0026, thrustDuration: 0.5 };
    var m = 0.06, F = 9, L = 1;
    var r = MC.solveRun(m, 0, F, L, phys);
    var a = F / m;
    U.assert(r.finishedDuringThrust, 'should finish under power on a 1 m track');
    U.assertClose(r.travelTime, Math.sqrt(2 * L / a), 1e-12, 'time from x = ½at²');
  });

  test('with drag, a short track also finishes under power (closed-form inverse)', function () {
    var phys = MC.PHYSICS;
    var r = MC.solveRun(0.060, 0.28, 9, 1.5, phys);
    U.assert(r.finishedDuringThrust, 'expected finish under power');
    U.assert(r.travelTime > 0 && r.travelTime < phys.thrustDuration + 1e-12,
      'travel time ' + r.travelTime + ' should be within the thrust window');
    U.assert(U.isFiniteNumber(r.travelTime), 'non-finite travel time');
  });

  test('drag makes the car slower than the drag-free limit', function () {
    var phys = MC.PHYSICS;
    var withoutDrag = MC.solveRun(0.060, 0, 9, 20, phys);
    var withDrag = MC.solveRun(0.060, 0.28, 9, 20, phys);
    U.assert(withDrag.travelTime > withoutDrag.travelTime,
      'drag did not increase travel time (' + withDrag.travelTime + ' vs ' + withoutDrag.travelTime + ')');
  });

  test('physics is monotone in mass, drag and launch force', function () {
    var phys = MC.PHYSICS;
    var base = MC.solveRun(0.060, 0.28, 9, 20, phys).travelTime;
    U.assert(MC.solveRun(0.070, 0.28, 9, 20, phys).travelTime > base, 'heavier must be slower');
    U.assert(MC.solveRun(0.050, 0.28, 9, 20, phys).travelTime < base, 'lighter must be faster');
    U.assert(MC.solveRun(0.060, 0.40, 9, 20, phys).travelTime > base, 'more drag must be slower');
    U.assert(MC.solveRun(0.060, 0.20, 9, 20, phys).travelTime < base, 'less drag must be faster');
    U.assert(MC.solveRun(0.060, 0.28, 12, 20, phys).travelTime < base, 'more force must be faster');
    U.assert(MC.solveRun(0.060, 0.28, 6, 20, phys).travelTime > base, 'less force must be slower');
    U.assert(MC.solveRun(0.060, 0.28, 9, 25, phys).travelTime > base, 'longer track must take longer');
  });

  test('max velocity occurs at burnout when coasting to the line', function () {
    var r = MC.solveRun(0.060, 0.28, 9, 20, MC.PHYSICS);
    U.assertClose(r.maxVelocity, r.velocityAtBurnout, 1e-12, 'max velocity should equal burnout velocity');
    U.assert(r.peakAcceleration > 0, 'peak acceleration must be positive');
  });

  test('solveRun output is finite across an extreme parameter sweep', function () {
    var phys = MC.PHYSICS;
    var masses = [0.005, 0.03, 0.06, 0.5, 5];
    var drags = [0, 1e-9, 0.05, 0.3, 1.2, 5];
    var forces = [0.5, 2, 9, 40, 200];
    var lengths = [0.5, 5, 20, 100];
    for (var a = 0; a < masses.length; a++) {
      for (var b = 0; b < drags.length; b++) {
        for (var c = 0; c < forces.length; c++) {
          for (var d = 0; d < lengths.length; d++) {
            var r = MC.solveRun(masses[a], drags[b], forces[c], lengths[d], phys);
            var bad = U.findInvalidNumbers({
              travelTime: r.travelTime, maxVelocity: r.maxVelocity,
              peakAcceleration: r.peakAcceleration,
              distanceAtBurnout: r.distanceAtBurnout, velocityAtBurnout: r.velocityAtBurnout
            });
            if (bad.length) {
              throw new Error('non-finite output for m=' + masses[a] + ' Cd=' + drags[b] +
                ' F=' + forces[c] + ' L=' + lengths[d] + ': ' + bad.join('; '));
            }
            U.assert(r.travelTime > 0, 'non-positive travel time');
          }
        }
      }
    }
  });

  /* ==================================================================== */
  group('monteCarlo: simulation');

  var BASE_CONFIG = {
    massMean: 60, massStdDev: 2,
    dragMean: 0.28, dragStdDev: 0.02,
    forceMean: 9, forceStdDev: 0.5,
    reactionMean: 0.15, reactionStdDev: 0.02,
    trackLength: 20, runs: 10000
  };

  test('validateConfig rejects every invalid input with a clear message', function () {
    expectThrows(function () { MC.validateConfig(null); }, /configuration object is required/, 'null config');
    function bad(patch, matcher, label) {
      var cfg = Object.assign({}, BASE_CONFIG, patch);
      expectThrows(function () { MC.validateConfig(cfg); }, matcher, label);
    }
    bad({ massMean: 0 }, /greater than 0/, 'zero mass');
    bad({ massMean: -5 }, /greater than 0/, 'negative mass');
    bad({ massStdDev: -1 }, /at least 0/, 'negative mass sd');
    bad({ dragMean: -0.1 }, /at least 0/, 'negative drag');
    bad({ forceMean: 0 }, /greater than 0/, 'zero force');
    bad({ reactionMean: -0.1 }, /at least 0/, 'negative reaction');
    bad({ trackLength: 0 }, /greater than 0/, 'zero track');
    bad({ runs: 0 }, /at least 1/, 'zero runs');
    bad({ runs: 2.5 }, /must be an integer/, 'fractional runs');
    bad({ massMean: 'abc' }, /finite number/, 'non-numeric mass');
    bad({ massMean: NaN }, /finite number/, 'NaN mass');
  });

  test('validateConfig applies documented physics defaults', function () {
    var cfg = MC.validateConfig(BASE_CONFIG);
    U.assertClose(cfg.physics.airDensity, MC.PHYSICS.airDensity, 1e-12);
    U.assertClose(cfg.physics.frontalArea, MC.PHYSICS.frontalArea, 1e-12);
    U.assertClose(cfg.physics.thrustDuration, MC.PHYSICS.thrustDuration, 1e-12);
  });

  test('runSimulation fills every typed array with finite values', function () {
    var out = MC.runSimulation(BASE_CONFIG, MC.createSeededRandom(1));
    var t = out.trials;
    U.assert(t.count === 10000, 'trial count mismatch: ' + t.count);
    var keys = ['simulationNumber', 'mass', 'drag', 'launchForce', 'reactionTime',
                'acceleration', 'maxVelocity', 'travelTime', 'finishTime'];
    for (var k = 0; k < keys.length; k++) {
      var arr = t[keys[k]];
      U.assert(arr instanceof Float64Array, keys[k] + ' is not a Float64Array');
      U.assert(arr.length === 10000, keys[k] + ' has wrong length');
      for (var i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) throw new Error(keys[k] + '[' + i + '] = ' + arr[i]);
      }
    }
    for (var j = 0; j < 10000; j++) {
      U.assert(t.simulationNumber[j] === j + 1, 'simulation numbering broken at ' + j);
      U.assert(t.mass[j] > 0, 'non-positive sampled mass');
      U.assert(t.drag[j] >= 0, 'negative sampled drag');
      U.assert(t.launchForce[j] > 0, 'non-positive sampled force');
      U.assert(t.reactionTime[j] >= 0, 'negative sampled reaction time');
      U.assertClose(t.finishTime[j], t.travelTime[j] + t.reactionTime[j], 1e-12, 'finish decomposition');
    }
  });

  test('sampled input distributions recover their configured moments', function () {
    var out = MC.runSimulation(
      Object.assign({}, BASE_CONFIG, { runs: 100000 }), MC.createSeededRandom(55));
    var t = out.trials;
    U.assertClose(S.mean(t.mass), 60, 0.05, 'mass mean');
    U.assertClose(S.stdDev(t.mass, true), 2, 0.05, 'mass sd');
    U.assertClose(S.mean(t.drag), 0.28, 0.001, 'drag mean');
    U.assertClose(S.stdDev(t.drag, true), 0.02, 0.001, 'drag sd');
    U.assertClose(S.mean(t.launchForce), 9, 0.01, 'force mean');
    U.assertClose(S.stdDev(t.launchForce, true), 0.5, 0.01, 'force sd');
    U.assertClose(S.mean(t.reactionTime), 0.15, 0.001, 'reaction mean');
    U.assertClose(S.stdDev(t.reactionTime, true), 0.02, 0.001, 'reaction sd');
  });

  test('finish times are physically plausible and internally consistent', function () {
    var out = MC.runSimulation(BASE_CONFIG, MC.createSeededRandom(2));
    var s = S.summarize(out.trials.finishTime);
    U.assert(s.mean > 0.5 && s.mean < 2.0, 'implausible mean finish time: ' + s.mean);
    U.assert(s.min > 0, 'non-positive fastest time');
    U.assert(s.min <= s.mean && s.mean <= s.max, 'mean outside [min,max]');
    U.assert(s.stdDev > 0, 'zero spread despite non-zero input sigmas');
    var probs = s.targetProbabilities;
    U.assert(probs['1'] >= probs['0.95'] && probs['0.95'] >= probs['0.9'],
      'target probabilities must be non-increasing as the threshold tightens');
    var keys = Object.keys(probs);
    for (var i = 0; i < keys.length; i++) {
      U.assert(probs[keys[i]] >= 0 && probs[keys[i]] <= 1, 'probability out of [0,1]');
    }
  });

  test('zero input sigmas produce a deterministic, zero-variance result', function () {
    var cfg = Object.assign({}, BASE_CONFIG, {
      massStdDev: 0, dragStdDev: 0, forceStdDev: 0, reactionStdDev: 0, runs: 500
    });
    var out = MC.runSimulation(cfg, MC.createSeededRandom(9));
    var t = out.trials.finishTime;
    U.assertClose(S.stdDev(t, true), 0, 1e-12, 'variance should vanish');
    var direct = MC.solveRun(0.060, 0.28, 9, 20, MC.PHYSICS);
    U.assertClose(t[0], direct.travelTime + 0.15, 1e-12, 'deterministic value mismatch');
  });

  test('identical seeds give bit-identical results; different seeds differ', function () {
    var a = MC.runSimulation(Object.assign({}, BASE_CONFIG, { runs: 2000 }), MC.createSeededRandom(42));
    var b = MC.runSimulation(Object.assign({}, BASE_CONFIG, { runs: 2000 }), MC.createSeededRandom(42));
    var c = MC.runSimulation(Object.assign({}, BASE_CONFIG, { runs: 2000 }), MC.createSeededRandom(43));
    for (var i = 0; i < 2000; i++) {
      U.assert(a.trials.finishTime[i] === b.trials.finishTime[i], 'same seed diverged at ' + i);
    }
    U.assert(a.trials.finishTime[0] !== c.trials.finishTime[0], 'different seeds produced identical output');
  });

  test('100,000 trials complete quickly enough to stay interactive', function () {
    var started = Date.now();
    var out = MC.runSimulation(
      Object.assign({}, BASE_CONFIG, { runs: 100000 }), MC.createSeededRandom(17));
    var elapsed = Date.now() - started;
    U.assert(out.trials.count === 100000, 'run count mismatch');
    U.assert(elapsed < 4000, '100k trials took ' + elapsed + ' ms (budget 4000 ms)');
    var invalid = 0;
    for (var i = 0; i < 100000; i++) if (!Number.isFinite(out.trials.finishTime[i])) invalid++;
    U.assert(invalid === 0, invalid + ' non-finite finish times');
  });

  test('diagnostics report truncation behaviour honestly', function () {
    var out = MC.runSimulation(BASE_CONFIG, MC.createSeededRandom(6));
    U.assert(out.diagnostics.runs === 10000, 'diagnostics run count');
    U.assert(out.diagnostics.truncationRejections >= 0, 'negative rejection count');
    U.assert(out.diagnostics.clampedTrials === 0,
      'default configuration should never need clamping, saw ' + out.diagnostics.clampedTrials);
    U.assert(out.diagnostics.finishedUnderPowerFraction >= 0 &&
             out.diagnostics.finishedUnderPowerFraction <= 1, 'fraction out of range');
  });

  /* ==================================================================== */
  group('pareto');

  function pd(id, name, mass, drag) {
    return { id: id, name: name, mass: mass, drag: drag };
  }

  test('dominance requires no-worse-everywhere plus strictly-better-somewhere', function () {
    var a = pd('a', 'A', 50, 0.20);
    var b = pd('b', 'B', 60, 0.30);
    var c = pd('c', 'C', 50, 0.20);
    var d = pd('d', 'D', 40, 0.40);
    U.assert(P.dominates(a, b), 'A should dominate B');
    U.assert(!P.dominates(b, a), 'B must not dominate A');
    U.assert(!P.dominates(a, c), 'identical designs cannot dominate each other');
    U.assert(!P.dominates(a, d) && !P.dominates(d, a), 'A and D are mutually non-dominated');
  });

  test('frontier filters dominated designs on a hand-checked set', function () {
    var items = [
      pd('1', 'Light+Draggy', 40, 0.40),
      pd('2', 'Balanced', 50, 0.30),
      pd('3', 'Heavy+Slick', 70, 0.20),
      pd('4', 'Dominated', 60, 0.35),   // worse than Balanced on both
      pd('5', 'AlsoDominated', 80, 0.45) // worse than everything relevant
    ];
    var front = P.frontier(items);
    var names = front.map(function (f) { return f.name; });
    U.assert(front.length === 3, 'expected 3 frontier members, got ' + front.length + ': ' + names.join(','));
    U.assert(names.indexOf('Dominated') === -1, 'a dominated design leaked onto the frontier');
    U.assert(names.indexOf('AlsoDominated') === -1, 'a dominated design leaked onto the frontier');
    U.assert(names.indexOf('Light+Draggy') !== -1 && names.indexOf('Balanced') !== -1 &&
             names.indexOf('Heavy+Slick') !== -1, 'a non-dominated design was excluded');
    // Frontier must be sorted by mass ascending and monotone decreasing in drag.
    for (var i = 1; i < front.length; i++) {
      U.assert(front[i].mass >= front[i - 1].mass, 'frontier not sorted by mass');
      U.assert(front[i].drag <= front[i - 1].drag, 'frontier drag not monotone decreasing');
    }
  });

  test('non-dominated sort assigns consistent, complete ranks', function () {
    var items = [
      pd('1', 'A', 40, 0.40), pd('2', 'B', 50, 0.30), pd('3', 'C', 70, 0.20),
      pd('4', 'D', 60, 0.35), pd('5', 'E', 80, 0.45)
    ];
    var sorted = P.nonDominatedSort(items);
    var counted = 0;
    for (var f = 0; f < sorted.fronts.length; f++) counted += sorted.fronts[f].length;
    U.assert(counted === items.length, 'ranks lost designs: ' + counted + ' of ' + items.length);
    for (var i = 0; i < items.length; i++) {
      var r = sorted.rankById[items[i].id];
      U.assert(Number.isInteger(r) && r >= 0, 'missing rank for ' + items[i].name);
    }
    // Every design in front n>0 must be dominated by at least one in front n-1.
    for (var n = 1; n < sorted.fronts.length; n++) {
      for (var q = 0; q < sorted.fronts[n].length; q++) {
        var dominated = false;
        for (var p = 0; p < sorted.fronts[n - 1].length; p++) {
          if (P.dominates(sorted.fronts[n - 1][p], sorted.fronts[n][q])) { dominated = true; break; }
        }
        U.assert(dominated, sorted.fronts[n][q].name + ' in front ' + n + ' is not dominated by front ' + (n - 1));
      }
    }
  });

  test('single design and empty set are handled', function () {
    U.assert(P.frontier([]).length === 0, 'empty set should yield an empty frontier');
    var one = P.frontier([pd('x', 'X', 10, 0.1)]);
    U.assert(one.length === 1, 'a lone design must be on the frontier');
  });

  test('analyse builds symmetric dominance relations', function () {
    var items = [pd('1', 'A', 40, 0.2), pd('2', 'B', 50, 0.3)];
    var an = P.analyse(items);
    U.assert(an.dominates['1'].indexOf('2') !== -1, 'A should dominate B');
    U.assert(an.dominatedBy['2'].indexOf('1') !== -1, 'B should be dominated by A');
    U.assert(an.frontierIds.has('1') && !an.frontierIds.has('2'), 'frontier membership wrong');
  });

  test('objective values must be finite', function () {
    expectThrows(function () {
      P.frontier([pd('1', 'A', NaN, 0.2), pd('2', 'B', 50, 0.3)]);
    }, /not a finite number/, 'NaN objective');
  });

  /* ==================================================================== */
  group('genealogy');

  function freshStore() { return G.createSeededStore(); }

  test('seeded store builds the expected forest shape', function () {
    var s = freshStore();
    U.assert(s.count() === 5, 'expected 5 seeded designs, got ' + s.count());
    var roots = s.getRoots();
    U.assert(roots.length === 1 && roots[0].name === 'Concept V1', 'root resolution failed');
    var v1 = s.getByName('Concept V1');
    U.assert(s.getChildren(v1.id).length === 2, 'Concept V1 should branch into 2 children');
    var stats = s.graphStats();
    U.assert(stats.maxDepth === 3, 'expected max depth 3, got ' + stats.maxDepth);
    U.assert(stats.branchPoints === 1, 'expected exactly 1 branch point');
  });

  test('depth, ancestry and descendants resolve correctly', function () {
    var s = freshStore();
    var v1 = s.getByName('Concept V1');
    var revA = s.getByName('Aero Rev A');
    var revB = s.getByName('Aero Rev B');
    var final = s.getByName('Final Assembly');

    U.assert(s.getDepth(v1.id) === 0, 'root depth must be 0');
    U.assert(s.getDepth(revA.id) === 1, 'Rev A depth');
    U.assert(s.getDepth(revB.id) === 2, 'Rev B depth');
    U.assert(s.getDepth(final.id) === 3, 'Final depth');

    var chain = s.getAncestry(final.id).map(function (d) { return d.name; });
    U.assert(chain.join(' > ') === 'Concept V1 > Aero Rev A > Aero Rev B > Final Assembly',
      'ancestry wrong: ' + chain.join(' > '));
    U.assert(s.getDescendants(v1.id).length === 4, 'root should have 4 descendants');
    U.assert(s.getDescendants(final.id).length === 0, 'a tip has no descendants');
    U.assert(s.isLeaf(final.id) === true, 'Final Assembly should be a leaf');
    U.assert(s.isLeaf(v1.id) === false, 'root should not be a leaf');
  });

  test('DFS and BFS visit every node exactly once', function () {
    var s = freshStore();
    var dfs = s.traverseDFS();
    var bfs = s.traverseBFS();
    U.assert(dfs.length === 5, 'DFS visited ' + dfs.length);
    U.assert(bfs.length === 5, 'BFS visited ' + bfs.length);
    var seen = {};
    for (var i = 0; i < dfs.length; i++) {
      U.assert(!seen[dfs[i].id], 'DFS visited a node twice');
      seen[dfs[i].id] = true;
    }
    // BFS must be ordered by non-decreasing depth.
    var lastDepth = -1;
    s.traverseBFS(function (node, depth) {
      U.assert(depth >= lastDepth, 'BFS depth decreased');
      lastDepth = depth;
    });
  });

  test('getLevels buckets designs by depth for tree layout', function () {
    var s = freshStore();
    var levels = s.getLevels();
    U.assert(levels.length === 4, 'expected 4 levels, got ' + levels.length);
    U.assert(levels[0].length === 1, 'level 0 should hold 1 design');
    U.assert(levels[1].length === 2, 'level 1 should hold 2 designs');
    var total = levels.reduce(function (acc, l) { return acc + l.length; }, 0);
    U.assert(total === 5, 'levels lost designs');
  });

  test('validation rejects duplicate names (case-insensitively)', function () {
    var s = freshStore();
    expectThrows(function () {
      s.add({ name: 'Aero Rev A', mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3 });
    }, /Duplicate design name/, 'exact duplicate');
    expectThrows(function () {
      s.add({ name: '  aero rev a  ', mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3 });
    }, /Duplicate design name/, 'case/whitespace duplicate');
    U.assert(s.count() === 5, 'a rejected design must not be stored');
  });

  test('validation rejects negative and out-of-range metrics', function () {
    var s = freshStore();
    function bad(patch, matcher, label) {
      var input = Object.assign(
        { name: 'Probe ' + label, mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3 },
        patch);
      expectThrows(function () { s.add(input); }, matcher, label);
    }
    bad({ mass: -1 }, /Mass .* greater than 0/, 'negative mass');
    bad({ mass: 0 }, /Mass .* greater than 0/, 'zero mass');
    bad({ drag: -0.01 }, /drag .* at least 0/, 'negative drag');
    bad({ deflection: -2 }, /deflection .* at least 0/, 'negative deflection');
    bad({ complexity: 0 }, /complexity .* at least 1/, 'complexity below 1');
    bad({ complexity: 11 }, /complexity .* at most 10/, 'complexity above 10');
    bad({ mfgTime: -1 }, /time .* at least 0/, 'negative mfg time');
    bad({ mass: NaN }, /finite number/, 'NaN mass');
    bad({ mass: 'heavy' }, /finite number/, 'non-numeric mass');
    U.assert(s.count() === 5, 'rejected designs were stored anyway');
  });

  test('validation rejects a missing name and a missing parent reference', function () {
    var s = freshStore();
    expectThrows(function () {
      s.add({ name: '   ', mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3 });
    }, /name is required/, 'blank name');
    expectThrows(function () {
      s.add({ name: 'Orphan', parent: 'not-a-real-uuid', mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3 });
    }, /does not exist/, 'dangling parent');
  });

  test('root designs may omit a parent', function () {
    var s = freshStore();
    var d = s.add({ name: 'Second Root', mass: 55, drag: 0.25, deflection: 1.2, complexity: 5, mfgTime: 4 });
    U.assert(d.parent === null, 'parent should be null');
    U.assert(s.getRoots().length === 2, 'expected 2 roots');
    U.assert(s.getDepth(d.id) === 0, 'new root depth should be 0');
  });

  test('re-parenting that would create a cycle is rejected', function () {
    var s = freshStore();
    var v1 = s.getByName('Concept V1');
    var final = s.getByName('Final Assembly');
    expectThrows(function () { s.update(v1.id, { parent: final.id }); },
      /circular lineage/, 'ancestor → descendant cycle');
    expectThrows(function () { s.update(v1.id, { parent: v1.id }); },
      /cannot be its own parent/, 'self parent');
    // The store must be unchanged after a rejected update.
    U.assert(s.getByName('Concept V1').parent === null, 'root parent was mutated by a failed update');
    U.assert(s.getDepth(final.id) === 3, 'depths corrupted by a failed update');
  });

  test('update mutates only the supplied fields', function () {
    var s = freshStore();
    var revB = s.getByName('Aero Rev B');
    var originalMass = revB.mass;
    s.update(revB.id, { drag: 0.21 });
    U.assertClose(s.getById(revB.id).drag, 0.21, 1e-12, 'drag not updated');
    U.assertClose(s.getById(revB.id).mass, originalMass, 1e-12, 'mass should be untouched');
    expectThrows(function () { s.update(revB.id, { mass: -5 }); }, /greater than 0/, 'invalid update');
    U.assertClose(s.getById(revB.id).mass, originalMass, 1e-12, 'failed update leaked a change');
  });

  test('remove re-parents orphans instead of dangling them', function () {
    var s = freshStore();
    var revA = s.getByName('Aero Rev A');
    var revB = s.getByName('Aero Rev B');
    var v1 = s.getByName('Concept V1');
    var res = s.remove(revA.id);
    U.assert(res.reparented.indexOf(revB.id) !== -1, 'child was not re-parented');
    U.assert(s.getById(revB.id).parent === v1.id, 'child should now point at the grandparent');
    U.assert(s.count() === 4, 'count after removal');
    U.assert(s.getById(revA.id) === null, 'removed design still resolvable');
    // No dangling references anywhere.
    var all = s.getAll();
    for (var i = 0; i < all.length; i++) {
      if (all[i].parent !== null) {
        U.assert(s.getById(all[i].parent) !== null, 'dangling parent on ' + all[i].name);
      }
    }
  });

  test('unlimited iterations: 500 designs remain consistent', function () {
    var s = new G.DesignStore();
    var previous = null;
    for (var i = 0; i < 500; i++) {
      previous = s.add({
        name: 'Iteration ' + i,
        parent: previous ? previous.id : null,
        mass: 70 - i * 0.02,
        drag: 0.34 - i * 0.0001,
        deflection: 1.8,
        complexity: 5,
        mfgTime: 4
      });
    }
    U.assert(s.count() === 500, 'count mismatch');
    U.assert(s.getDepth(previous.id) === 499, 'deep chain depth wrong: ' + s.getDepth(previous.id));
    U.assert(s.getAncestry(previous.id).length === 500, 'ancestry length wrong');
    U.assert(s.getLevels().length === 500, 'level count wrong');
  });

  test('deltaFromParent computes signed changes and direction flags', function () {
    var s = freshStore();
    var revA = s.getByName('Aero Rev A');   // mass 63, drag 0.27
    var revB = s.getByName('Aero Rev B');   // mass 60, drag 0.24, complexity 7 (from 6)
    var info = s.deltaFromParent(revB.id);
    U.assert(info.hasParent === true, 'should have a parent');
    U.assert(info.parent.id === revA.id, 'wrong parent resolved');

    var byKey = {};
    for (var i = 0; i < info.deltas.length; i++) byKey[info.deltas[i].key] = info.deltas[i];
    U.assertClose(byKey.mass.delta, -3, 1e-12, 'mass delta');
    U.assert(byKey.mass.improved === true, 'mass reduction should read as improved');
    U.assertClose(byKey.drag.delta, -0.03, 1e-12, 'drag delta');
    U.assert(byKey.drag.improved === true, 'drag reduction should read as improved');
    U.assertClose(byKey.complexity.delta, 1, 1e-12, 'complexity delta');
    U.assert(byKey.complexity.worsened === true, 'complexity increase should read as worsened');
    U.assertClose(byKey.mass.percent, (-3 / 63) * 100, 1e-9, 'percent change');

    var rootInfo = s.deltaFromParent(s.getByName('Concept V1').id);
    U.assert(rootInfo.hasParent === false && rootInfo.deltas.length === 0, 'root should have no deltas');
  });

  test('fleetAverage and normalizedScores are correct and bounded', function () {
    var s = freshStore();
    var avg = s.fleetAverage();
    var expectedMass = (68 + 63 + 60 + 54 + 58) / 5;
    U.assertClose(avg.mass, expectedMass, 1e-12, 'fleet mean mass');

    var lightest = s.getByName('Lightweight Rev A'); // lowest mass in the fleet
    var scores = s.normalizedScores(lightest);
    U.assert(scores.length === G.METRICS.length, 'score length mismatch');
    for (var i = 0; i < scores.length; i++) {
      U.assert(scores[i] >= 0 && scores[i] <= 100, 'score out of [0,100]: ' + scores[i]);
      U.assert(U.isFiniteNumber(scores[i]), 'non-finite score');
    }
    U.assertClose(scores[0], 100, 1e-9, 'lightest design should score 100 on mass');
  });

  test('normalizedScores handles a single-design fleet without dividing by zero', function () {
    var s = new G.DesignStore();
    var only = s.add({ name: 'Solo', mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3 });
    var scores = s.normalizedScores(only);
    for (var i = 0; i < scores.length; i++) {
      U.assert(U.isFiniteNumber(scores[i]), 'non-finite score on degenerate fleet');
      U.assertClose(scores[i], 100, 1e-12, 'degenerate range should score 100');
    }
  });

  test('inspect produces a complete, populated report', function () {
    var s = freshStore();
    var an = P.analyse(s.getAll());
    var all = s.getAll();
    for (var i = 0; i < all.length; i++) {
      var r = s.inspect(all[i].id, an);
      U.assert(typeof r.whyEvolved === 'string' && r.whyEvolved.length > 20,
        'whyEvolved too short for ' + all[i].name);
      U.assert(typeof r.tradeOffSummary === 'string' && r.tradeOffSummary.length > 20,
        'tradeOffSummary too short for ' + all[i].name);
      U.assert(typeof r.recommendation === 'string' && r.recommendation.length > 20,
        'recommendation too short for ' + all[i].name);
      U.assert(typeof r.pareto.status === 'string' && r.pareto.status.length > 10,
        'pareto status missing for ' + all[i].name);
      U.assert(typeof r.notes === 'string' && r.notes.length > 0, 'notes missing');
      U.assert(r.normalizedScores.length === G.METRICS.length, 'radar scores wrong length');
      U.assert(r.fleetNormalizedScores.length === G.METRICS.length, 'fleet scores wrong length');
      U.assert(r.whyEvolved.indexOf('undefined') === -1, 'undefined leaked into whyEvolved');
      U.assert(r.tradeOffSummary.indexOf('undefined') === -1, 'undefined leaked into tradeOffSummary');
      U.assert(r.recommendation.indexOf('undefined') === -1, 'undefined leaked into recommendation');
      U.assert(r.pareto.status.indexOf('undefined') === -1, 'undefined leaked into pareto status');
      U.assert(r.whyEvolved.indexOf('NaN') === -1, 'NaN leaked into whyEvolved');
    }
  });

  test('inspect names the parent and quantifies the change', function () {
    var s = freshStore();
    var an = P.analyse(s.getAll());
    var revB = s.getByName('Aero Rev B');
    var r = s.inspect(revB.id, an);
    U.assert(r.whyEvolved.indexOf('Aero Rev A') !== -1, 'parent not named in whyEvolved');
    U.assert(/3\.00/.test(r.whyEvolved), 'mass delta magnitude missing from narrative');
    U.assert(r.hasParent === true, 'hasParent flag');
    U.assert(r.depth === 2, 'depth in report');
  });

  test('inspect flags a dominated design and recommends deprioritising it', function () {
    var s = new G.DesignStore();
    var good = s.add({ name: 'Good', mass: 50, drag: 0.20, deflection: 1, complexity: 5, mfgTime: 3 });
    var poor = s.add({ name: 'Poor', parent: good.id, mass: 60, drag: 0.30, deflection: 2, complexity: 7, mfgTime: 5 });
    var an = P.analyse(s.getAll());

    var rGood = s.inspect(good.id, an);
    var rPoor = s.inspect(poor.id, an);
    U.assert(rGood.pareto.onFrontier === true, 'Good should be on the frontier');
    U.assert(rPoor.pareto.onFrontier === false, 'Poor should be dominated');
    U.assert(/Dominated \(front 1\)/.test(rPoor.pareto.status), 'front rank missing: ' + rPoor.pareto.status);
    U.assert(rPoor.dominatedMetrics.length > 0, 'dominated metrics not reported');
    U.assert(/Deprioritise/.test(rPoor.recommendation), 'expected a deprioritise recommendation');
    U.assert(/regression/i.test(rPoor.tradeOffSummary), 'expected the trade-off to read as a regression');
  });

  test('inspect describes a genuine trade when metrics move both ways', function () {
    var s = new G.DesignStore();
    var base = s.add({ name: 'Base', mass: 60, drag: 0.30, deflection: 1.5, complexity: 5, mfgTime: 4 });
    var trade = s.add({ name: 'Trade', parent: base.id, mass: 55, drag: 0.30, deflection: 2.2, complexity: 7, mfgTime: 6 });
    var r = s.inspect(trade.id, P.analyse(s.getAll()));
    U.assert(/genuine trade/.test(r.tradeOffSummary), 'expected trade language: ' + r.tradeOffSummary);
    U.assert(/mass/.test(r.tradeOffSummary), 'gained metric not named');
  });

  test('inspect rejects an unknown id', function () {
    var s = freshStore();
    expectThrows(function () { s.inspect('nope', null); }, /Unknown design id/, 'unknown id');
  });

  test('pareto frontier recalculates automatically after a mutation', function () {
    var s = freshStore();
    var before = P.analyse(s.getAll());
    var lightest = s.getByName('Lightweight Rev A');
    U.assert(before.frontierIds.has(lightest.id), 'lightest design should start on the frontier');

    // Add a design that dominates it outright on both objectives.
    s.add({ name: 'Superior', mass: 50, drag: 0.20, deflection: 1.0, complexity: 5, mfgTime: 4 });
    var after = P.analyse(s.getAll());
    U.assert(!after.frontierIds.has(lightest.id), 'frontier did not update after the mutation');
    U.assert(after.frontierIds.has(s.getByName('Superior').id), 'the dominating design is not on the frontier');
  });

  /* ==================================================================== */
  group('charts (pure series builders)');

  var CHART_SAMPLE = (function () {
    var rng = MC.createSeededRandom(64);
    var arr = new Float64Array(20000);
    for (var i = 0; i < arr.length; i++) arr[i] = MC.normalRandom(0.96, 0.05, rng);
    return arr;
  })();

  test('histogramSeries is aligned and finite', function () {
    var s = C.histogramSeries(CHART_SAMPLE);
    U.assert(s.labels.length === s.counts.length, 'label/count length mismatch');
    U.assert(s.counts.length === s.bins.length, 'count/bin length mismatch');
    U.assert(s.binWidth > 0, 'non-positive bin width');
    var total = s.counts.reduce(function (a, b) { return a + b; }, 0);
    U.assert(total === CHART_SAMPLE.length, 'counts do not sum to n');
    var bad = U.findInvalidNumbers({ counts: s.counts, densities: s.densities, binWidth: s.binWidth });
    U.assert(bad.length === 0, 'non-finite values: ' + bad.join('; '));
  });

  test('normalOverlaySeries is scaled to the count histogram', function () {
    var h = C.histogramSeries(CHART_SAMPLE);
    var overlay = C.normalOverlaySeries(CHART_SAMPLE, h.binWidth);
    U.assert(overlay.length > 50, 'overlay too sparse');
    var peak = 0;
    for (var i = 0; i < overlay.length; i++) {
      U.assert(U.isFiniteNumber(overlay[i].x) && U.isFiniteNumber(overlay[i].y), 'non-finite overlay point');
      if (overlay[i].y > peak) peak = overlay[i].y;
    }
    var maxCount = Math.max.apply(null, h.counts);
    // Peak of the fitted curve should land within ~25% of the tallest bar.
    U.assert(Math.abs(peak - maxCount) / maxCount < 0.25,
      'overlay scale mismatch: peak ' + peak.toFixed(1) + ' vs tallest bar ' + maxCount);
  });

  test('normalOverlaySeries degrades safely on zero variance', function () {
    var flat = new Float64Array([1, 1, 1, 1]);
    U.assert(C.normalOverlaySeries(flat, 0.1).length === 0, 'expected an empty overlay');
    U.assert(C.normalDensitySeries(flat).length === 0, 'expected an empty density curve');
  });

  test('cdfSeries returns both curves, monotone and 0→100', function () {
    var s = C.cdfSeries(CHART_SAMPLE);
    U.assert(s.empirical.length > 50, 'empirical CDF too sparse');
    U.assert(s.theoretical.length > 50, 'theoretical CDF missing');
    var prev = -Infinity;
    for (var i = 0; i < s.empirical.length; i++) {
      U.assert(s.empirical[i].y >= prev - 1e-9, 'empirical CDF not monotone');
      U.assert(s.empirical[i].y >= 0 && s.empirical[i].y <= 100, 'CDF outside 0–100');
      prev = s.empirical[i].y;
    }
    U.assertClose(s.empirical[s.empirical.length - 1].y, 100, 1e-9, 'CDF must end at 100%');
  });

  test('qqSeries is monotone with a valid reference line', function () {
    var s = C.qqSeries(CHART_SAMPLE);
    U.assert(s.points.length > 50, 'too few QQ points');
    U.assert(s.refLine.length === 2, 'reference line should have 2 endpoints');
    var prevX = -Infinity, prevY = -Infinity;
    for (var i = 0; i < s.points.length; i++) {
      U.assert(U.isFiniteNumber(s.points[i].x) && U.isFiniteNumber(s.points[i].y), 'non-finite QQ point');
      U.assert(s.points[i].x >= prevX - 1e-9, 'QQ theoretical quantiles not monotone');
      U.assert(s.points[i].y >= prevY - 1e-9, 'QQ observed quantiles not monotone');
      prevX = s.points[i].x; prevY = s.points[i].y;
    }
    // Normally-distributed input ⇒ points should hug the reference line closely.
    var slope = (s.refLine[1].y - s.refLine[0].y) / (s.refLine[1].x - s.refLine[0].x);
    U.assertClose(slope, S.stdDev(CHART_SAMPLE, true), 1e-9, 'reference slope should equal sigma');
  });

  test('paretoSeries tags frontier membership on every point', function () {
    var s = G.createSeededStore();
    var an = P.analyse(s.getAll());
    var series = C.paretoSeries(s.getAll(), an);
    U.assert(series.all.length === 5, 'expected 5 scatter points');
    U.assert(series.frontier.length === an.frontier.length, 'frontier path length mismatch');
    var flagged = 0;
    for (var i = 0; i < series.all.length; i++) {
      var p = series.all[i];
      U.assert(U.isFiniteNumber(p.x) && U.isFiniteNumber(p.y), 'non-finite scatter point');
      U.assert(typeof p.name === 'string' && p.name.length > 0, 'point missing a name');
      U.assert(Number.isInteger(p.front), 'point missing a front rank');
      if (p.onFrontier) flagged++;
    }
    U.assert(flagged === an.frontier.length, 'frontier flag count mismatch');
  });

  test('ChartRegistry tracks and clears instances without Chart.js present', function () {
    var reg = new C.ChartRegistry();
    U.assert(reg.count() === 0, 'registry should start empty');
    U.assert(reg.render('does-not-exist', {}) === null, 'render must return null with no DOM/Chart.js');
    reg.destroy('does-not-exist');   // must not throw
    reg.destroyAll();                // must not throw
    U.assert(reg.count() === 0, 'registry should still be empty');
  });

  test('chart configs are constructed without touching the DOM', function () {
    var configs = [
      C.histogramConfig(CHART_SAMPLE),
      C.bellCurveConfig(CHART_SAMPLE),
      C.cdfConfig(CHART_SAMPLE),
      C.qqConfig(CHART_SAMPLE)
    ];
    for (var i = 0; i < configs.length; i++) {
      U.assert(typeof configs[i].type === 'string', 'config ' + i + ' missing type');
      U.assert(configs[i].data && configs[i].data.datasets.length > 0, 'config ' + i + ' has no datasets');
      for (var d = 0; d < configs[i].data.datasets.length; d++) {
        U.assert(configs[i].data.datasets[d].data.length > 0, 'config ' + i + ' dataset ' + d + ' is empty');
      }
    }
    var store = G.createSeededStore();
    var an = P.analyse(store.getAll());
    var pc = C.paretoConfig(store.getAll(), an, null, null);
    U.assert(pc.data.datasets.length === 2, 'pareto config should have 2 datasets');
    var sel = store.getByName('Final Assembly');
    var rc = C.radarConfig(
      G.METRICS.map(function (m) { return m.label; }),
      sel.name, store.normalizedScores(sel), store.normalizedScores(store.fleetAverage()));
    U.assert(rc.data.labels.length === 5, 'radar should have 5 axes');
    U.assert(rc.data.datasets[0].data.length === 5, 'radar series length');
  });

  /* ==================================================================== */
  group('export');

  test('csvField escapes quotes, commas and newlines per RFC 4180', function () {
    U.assert(X.csvField('plain') === 'plain', 'plain text');
    U.assert(X.csvField('a,b') === '"a,b"', 'comma');
    U.assert(X.csvField('say "hi"') === '"say ""hi"""', 'quotes');
    U.assert(X.csvField('line1\nline2') === '"line1\nline2"', 'newline');
    U.assert(X.csvField(null) === '', 'null');
    U.assert(X.csvField(undefined) === '', 'undefined');
  });

  test('trialsToCSV emits one row per trial with every column', function () {
    var out = MC.runSimulation(
      Object.assign({}, BASE_CONFIG, { runs: 1000 }), MC.createSeededRandom(21));
    var csv = X.trialsToCSV(out.trials);
    var lines = csv.trim().split('\r\n');
    U.assert(lines.length === 1001, 'expected 1 header + 1000 rows, got ' + lines.length);

    var header = lines[0].split(',');
    U.assert(header.length === X.TRIAL_COLUMNS.length,
      'header has ' + header.length + ' columns, expected ' + X.TRIAL_COLUMNS.length);
    U.assert(header.indexOf('mass_g') !== -1, 'mass column missing');
    U.assert(header.indexOf('drag_coefficient') !== -1, 'drag column missing');
    U.assert(header.indexOf('launch_force_n') !== -1, 'force column missing');
    U.assert(header.indexOf('reaction_time_s') !== -1, 'reaction column missing');
    U.assert(header.indexOf('peak_acceleration_ms2') !== -1, 'acceleration column missing');
    U.assert(header.indexOf('max_velocity_ms') !== -1, 'max velocity column missing');
    U.assert(header.indexOf('finish_time_s') !== -1, 'finish time column missing');

    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(',');
      U.assert(cells.length === X.TRIAL_COLUMNS.length, 'row ' + i + ' has ' + cells.length + ' cells');
      for (var c = 0; c < cells.length; c++) {
        U.assert(cells[c] !== '', 'row ' + i + ' column ' + c + ' is empty');
        U.assert(cells[c].indexOf('NaN') === -1, 'NaN in row ' + i);
        U.assert(Number.isFinite(Number(cells[c])), 'unparseable cell "' + cells[c] + '" at row ' + i);
      }
    }
    // Spot-check that the payload really matches the source arrays.
    var firstRow = lines[1].split(',');
    U.assert(Number(firstRow[0]) === 1, 'first simulation number should be 1');
    U.assertClose(Number(firstRow[1]), out.trials.mass[0], 1e-4, 'mass round-trip');
    U.assertClose(Number(firstRow[8]), out.trials.finishTime[0], 1e-6, 'finish time round-trip');
  });

  test('trialsToCSV supports a metadata comment header', function () {
    var out = MC.runSimulation(Object.assign({}, BASE_CONFIG, { runs: 10 }), MC.createSeededRandom(1));
    var csv = X.trialsToCSV(out.trials, { metadata: { runs: 10, track_length_m: 20 } });
    var lines = csv.trim().split('\r\n');
    U.assert(lines[0].indexOf('# runs: 10') === 0, 'metadata line missing: ' + lines[0]);
    U.assert(lines[2].indexOf('simulation') === 0, 'header row misplaced');
    U.assert(lines.length === 13, 'expected 2 metadata + 1 header + 10 rows, got ' + lines.length);
  });

  test('trialsToCSV rejects a malformed trials object', function () {
    expectThrows(function () { X.trialsToCSV(null); }, /trials object is required/, 'null trials');
    expectThrows(function () { X.trialsToCSV({}); }, /trials object is required/, 'empty object');
  });

  test('summaryToCSV includes every required statistic', function () {
    var out = MC.runSimulation(Object.assign({}, BASE_CONFIG, { runs: 2000 }), MC.createSeededRandom(3));
    var csv = X.summaryToCSV(S.summarize(out.trials.finishTime));
    var required = ['mean', 'median', 'mode_binned', 'variance', 'standard_deviation',
                    'minimum', 'maximum', 'range', 'percentile_25', 'percentile_50',
                    'percentile_75', 'percentile_90', 'percentile_99',
                    'ci95_mean_low', 'ci95_mean_high',
                    'outcome_interval95_low', 'outcome_interval95_high',
                    'probability_below_1s', 'probability_below_0.95s', 'probability_below_0.9s'];
    for (var i = 0; i < required.length; i++) {
      U.assert(csv.indexOf(required[i]) !== -1, 'summary CSV missing "' + required[i] + '"');
    }
    U.assert(csv.indexOf('NaN') === -1, 'NaN in summary CSV');
    U.assert(csv.indexOf('undefined') === -1, 'undefined in summary CSV');
  });

  test('designsToCSV resolves parent names and Pareto verdicts', function () {
    var store = G.createSeededStore();
    var an = P.analyse(store.getAll());
    var csv = X.designsToCSV(store.getAll(), store, an);
    var lines = csv.trim().split('\r\n');
    U.assert(lines.length === 6, 'expected 1 header + 5 designs, got ' + lines.length);
    U.assert(lines[0].indexOf('parent_name') !== -1, 'parent_name column missing');
    U.assert(lines[0].indexOf('pareto_optimal') !== -1, 'pareto_optimal column missing');
    U.assert(csv.indexOf('Aero Rev A') !== -1, 'parent name not resolved into the payload');
    U.assert(csv.indexOf('undefined') === -1, 'undefined leaked into the design CSV');
    U.assert(/,yes,|,no,/.test(csv), 'pareto verdict not emitted');
  });

  test('designsToCSV quotes notes containing commas', function () {
    var store = new G.DesignStore();
    store.add({ name: 'Comma Test', mass: 50, drag: 0.2, deflection: 1, complexity: 5, mfgTime: 3,
                notes: 'Reduced mass, increased drag, accepted the trade.' });
    var csv = X.designsToCSV(store.getAll(), store, P.analyse(store.getAll()));
    U.assert(csv.indexOf('"Reduced mass, increased drag, accepted the trade."') !== -1,
      'notes with commas were not quoted');
  });

  test('download helpers no-op safely without a DOM', function () {
    if (X.hasDOM()) return; // browser run — covered by the headless UI pass instead
    U.assert(X.downloadText('x.csv', 'a,b') === false, 'downloadText should report false');
    U.assert(X.chartToPNG(null) === null, 'chartToPNG(null) should be null');
    U.assert(X.downloadChartPNG(null, 'x.png') === false, 'downloadChartPNG should report false');
  });

  test('timestampSlug is filename-safe', function () {
    var slug = X.timestampSlug(new Date(Date.UTC(2026, 7, 4, 15, 42, 7)));
    U.assert(slug === '2026-08-04T15-42-07', 'unexpected slug: ' + slug);
    U.assert(!/[:/\\]/.test(slug), 'slug contains path-unsafe characters');
  });

  /* ==================================================================== */
  group('integration');

  test('full pipeline: simulate → summarise → chart → export with no invalid values', function () {
    var out = MC.runSimulation(BASE_CONFIG, MC.createSeededRandom(2026));
    var summary = S.summarize(out.trials.finishTime);

    var invalid = U.findInvalidNumbers({
      mean: summary.mean, median: summary.median, mode: summary.mode,
      variance: summary.variance, stdDev: summary.stdDev, min: summary.min,
      max: summary.max, range: summary.range, percentiles: summary.percentiles,
      ci: summary.confidenceIntervalMean, oi: summary.interval95,
      probs: summary.targetProbabilities
    });
    U.assert(invalid.length === 0, 'invalid summary values: ' + invalid.join('; '));

    var hist = C.histogramSeries(out.trials.finishTime);
    var overlay = C.normalOverlaySeries(out.trials.finishTime, hist.binWidth);
    var cdf = C.cdfSeries(out.trials.finishTime);
    var qq = C.qqSeries(out.trials.finishTime);
    U.assert(hist.counts.length > 10 && overlay.length > 10 && cdf.empirical.length > 10 && qq.points.length > 10,
      'a chart series came back empty');

    var csv = X.trialsToCSV(out.trials, { metadata: { runs: out.diagnostics.runs } });
    U.assert(csv.indexOf('NaN') === -1 && csv.indexOf('undefined') === -1, 'invalid tokens in CSV');
    U.assert(csv.split('\r\n').length >= 10001, 'CSV row count too low');
  });

  test('full lineage pipeline: store → pareto → inspect → radar → export', function () {
    var store = G.createSeededStore();
    store.add({ name: 'Test Rev C', parent: store.getByName('Final Assembly').id,
                mass: 56, drag: 0.23, deflection: 1.6, complexity: 8, mfgTime: 6.5,
                notes: 'Thinner rib walls with a stiffened spine.' });
    var an = P.analyse(store.getAll());
    U.assert(store.count() === 6, 'design count after append');

    var all = store.getAll();
    for (var i = 0; i < all.length; i++) {
      var report = store.inspect(all[i].id, an);
      var bad = U.findInvalidNumbers({
        depth: report.depth,
        scores: report.normalizedScores,
        fleetScores: report.fleetNormalizedScores,
        deltas: report.deltas.map(function (d) { return { from: d.from, to: d.to, delta: d.delta }; })
      });
      U.assert(bad.length === 0, 'invalid numbers in report for ' + all[i].name + ': ' + bad.join('; '));
    }
    var csv = X.designsToCSV(all, store, an);
    U.assert(csv.split('\r\n').length >= 7, 'design CSV row count');
  });

  /* ==================================================================== */
  /* -------------------------------------------------------- test runner */

  /**
   * Promise-returning tests cannot go through the synchronous `test()` wrapper
   * (it would ignore the promise and record a false pass), so they are declared
   * here and awaited explicitly by `runAsyncTests()`.
   */
  var ASYNC_TESTS = [
    ['integration', 'async runner matches the synchronous runner exactly', function () {
      return MC.runSimulationAsync(
        Object.assign({}, BASE_CONFIG, { runs: 3000 }),
        { rng: MC.createSeededRandom(1234), chunkSize: 700 }
      ).then(function (asyncOut) {
        var syncOut = MC.runSimulation(
          Object.assign({}, BASE_CONFIG, { runs: 3000 }), MC.createSeededRandom(1234));
        for (var i = 0; i < 3000; i++) {
          U.assert(asyncOut.trials.finishTime[i] === syncOut.trials.finishTime[i],
            'async/sync divergence at trial ' + i);
        }
      });
    }],
    ['integration', 'async runner reports monotone progress', function () {
      var seen = [];
      return MC.runSimulationAsync(
        Object.assign({}, BASE_CONFIG, { runs: 2500 }),
        { rng: MC.createSeededRandom(5), chunkSize: 500, onProgress: function (done) { seen.push(done); } }
      ).then(function () {
        U.assert(seen.length >= 5, 'expected ≥5 progress callbacks, got ' + seen.length);
        for (var i = 1; i < seen.length; i++) U.assert(seen[i] > seen[i - 1], 'progress not monotone');
        U.assert(seen[seen.length - 1] === 2500, 'progress did not reach total');
      });
    }],
    ['integration', 'async runner rejects an invalid configuration', function () {
      return MC.runSimulationAsync({ massMean: -1 }).then(
        function () { throw new Error('expected a rejection'); },
        function (err) {
          U.assert(/finite number|greater than 0/.test(err.message), 'wrong rejection: ' + err.message);
        }
      );
    }]
  ];

  function runAsyncTests() {
    return ASYNC_TESTS.reduce(function (chain, entry) {
      return chain.then(function () {
        return Promise.resolve()
          .then(entry[2])
          .then(function () {
            results.push({ group: entry[0], name: entry[1], pass: true, error: null });
          })
          .catch(function (err) {
            results.push({ group: entry[0], name: entry[1], pass: false, error: err.message });
          });
      });
    }, Promise.resolve());
  }

  function report() {
    var failed = results.filter(function (r) { return !r.pass; });
    var lines = [];
    var lastGroup = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.group !== lastGroup) {
        lines.push('');
        lines.push('── ' + r.group);
        lastGroup = r.group;
      }
      lines.push('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '\n        → ' + r.error));
    }
    lines.push('');
    lines.push('════════════════════════════════════════════════════════');
    lines.push('  ' + (results.length - failed.length) + ' passed, ' + failed.length +
               ' failed, ' + results.length + ' total');
    lines.push('════════════════════════════════════════════════════════');
    return { text: lines.join('\n'), failed: failed.length, total: results.length };
  }

  /** Run the async tests then produce the final report. */
  function run() {
    return runAsyncTests().then(report);
  }

  root.SM = root.SM || {};
  root.SM.Tests = {
    results: results,
    group: group,
    test: test,
    runAsyncTests: runAsyncTests,
    report: report,
    run: run
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
