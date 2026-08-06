/* ============================================================================
 * SilverMach Engineering Analysis Suite — charts.js
 * ----------------------------------------------------------------------------
 * Two clearly separated layers:
 *
 *   1. SERIES BUILDERS — pure functions turning simulation/design data into
 *      plot-ready {x,y} arrays. No Chart.js, no DOM, fully unit-testable.
 *   2. ChartRegistry   — the only place a Chart.js instance is created. Every
 *      render destroys the previous instance bound to that canvas id before
 *      constructing a new one, so repeated runs cannot leak charts or stack
 *      duplicate animation/resize handlers.
 *
 * Attaches to `SM.Charts`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;
  var S = root.SM.Statistics;

  /* Brand palette — mirrors the site's CSS custom properties exactly. */
  var THEME = {
    cyan: '#2ad6ee',
    cyanSoft: '#7eebfa',
    cyanFill: 'rgba(42,214,238,0.55)',
    cyanWash: 'rgba(42,214,238,0.15)',
    silver: '#d2d7dd',
    silverDim: '#868c95',
    silverWash: 'rgba(210,215,221,0.08)',
    gold: '#e8b64c',
    grid: 'rgba(31,36,43,0.6)',
    panel: '#0f1216'
  };

  /* ------------------------------------------------------ series builders */

  /**
   * Histogram bars plus the matching bin metadata.
   * @returns {{labels:string[], counts:number[], densities:number[], bins:Object[], binWidth:number}}
   */
  function histogramSeries(values, binCount) {
    var h = S.histogram(values, binCount);
    var labels = [], counts = [], densities = [];
    for (var i = 0; i < h.bins.length; i++) {
      labels.push(h.bins[i].center.toFixed(3));
      counts.push(h.bins[i].count);
      densities.push(h.bins[i].density);
    }
    return {
      labels: labels,
      counts: counts,
      densities: densities,
      bins: h.bins,
      binWidth: h.binWidth,
      min: h.min,
      max: h.max
    };
  }

  /**
   * Fitted normal curve, scaled to overlay a *count* histogram:
   *   expectedCount(x) = pdf(x) · binWidth · n
   * so the curve is directly comparable with the bars rather than
   * living on an unrelated axis.
   * @returns {{x:number,y:number}[]}
   */
  function normalOverlaySeries(values, binWidth, points) {
    var mu = S.mean(values);
    var sigma = S.stdDev(values, true);
    var n = values.length;
    if (!(sigma > 0) || !(binWidth > 0)) return [];
    var curve = S.normalCurve(mu, sigma, points || 140, 4);
    var out = new Array(curve.length);
    for (var i = 0; i < curve.length; i++) {
      out[i] = { x: curve[i].x, y: curve[i].y * binWidth * n };
    }
    return out;
  }

  /** Normal PDF curve in density units (for a standalone bell-curve panel). */
  function normalDensitySeries(values, points) {
    var mu = S.mean(values);
    var sigma = S.stdDev(values, true);
    if (!(sigma > 0)) return [];
    return S.normalCurve(mu, sigma, points || 140, 4);
  }

  /**
   * Empirical CDF as percentages, plus the theoretical normal CDF for contrast.
   * @returns {{empirical:{x:number,y:number}[], theoretical:{x:number,y:number}[]}}
   */
  function cdfSeries(values, maxPoints) {
    var emp = S.empiricalCDF(values, maxPoints || 400);
    var empPct = new Array(emp.length);
    for (var i = 0; i < emp.length; i++) empPct[i] = { x: emp[i].x, y: emp[i].y * 100 };

    var mu = S.mean(values);
    var sigma = S.stdDev(values, true);
    var theo = [];
    if (sigma > 0) {
      var curve = S.normalCDFCurve(mu, sigma, 140, 4);
      for (var j = 0; j < curve.length; j++) theo.push({ x: curve[j].x, y: curve[j].y * 100 });
    }
    return { empirical: empPct, theoretical: theo };
  }

  /** Normal Q–Q series with its 45° reference line. */
  function qqSeries(values, maxPoints) {
    return S.qqPoints(values, maxPoints || 300);
  }

  /**
   * Pareto scatter series: every design plus the frontier path.
   * @param {Object[]} designs
   * @param {Object} paretoAnalysis  from SM.Pareto.analyse
   */
  function paretoSeries(designs, paretoAnalysis) {
    var all = [], front = [];
    for (var i = 0; i < designs.length; i++) {
      var d = designs[i];
      var point = {
        x: d.mass,
        y: d.drag,
        id: d.id,
        name: d.name,
        deflection: d.deflection,
        complexity: d.complexity,
        mfgTime: d.mfgTime,
        onFrontier: paretoAnalysis ? paretoAnalysis.frontierIds.has(d.id) : false,
        front: paretoAnalysis ? paretoAnalysis.rankById[d.id] : null
      };
      all.push(point);
    }
    if (paretoAnalysis) {
      for (var f = 0; f < paretoAnalysis.frontier.length; f++) {
        var fd = paretoAnalysis.frontier[f];
        front.push({
          x: fd.mass, y: fd.drag, id: fd.id, name: fd.name,
          deflection: fd.deflection, complexity: fd.complexity, mfgTime: fd.mfgTime,
          onFrontier: true, front: 0
        });
      }
    }
    return { all: all, frontier: front };
  }

  /* ---------------------------------------------------------- registry */

  /**
   * @constructor
   * Owns every Chart.js instance created by the suite, keyed by canvas id.
   */
  function ChartRegistry() {
    this.instances = new Map();
  }

  ChartRegistry.prototype.available = function () {
    return typeof root.Chart !== 'undefined';
  };

  /** Fully tear down the chart bound to `canvasId`, if any. */
  ChartRegistry.prototype.destroy = function (canvasId) {
    var existing = this.instances.get(canvasId);
    if (existing) {
      try { existing.destroy(); } catch (e) { /* already detached */ }
      this.instances.delete(canvasId);
    }
    // Defensive: Chart.js keeps its own registry keyed by canvas, and a chart
    // created outside this registry (or surviving a hot reload) would otherwise
    // block re-initialisation on the same canvas.
    if (this.available() && typeof root.Chart.getChart === 'function') {
      var orphan = root.Chart.getChart(canvasId);
      if (orphan) {
        try { orphan.destroy(); } catch (e) { /* no-op */ }
      }
    }
  };

  ChartRegistry.prototype.destroyAll = function () {
    var ids = Array.from(this.instances.keys());
    for (var i = 0; i < ids.length; i++) this.destroy(ids[i]);
  };

  ChartRegistry.prototype.count = function () {
    return this.instances.size;
  };

  /**
   * Create (or recreate) a chart on `canvasId`.
   * @returns {Object|null} the Chart instance, or null when unavailable.
   */
  ChartRegistry.prototype.render = function (canvasId, config) {
    if (!this.available()) return null;
    var canvas = root.document ? root.document.getElementById(canvasId) : null;
    if (!canvas) return null;

    this.destroy(canvasId);
    var chart = new root.Chart(canvas, config);
    this.instances.set(canvasId, chart);
    return chart;
  };

  ChartRegistry.prototype.get = function (canvasId) {
    return this.instances.get(canvasId) || null;
  };

  /* ------------------------------------------------------ chart configs */

  function baseScales(xTitle, yTitle) {
    return {
      x: {
        type: 'linear',
        title: { display: !!xTitle, text: xTitle || '', color: THEME.silverDim },
        ticks: { color: THEME.silverDim, maxTicksLimit: 7 },
        grid: { color: THEME.grid }
      },
      y: {
        title: { display: !!yTitle, text: yTitle || '', color: THEME.silverDim },
        ticks: { color: THEME.silverDim },
        grid: { color: THEME.grid }
      }
    };
  }

  var ANIM = { duration: 850, easing: 'easeOutQuart' };

  /** Histogram of finish times with the fitted normal overlaid on the same axis. */
  function histogramConfig(values) {
    var series = histogramSeries(values);
    var overlay = normalOverlaySeries(values, series.binWidth);
    return {
      type: 'bar',
      data: {
        datasets: [
          {
            type: 'bar',
            label: 'Trials',
            data: series.bins.map(function (b) { return { x: b.center, y: b.count }; }),
            backgroundColor: THEME.cyanFill,
            borderColor: THEME.cyan,
            borderWidth: 1,
            borderRadius: 2,
            barPercentage: 1,
            categoryPercentage: 1,
            order: 2
          },
          {
            type: 'line',
            label: 'Fitted normal',
            data: overlay,
            borderColor: THEME.gold,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            fill: false,
            order: 1
          }
        ]
      },
      options: {
        animation: ANIM,
        parsing: false,
        normalized: true,
        plugins: {
          legend: { labels: { color: THEME.silverDim, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: function (items) { return items.length ? 'Finish ≈ ' + U.fmt(items[0].parsed.x, 3) + ' s' : ''; },
              label: function (ctx) {
                return ctx.dataset.label + ': ' + U.fmt(ctx.parsed.y, ctx.datasetIndex === 0 ? 0 : 1);
              }
            }
          }
        },
        scales: baseScales('Finish Time (s)', 'Trial Count')
      }
    };
  }

  /** Standalone normal-density panel with the sampled density for comparison. */
  function bellCurveConfig(values) {
    var series = histogramSeries(values);
    var density = normalDensitySeries(values);
    return {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Fitted normal PDF',
            data: density,
            borderColor: THEME.cyanSoft,
            backgroundColor: THEME.cyanWash,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            fill: true,
            order: 1
          },
          {
            label: 'Sampled density',
            data: series.bins.map(function (b) { return { x: b.center, y: b.density }; }),
            borderColor: THEME.silverDim,
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderDash: [4, 3],
            pointRadius: 0,
            tension: 0.2,
            fill: false,
            order: 2
          }
        ]
      },
      options: {
        animation: ANIM,
        parsing: false,
        normalized: true,
        plugins: {
          legend: { labels: { color: THEME.silverDim, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: function (items) { return items.length ? U.fmt(items[0].parsed.x, 3) + ' s' : ''; },
              label: function (ctx) { return ctx.dataset.label + ': ' + U.fmt(ctx.parsed.y, 3); }
            }
          }
        },
        scales: baseScales('Finish Time (s)', 'Probability Density')
      }
    };
  }

  /** Empirical CDF against the theoretical normal CDF. */
  function cdfConfig(values) {
    var series = cdfSeries(values);
    var scales = baseScales('Finish Time (s)', 'Cumulative Probability');
    scales.y.min = 0;
    scales.y.max = 100;
    scales.y.ticks = {
      color: THEME.silverDim,
      callback: function (v) { return v + '%'; }
    };
    return {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Empirical CDF',
            data: series.empirical,
            borderColor: THEME.silver,
            backgroundColor: THEME.silverWash,
            borderWidth: 2,
            pointRadius: 0,
            stepped: false,
            fill: true,
            order: 1
          },
          {
            label: 'Normal CDF',
            data: series.theoretical,
            borderColor: THEME.cyan,
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            order: 2
          }
        ]
      },
      options: {
        animation: ANIM,
        parsing: false,
        normalized: true,
        plugins: {
          legend: { labels: { color: THEME.silverDim, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: function (items) { return items.length ? U.fmt(items[0].parsed.x, 3) + ' s' : ''; },
              label: function (ctx) { return ctx.dataset.label + ': ' + U.fmt(ctx.parsed.y, 2) + '%'; }
            }
          }
        },
        scales: scales
      }
    };
  }

  /** Normal Q–Q plot: straight line ⇒ the output really is normally distributed. */
  function qqConfig(values) {
    var series = qqSeries(values);
    return {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Observed quantiles',
            data: series.points,
            backgroundColor: THEME.cyan,
            pointRadius: 2.5,
            order: 2
          },
          {
            label: 'Normal reference',
            data: series.refLine,
            type: 'line',
            borderColor: THEME.gold,
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            order: 1
          }
        ]
      },
      options: {
        animation: ANIM,
        parsing: false,
        normalized: true,
        plugins: {
          legend: { labels: { color: THEME.silverDim, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return 'z = ' + U.fmt(ctx.parsed.x, 2) + ' → ' + U.fmt(ctx.parsed.y, 4) + ' s';
              }
            }
          }
        },
        scales: baseScales('Theoretical Quantile (z)', 'Observed Finish Time (s)')
      }
    };
  }

  /**
   * Pareto scatter. `onSelect` receives a design id when a point is clicked.
   */
  function paretoConfig(designs, paretoAnalysis, onSelect, selectedId) {
    var series = paretoSeries(designs, paretoAnalysis);

    function tooltipLines(ctx) {
      var p = ctx.raw;
      return [
        p.name,
        'Mass: ' + U.fmt(p.x, 2) + ' g',
        'Drag: Cd ' + U.fmt(p.y, 3),
        'Deflection: ' + U.fmt(p.deflection, 2) + ' mm',
        'Complexity: ' + U.fmt(p.complexity, 1) + '/10',
        'Build time: ' + U.fmt(p.mfgTime, 2) + ' hrs',
        p.onFrontier ? 'Pareto optimal (front 0)' : 'Dominated (front ' + p.front + ')'
      ];
    }

    return {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'All designs',
            data: series.all,
            pointRadius: function (ctx) {
              return ctx.raw && ctx.raw.id === selectedId ? 9 : 6;
            },
            pointHoverRadius: 10,
            backgroundColor: function (ctx) {
              if (!ctx.raw) return THEME.silverDim;
              if (ctx.raw.id === selectedId) return '#ffffff';
              return ctx.raw.onFrontier ? THEME.cyan : THEME.silverDim;
            },
            borderColor: function (ctx) {
              return ctx.raw && ctx.raw.id === selectedId ? THEME.cyan : 'transparent';
            },
            borderWidth: 2,
            order: 1
          },
          {
            label: 'Pareto frontier',
            data: series.frontier,
            showLine: true,
            borderColor: THEME.cyan,
            borderWidth: 2,
            backgroundColor: THEME.cyan,
            pointRadius: 0,
            tension: 0,
            order: 2
          }
        ]
      },
      options: {
        animation: ANIM,
        onClick: function (evt, elements) {
          if (typeof onSelect !== 'function' || !elements || !elements.length) return;
          var el = elements[0];
          var point = this.data.datasets[el.datasetIndex].data[el.index];
          if (point && point.id) onSelect(point.id);
        },
        onHover: function (evt, elements) {
          if (evt && evt.native && evt.native.target) {
            evt.native.target.style.cursor = elements && elements.length ? 'pointer' : 'default';
          }
        },
        plugins: {
          legend: { labels: { color: THEME.silverDim, boxWidth: 12 } },
          tooltip: { callbacks: { label: tooltipLines } }
        },
        scales: baseScales('Mass (g)', 'Drag Coefficient (Cd)')
      }
    };
  }

  /** Radar of selected design vs fleet average, normalised 0–100 (higher = better). */
  function radarConfig(labels, selectedName, selectedScores, fleetScores) {
    return {
      type: 'radar',
      data: {
        labels: labels,
        datasets: [
          {
            label: selectedName,
            data: selectedScores,
            borderColor: THEME.cyan,
            backgroundColor: 'rgba(42,214,238,0.22)',
            pointBackgroundColor: THEME.cyan,
            borderWidth: 2
          },
          {
            label: 'Fleet Average',
            data: fleetScores,
            borderColor: THEME.silverDim,
            backgroundColor: 'rgba(134,140,149,0.12)',
            pointBackgroundColor: THEME.silverDim,
            borderWidth: 1.5
          }
        ]
      },
      options: {
        animation: ANIM,
        plugins: {
          legend: { labels: { color: THEME.silverDim, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + U.fmt(ctx.parsed.r, 1) + ' / 100';
              }
            }
          }
        },
        scales: {
          r: {
            angleLines: { color: THEME.grid },
            grid: { color: THEME.grid },
            pointLabels: { color: THEME.silverDim, font: { size: 11 } },
            ticks: { display: false },
            suggestedMin: 0,
            suggestedMax: 100
          }
        }
      }
    };
  }

  root.SM = root.SM || {};
  root.SM.Charts = {
    THEME: THEME,
    histogramSeries: histogramSeries,
    normalOverlaySeries: normalOverlaySeries,
    normalDensitySeries: normalDensitySeries,
    cdfSeries: cdfSeries,
    qqSeries: qqSeries,
    paretoSeries: paretoSeries,
    ChartRegistry: ChartRegistry,
    histogramConfig: histogramConfig,
    bellCurveConfig: bellCurveConfig,
    cdfConfig: cdfConfig,
    qqConfig: qqConfig,
    paretoConfig: paretoConfig,
    radarConfig: radarConfig
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
