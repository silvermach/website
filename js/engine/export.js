/* ============================================================================
 * SilverMach Engineering Analysis Suite — export.js
 * ----------------------------------------------------------------------------
 * Serialisation is pure and unit-testable; only the download helpers touch the
 * DOM, and those degrade safely when no document is present (e.g. under Node).
 * Attaches to `SM.Export`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;

  /* --------------------------------------------------------------- CSV */

  /** RFC-4180 field escaping. */
  function csvField(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvRow(fields) {
    var out = new Array(fields.length);
    for (var i = 0; i < fields.length; i++) out[i] = csvField(fields[i]);
    return out.join(',');
  }

  var TRIAL_COLUMNS = [
    { key: 'simulationNumber', header: 'simulation',          decimals: 0 },
    { key: 'mass',             header: 'mass_g',              decimals: 4 },
    { key: 'drag',             header: 'drag_coefficient',    decimals: 6 },
    { key: 'launchForce',      header: 'launch_force_n',      decimals: 5 },
    { key: 'reactionTime',     header: 'reaction_time_s',     decimals: 6 },
    { key: 'acceleration',     header: 'peak_acceleration_ms2', decimals: 5 },
    { key: 'maxVelocity',      header: 'max_velocity_ms',     decimals: 5 },
    { key: 'travelTime',       header: 'travel_time_s',       decimals: 6 },
    { key: 'finishTime',       header: 'finish_time_s',       decimals: 6 }
  ];

  /**
   * Serialise every trial row — all four sampled inputs and all computed
   * outputs. No sampling, no truncation: one line per simulation run.
   *
   * @param {Object} trials   Result store from SM.MonteCarlo
   * @param {{metadata?:Object}} [opts]  Optional `# key: value` comment header.
   * @returns {string}
   */
  function trialsToCSV(trials, opts) {
    opts = opts || {};
    if (!trials || typeof trials.count !== 'number') {
      throw new TypeError('A Monte Carlo trials object is required.');
    }
    var lines = [];

    if (opts.metadata) {
      var keys = Object.keys(opts.metadata);
      for (var k = 0; k < keys.length; k++) {
        lines.push('# ' + keys[k] + ': ' + String(opts.metadata[keys[k]]));
      }
    }

    lines.push(csvRow(TRIAL_COLUMNS.map(function (c) { return c.header; })));

    var n = trials.count;
    for (var i = 0; i < n; i++) {
      var fields = new Array(TRIAL_COLUMNS.length);
      for (var c2 = 0; c2 < TRIAL_COLUMNS.length; c2++) {
        var col = TRIAL_COLUMNS[c2];
        var arr = trials[col.key];
        var v = arr ? arr[i] : NaN;
        fields[c2] = U.isFiniteNumber(v) ? v.toFixed(col.decimals) : '';
      }
      lines.push(csvRow(fields));
    }
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Serialise the descriptive statistics summary as a two-column CSV.
   * @param {Object} summary  Result of SM.Statistics.summarize
   */
  function summaryToCSV(summary) {
    if (!summary) throw new TypeError('A statistics summary is required.');
    var rows = [['metric', 'value', 'unit']];
    rows.push(['trials', summary.count, 'runs']);
    rows.push(['mean', summary.mean.toFixed(6), 's']);
    rows.push(['median', summary.median.toFixed(6), 's']);
    rows.push(['mode_binned', summary.mode.toFixed(6), 's']);
    rows.push(['variance', summary.variance.toExponential(6), 's^2']);
    rows.push(['standard_deviation', summary.stdDev.toFixed(6), 's']);
    rows.push(['minimum', summary.min.toFixed(6), 's']);
    rows.push(['maximum', summary.max.toFixed(6), 's']);
    rows.push(['range', summary.range.toFixed(6), 's']);
    rows.push(['skewness', summary.skewness.toFixed(6), '-']);
    rows.push(['excess_kurtosis', summary.kurtosis.toFixed(6), '-']);

    var pKeys = Object.keys(summary.percentiles);
    for (var p = 0; p < pKeys.length; p++) {
      rows.push(['percentile_' + pKeys[p], summary.percentiles[pKeys[p]].toFixed(6), 's']);
    }
    rows.push(['ci95_mean_low', summary.confidenceIntervalMean.low.toFixed(6), 's']);
    rows.push(['ci95_mean_high', summary.confidenceIntervalMean.high.toFixed(6), 's']);
    rows.push(['ci95_mean_standard_error', summary.confidenceIntervalMean.standardError.toExponential(6), 's']);
    rows.push(['outcome_interval95_low', summary.interval95.low.toFixed(6), 's']);
    rows.push(['outcome_interval95_high', summary.interval95.high.toFixed(6), 's']);

    var tKeys = Object.keys(summary.targetProbabilities);
    for (var t = 0; t < tKeys.length; t++) {
      rows.push([
        'probability_below_' + tKeys[t] + 's',
        (summary.targetProbabilities[tKeys[t]] * 100).toFixed(4),
        '%'
      ]);
    }

    var lines = [];
    for (var r = 0; r < rows.length; r++) lines.push(csvRow(rows[r]));
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Serialise the design lineage, including resolved parent names and the
   * live Pareto verdict for each design.
   */
  function designsToCSV(designs, store, paretoAnalysis) {
    var header = ['id', 'name', 'parent_id', 'parent_name', 'depth', 'mass_g',
                  'drag_cd', 'deflection_mm', 'complexity_10', 'mfg_time_hrs',
                  'pareto_front', 'pareto_optimal', 'timestamp_iso', 'notes'];
    var lines = [csvRow(header)];

    for (var i = 0; i < designs.length; i++) {
      var d = designs[i];
      var parent = store ? store.getParent(d.id) : null;
      var front = paretoAnalysis && paretoAnalysis.rankById[d.id] !== undefined
        ? paretoAnalysis.rankById[d.id] : '';
      var optimal = paretoAnalysis ? (paretoAnalysis.frontierIds.has(d.id) ? 'yes' : 'no') : '';
      lines.push(csvRow([
        d.id,
        d.name,
        d.parent || '',
        parent ? parent.name : '',
        store ? store.getDepth(d.id) : '',
        d.mass.toFixed(4),
        d.drag.toFixed(6),
        d.deflection.toFixed(4),
        d.complexity.toFixed(2),
        d.mfgTime.toFixed(4),
        front,
        optimal,
        new Date(d.timestamp).toISOString(),
        d.notes
      ]));
    }
    return lines.join('\r\n') + '\r\n';
  }

  /* ---------------------------------------------------------- downloads */

  function hasDOM() {
    return typeof root.document !== 'undefined' && !!root.document.createElement;
  }

  /** Trigger a browser download of arbitrary text content. */
  function downloadText(filename, text, mimeType) {
    if (!hasDOM()) return false;
    var blob = new Blob([text], { type: (mimeType || 'text/csv') + ';charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = root.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    root.document.body.appendChild(a);
    a.click();
    // Revoke on the next tick so Safari has time to start the transfer.
    setTimeout(function () {
      root.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
    return true;
  }

  /**
   * Extract a chart as a PNG data URL using Chart.js's native exporter, with a
   * solid background so the transparent canvas doesn't render as black in
   * image viewers.
   *
   * @param {Object} chart  Chart.js instance
   * @param {string} [background]
   * @returns {string|null} data URL
   */
  function chartToPNG(chart, background) {
    if (!chart) return null;
    if (typeof chart.toBase64Image === 'function') {
      // Chart.js ≥ 3 supports (type, quality) and honours a fill plugin, but the
      // simplest reliable approach is to composite onto an opaque canvas.
      var src = chart.canvas;
      if (!hasDOM() || !src) return chart.toBase64Image();
      var out = root.document.createElement('canvas');
      out.width = src.width;
      out.height = src.height;
      var ctx = out.getContext('2d');
      ctx.fillStyle = background || '#0f1216';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0);
      return out.toDataURL('image/png');
    }
    return null;
  }

  /**
   * Trigger a download from any data: URL (PNG, SVG, anything).
   * Shared by the chart and lineage-tree exporters.
   */
  function downloadDataURL(filename, dataUrl) {
    if (!hasDOM() || !dataUrl) return false;
    var a = root.document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.style.display = 'none';
    root.document.body.appendChild(a);
    a.click();
    setTimeout(function () { root.document.body.removeChild(a); }, 0);
    return true;
  }

  /** Download an SVG source string as a standalone .svg file. */
  function downloadSVG(filename, svgText) {
    return downloadText(filename, svgText, 'image/svg+xml');
  }

  /** Download a Chart.js instance as a PNG file. */
  function downloadChartPNG(chart, filename, background) {
    if (!hasDOM()) return false;
    var dataUrl = chartToPNG(chart, background);
    if (!dataUrl) return false;
    return downloadDataURL(filename, dataUrl);
  }

  /**
   * Download several charts in sequence. Browsers rate-limit rapid programmatic
   * downloads, so each is spaced apart.
   * @param {{chart:Object, filename:string}[]} items
   * @param {number} [spacingMs=350]
   * @returns {Promise<number>} count dispatched
   */
  function downloadChartsPNG(items, spacingMs) {
    if (!hasDOM()) return Promise.resolve(0);
    var gap = spacingMs === undefined ? 350 : spacingMs;
    var dispatched = 0;
    return items.reduce(function (chain, item, index) {
      return chain.then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            if (downloadChartPNG(item.chart, item.filename)) dispatched++;
            resolve();
          }, index === 0 ? 0 : gap);
        });
      });
    }, Promise.resolve()).then(function () { return dispatched; });
  }

  /** Timestamp suffix for filenames: 2026-08-04T15-42-07. */
  function timestampSlug(date) {
    var d = date || new Date();
    return d.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  }

  root.SM = root.SM || {};
  root.SM.Export = {
    TRIAL_COLUMNS: TRIAL_COLUMNS,
    csvField: csvField,
    csvRow: csvRow,
    trialsToCSV: trialsToCSV,
    summaryToCSV: summaryToCSV,
    designsToCSV: designsToCSV,
    downloadText: downloadText,
    downloadDataURL: downloadDataURL,
    downloadSVG: downloadSVG,
    chartToPNG: chartToPNG,
    downloadChartPNG: downloadChartPNG,
    downloadChartsPNG: downloadChartsPNG,
    timestampSlug: timestampSlug,
    hasDOM: hasDOM
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
