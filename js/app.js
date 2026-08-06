/* ============================================================================
 * SilverMach Engineering Analysis Suite — app.js  (UI binding only)
 * ----------------------------------------------------------------------------
 * Contains no mathematics. It reads the existing inputs, calls the validated
 * engine modules, and writes results into the existing cards, canvases and
 * tables. Every displayed value comes from the engine.
 *
 * FIXES IN THIS REVISION
 * ----------------------
 * 1. Chart.js is now awaited through SM.LibLoader before any chart is built.
 *    Previously the code assumed `window.Chart` existed at init; the CDN URL
 *    404'd, `available()` returned false, all six charts silently no-op'd, and
 *    the one warning written to #mc-status was immediately overwritten by the
 *    simulation's own status message — a completely silent failure.
 * 2. A dedicated, persistent banner (#eng-alert) reports library failures, so a
 *    missing dependency can never again be invisible.
 * 3. Charts are created only once their panel is actually visible, and a
 *    ResizeObserver re-sizes them the moment a hidden panel gains layout.
 *    A canvas inside `display:none` has zero width; Chart.js locks onto that
 *    zero and never repaints, which is why the lineage charts were blank even
 *    when Chart.js did load.
 * 4. The genealogy tree is delegated to SM.TreeRenderer, which lays out from the
 *    graph arithmetically instead of measuring hidden DOM.
 * 5. Every visual has its own export control, so each download is a direct
 *    user gesture. Browsers suppress rapid programmatic downloads after the
 *    first, which made the old "export all charts" button unreliable.
 *
 * The markup's inline `onclick` attributes are preserved, so the global thin
 * wrappers at the bottom are the only bridge from HTML to this controller.
 * Because those attributes are declarative they cannot accumulate duplicates;
 * the only programmatic listeners attach once, behind `_listenersBound`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;
  var S = root.SM.Statistics;
  var MC = root.SM.MonteCarlo;
  var P = root.SM.Pareto;
  var G = root.SM.Genealogy;
  var CH = root.SM.Charts;
  var EX = root.SM.Export;
  var TR = root.SM.TreeRenderer;
  var LL = root.SM.LibLoader;

  var TARGET_THRESHOLDS = [1.00, 0.95, 0.90];
  var PERCENTILE_POINTS = [25, 50, 75, 90, 99];

  var SIM_CHART_IDS = ['chart-hist', 'chart-bell', 'chart-cdf', 'chart-qq'];
  var LINEAGE_CHART_IDS = ['chart-pareto', 'chart-radar'];

  var App = {
    state: {
      run: null,
      summary: null,
      store: null,
      pareto: null,
      selectedDesignId: null,
      running: false,
      activeTool: 'monte',
      chartLibReady: false,
      chartLibError: null,
      treeSvg: null
    },
    charts: null,
    _listenersBound: false,
    _resizeObserver: null,
    _observedBoxes: null
  };

  /* ------------------------------------------------------------ helpers */

  function el(id) { return root.document.getElementById(id); }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }

  function readInput(id, label, opts) {
    var node = el(id);
    if (!node) throw new ReferenceError('Missing input element: #' + id);
    return U.requireNumber(node.value, label, opts);
  }

  /** Persistent banner for dependency/environment problems. */
  function setAlert(message, kind) {
    var node = el('eng-alert');
    if (!node) return;
    if (!message) {
      node.textContent = '';
      node.style.display = 'none';
      node.className = 'eng-alert';
      return;
    }
    node.textContent = message;
    node.className = 'eng-alert' + (kind ? ' ' + kind : '');
    node.style.display = 'block';
  }

  /** True when an element has a real layout box (not inside display:none). */
  function isLaidOut(node) {
    return !!(node && node.getClientRects && node.getClientRects().length > 0 &&
              node.clientWidth > 0);
  }

  /* ==================================================================== *
   * TOOL 1 — Monte Carlo Race Outcome Simulator
   * ==================================================================== */

  var MC_DEFAULTS = {
    'mc-mass-mean': 60, 'mc-mass-sigma': 2,
    'mc-drag-mean': 0.28, 'mc-drag-sigma': 0.02,
    'mc-force-mean': 9, 'mc-force-sigma': 0.5,
    'mc-react-mean': 0.15, 'mc-react-sigma': 0.02,
    'mc-track': 20, 'mc-runs': 10000
  };

  App.readConfig = function () {
    return {
      massMean: readInput('mc-mass-mean', 'Vehicle mass mean (g)', { min: 0, exclusiveMin: true }),
      massStdDev: readInput('mc-mass-sigma', 'Vehicle mass σ (g)', { min: 0 }),
      dragMean: readInput('mc-drag-mean', 'Drag coefficient mean', { min: 0 }),
      dragStdDev: readInput('mc-drag-sigma', 'Drag coefficient σ', { min: 0 }),
      forceMean: readInput('mc-force-mean', 'Launch force mean (N)', { min: 0, exclusiveMin: true }),
      forceStdDev: readInput('mc-force-sigma', 'Launch force σ (N)', { min: 0 }),
      reactionMean: readInput('mc-react-mean', 'Reaction time mean (s)', { min: 0 }),
      reactionStdDev: readInput('mc-react-sigma', 'Reaction time σ (s)', { min: 0 }),
      trackLength: readInput('mc-track', 'Track length (m)', { min: 0, exclusiveMin: true }),
      runs: Math.round(readInput('mc-runs', 'Number of simulations', { min: 100, max: 1000000 }))
    };
  };

  App.resetMonteCarloDefaults = function () {
    Object.keys(MC_DEFAULTS).forEach(function (id) {
      var node = el(id);
      if (node) node.value = MC_DEFAULTS[id];
    });
    return App.runMonteCarlo();
  };

  App.runMonteCarlo = function () {
    if (App.state.running) return Promise.resolve();

    var button = el('mc-run');
    var config;
    try {
      config = App.readConfig();
    } catch (err) {
      setText('mc-status', 'Input error — ' + err.message);
      return Promise.resolve();
    }

    var runsNode = el('mc-runs');
    if (runsNode) runsNode.value = config.runs;

    App.state.running = true;
    if (button) {
      button.disabled = true;
      button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
      button.textContent = 'Simulating…';
    }
    setText('mc-status', 'Sampling ' + U.fmtInt(config.runs) + ' trials…');

    return MC.runSimulationAsync(config, {
      chunkSize: 20000,
      onProgress: function (done, total) {
        if (done < total) {
          setText('mc-status', 'Sampling ' + U.fmtInt(done) + ' / ' + U.fmtInt(total) + ' trials…');
        }
      }
    }).then(function (result) {
      App.state.run = result;
      App.state.summary = S.summarize(result.trials.finishTime, {
        thresholds: TARGET_THRESHOLDS,
        percentilePoints: PERCENTILE_POINTS
      });
      App.renderStatistics();
      App.renderSimulationCharts();
      var d = result.diagnostics;
      setText('mc-status',
        U.fmtInt(d.runs) + ' trials complete in ' + U.fmtInt(d.elapsedMs) + ' ms — mean ' +
        U.fmt(App.state.summary.mean, 4) + ' s ± ' + U.fmt(App.state.summary.stdDev, 4) + ' s.');
    }).catch(function (err) {
      setText('mc-status', 'Simulation failed — ' + err.message);
      if (root.console && root.console.error) root.console.error(err);
    }).then(function () {
      App.state.running = false;
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalLabel || 'Run Simulation';
      }
    });
  };

  App.renderStatistics = function () {
    var s = App.state.summary;
    if (!s) return;
    var d = App.state.run ? App.state.run.diagnostics : null;

    setText('st-mean', U.fmt(s.mean, 4) + ' s');
    setText('st-median', U.fmt(s.median, 4) + ' s');
    setText('st-mode', U.fmt(s.mode, 4) + ' s');
    setText('st-stdev', '±' + U.fmt(s.stdDev, 4) + ' s');
    setText('st-variance', s.variance.toExponential(3) + ' s²');
    setText('st-fastest', U.fmt(s.min, 4) + ' s');
    setText('st-slowest', U.fmt(s.max, 4) + ' s');
    setText('st-range', U.fmt(s.range, 4) + ' s');

    setText('st-ci-mean',
      U.fmt(s.confidenceIntervalMean.low, 4) + ' – ' + U.fmt(s.confidenceIntervalMean.high, 4) + ' s');
    setText('st-ci', U.fmt(s.interval95.low, 4) + ' – ' + U.fmt(s.interval95.high, 4) + ' s');

    setText('st-p25', U.fmt(s.percentiles['25'], 4) + ' s');
    setText('st-p50', U.fmt(s.percentiles['50'], 4) + ' s');
    setText('st-p75', U.fmt(s.percentiles['75'], 4) + ' s');
    setText('st-p90', U.fmt(s.percentiles['90'], 4) + ' s');
    setText('st-p99', U.fmt(s.percentiles['99'], 4) + ' s');

    setText('st-skew', U.fmt(s.skewness, 3));
    setText('st-kurt', U.fmt(s.kurtosis, 3));

    setText('st-p100', U.fmtPercent(s.targetProbabilities['1'], 2));
    setText('st-p095', U.fmtPercent(s.targetProbabilities['0.95'], 2));
    setText('st-p090', U.fmtPercent(s.targetProbabilities['0.9'], 2));

    if (d) {
      setText('st-diag',
        U.fmtInt(d.runs) + ' trials · ' + U.fmtInt(d.elapsedMs) + ' ms · ' +
        U.fmtInt(d.truncationRejections) + ' resampled · ' +
        U.fmtInt(d.clampedTrials) + ' clamped · ' +
        U.fmtPercent(d.finishedUnderPowerFraction, 1) + ' finished under power');
    }
  };

  /**
   * Build the four simulation charts. Skipped silently when the panel has no
   * layout — App.activateTool() rebuilds them the moment it becomes visible.
   */
  App.renderSimulationCharts = function () {
    if (!App.state.run || !App.charts || !App.state.chartLibReady) return;
    var panel = el('tool-monte');
    if (!isLaidOut(panel)) return;

    var times = App.state.run.trials.finishTime;
    App.charts.render('chart-hist', CH.histogramConfig(times));
    App.charts.render('chart-bell', CH.bellCurveConfig(times));
    App.charts.render('chart-cdf', CH.cdfConfig(times));
    App.charts.render('chart-qq', CH.qqConfig(times));
    App.observeChartBoxes();
  };

  /* ---- Monte Carlo exports ---- */

  App.exportMonteCarloCSV = function () {
    if (!App.state.run) {
      setText('mc-status', 'Run the simulation before exporting.');
      return;
    }
    var cfg = App.state.run.config;
    var stamp = EX.timestampSlug();
    var metadata = {
      generated: new Date().toISOString(),
      runs: cfg.runs,
      track_length_m: cfg.trackLength,
      mass_mean_g: cfg.massMean, mass_sigma_g: cfg.massStdDev,
      drag_mean_cd: cfg.dragMean, drag_sigma_cd: cfg.dragStdDev,
      launch_force_mean_n: cfg.forceMean, launch_force_sigma_n: cfg.forceStdDev,
      reaction_mean_s: cfg.reactionMean, reaction_sigma_s: cfg.reactionStdDev,
      air_density_kg_m3: cfg.physics.airDensity,
      frontal_area_m2: cfg.physics.frontalArea,
      thrust_duration_s: cfg.physics.thrustDuration,
      model: 'constant thrust + quadratic aerodynamic drag, closed-form solution'
    };
    EX.downloadText('silvermach-montecarlo-trials-' + stamp + '.csv',
      EX.trialsToCSV(App.state.run.trials, { metadata: metadata }));
    setText('mc-status', U.fmtInt(App.state.run.trials.count) + ' trial rows exported as CSV.');
  };

  App.exportMonteCarloSummaryCSV = function () {
    if (!App.state.summary) {
      setText('mc-status', 'Run the simulation before exporting.');
      return;
    }
    EX.downloadText('silvermach-montecarlo-summary-' + EX.timestampSlug() + '.csv',
      EX.summaryToCSV(App.state.summary));
    setText('mc-status', 'Statistics summary exported as CSV.');
  };

  /**
   * Export one chart as PNG. Called directly from that chart's own button, so
   * the download is always a first-party user gesture.
   */
  App.exportChartPNG = function (canvasId, label) {
    if (!App.charts) return;
    var chart = App.charts.get(canvasId);
    if (!chart) {
      setAlert('That chart has not been drawn yet' +
        (App.state.chartLibError ? ' — the charting library failed to load.' : '. Run the simulation first.'),
        'warn');
      return;
    }
    var ok = EX.downloadChartPNG(chart,
      'silvermach-' + label + '-' + EX.timestampSlug() + '.png', '#0f1216');
    setText('mc-status', ok ? label.replace(/-/g, ' ') + ' exported as PNG.'
                            : 'PNG export failed for ' + label + '.');
  };

  /** Export every drawn simulation chart, spaced so browsers do not suppress. */
  App.exportMonteCarloPNG = function () {
    if (!App.charts || !App.state.chartLibReady) {
      setAlert('Charts cannot be exported because the charting library failed to load.', 'warn');
      return;
    }
    var stamp = EX.timestampSlug();
    var names = { 'chart-hist': 'histogram', 'chart-bell': 'bell-curve',
                  'chart-cdf': 'cdf', 'chart-qq': 'qq-plot' };
    var items = SIM_CHART_IDS.map(function (id) {
      return { chart: App.charts.get(id), filename: 'silvermach-' + names[id] + '-' + stamp + '.png' };
    }).filter(function (i) { return !!i.chart; });

    if (!items.length) {
      setText('mc-status', 'No charts are drawn yet — run the simulation first.');
      return;
    }
    EX.downloadChartsPNG(items, 400).then(function (count) {
      setText('mc-status', count + ' chart' + (count === 1 ? '' : 's') + ' exported as PNG. ' +
        'If your browser blocked some, use the PNG button on each chart.');
    });
  };

  /* ==================================================================== *
   * TOOL 2 — Engineering Decision Lineage
   * ==================================================================== */

  App.resetLineageDemo = function () {
    App.state.store = G.createSeededStore();
    var tip = App.state.store.getByName('Final Assembly');
    App.state.selectedDesignId = tip ? tip.id : null;
    App.setLineageError('');
    App.rebuildLineage();
  };

  App.setLineageError = function (message) {
    var node = el('ln-error');
    if (!node) return;
    node.textContent = message || '';
    node.style.display = message ? 'block' : 'none';
  };

  App.rebuildLineage = function () {
    var store = App.state.store;
    if (!store) return;

    // Recalculated on every mutation, by definition.
    App.state.pareto = P.analyse(store.getAll());

    App.populateParentSelect();
    App.renderTree();
    App.renderTradeTable();
    App.renderParetoChart();

    var selected = App.state.selectedDesignId && store.getById(App.state.selectedDesignId)
      ? App.state.selectedDesignId
      : (store.count() ? store.getAll()[store.count() - 1].id : null);
    if (selected) App.selectDesign(selected);
    else App.renderEmptyLineage();
  };

  App.renderEmptyLineage = function () {
    var detail = el('lineage-detail');
    if (detail) {
      detail.innerHTML = '<div class="ld-name">No designs</div>' +
        '<div class="ld-sub">Lineage is empty</div>' +
        '<div class="ld-grid"><div class="ld-box"><b>Getting started</b>' +
        '<p>Log an iteration above, or reset to the demo lineage.</p></div></div>';
    }
    if (App.charts) App.charts.destroy('chart-radar');
  };

  App.populateParentSelect = function () {
    var select = el('ln-parent');
    if (!select) return;
    var store = App.state.store;
    var previous = select.value;
    var options = ['<option value="">— None (new root) —</option>'];
    var all = store.getAll();
    for (var i = 0; i < all.length; i++) {
      var depth = store.getDepth(all[i].id);
      var indent = depth > 0 ? new Array(depth + 1).join('· ') : '';
      options.push('<option value="' + all[i].id + '">' + indent + escapeHTML(all[i].name) + '</option>');
    }
    select.innerHTML = options.join('');
    if (previous && store.getById(previous)) select.value = previous;
    else if (App.state.selectedDesignId) select.value = App.state.selectedDesignId;
  };

  function escapeHTML(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  App.addDesignIteration = function () {
    var store = App.state.store;
    if (!store) return;
    var nameNode = el('ln-name');
    var notesNode = el('ln-notes');
    var parentNode = el('ln-parent');

    try {
      var design = store.add({
        name: nameNode ? nameNode.value : '',
        parent: parentNode && parentNode.value ? parentNode.value : null,
        mass: el('ln-mass') ? el('ln-mass').value : NaN,
        drag: el('ln-drag') ? el('ln-drag').value : NaN,
        deflection: el('ln-deflect') ? el('ln-deflect').value : NaN,
        complexity: el('ln-complex') ? el('ln-complex').value : NaN,
        mfgTime: el('ln-mfgtime') ? el('ln-mfgtime').value : NaN,
        notes: notesNode ? notesNode.value : ''
      });
      App.state.selectedDesignId = design.id;
      App.setLineageError('');
      if (nameNode) nameNode.value = '';
      if (notesNode) notesNode.value = '';
      App.rebuildLineage();
    } catch (err) {
      App.setLineageError(err.message);
    }
  };

  /* ---- genealogy tree (SVG, laid out arithmetically) ---- */

  App.renderTree = function () {
    var wrap = el('tree-wrap');
    if (!wrap || !App.state.store) return;
    App.state.treeSvg = TR.renderInto(wrap, App.state.store, App.state.pareto, {
      selectedId: App.state.selectedDesignId,
      onSelect: function (id) { App.selectDesign(id); }
    });
  };

  App.exportTreeSVG = function () {
    if (!App.state.store || !App.state.store.count()) {
      App.setLineageError('There is no lineage to export yet.');
      return;
    }
    var svgText = TR.toSVGString(App.state.store, App.state.pareto,
      { selectedId: App.state.selectedDesignId });
    var ok = EX.downloadSVG('silvermach-decision-lineage-' + EX.timestampSlug() + '.svg', svgText);
    App.setLineageError(ok ? '' : 'SVG export failed in this browser.');
  };

  App.exportTreePNG = function () {
    if (!App.state.store || !App.state.store.count()) {
      App.setLineageError('There is no lineage to export yet.');
      return;
    }
    TR.toPNGDataURL(App.state.store, App.state.pareto,
      { selectedId: App.state.selectedDesignId }, 2
    ).then(function (dataUrl) {
      EX.downloadDataURL('silvermach-decision-lineage-' + EX.timestampSlug() + '.png', dataUrl);
      App.setLineageError('');
    }).catch(function (err) {
      App.setLineageError('PNG export failed — ' + err.message);
    });
  };

  App.exportLineageCSV = function () {
    if (!App.state.store || !App.state.store.count()) {
      App.setLineageError('There is no lineage to export yet.');
      return;
    }
    EX.downloadText('silvermach-design-lineage-' + EX.timestampSlug() + '.csv',
      EX.designsToCSV(App.state.store.getAll(), App.state.store, App.state.pareto));
    App.setLineageError('');
  };

  /* ---- selection ---- */

  App.selectDesign = function (id) {
    var store = App.state.store;
    if (!store || !store.getById(id)) return;
    App.state.selectedDesignId = id;

    TR.setSelected(el('tree-wrap'), id);

    var rows = root.document.querySelectorAll('#trade-tbody tr');
    for (var r = 0; r < rows.length; r++) {
      rows[r].classList.toggle('selected', rows[r].dataset.id === id);
    }

    var report = store.inspect(id, App.state.pareto);
    App.renderDetail(report);
    App.renderRadarChart(report);
    App.renderParetoChart();
  };

  App.renderDetail = function (report) {
    var detail = el('lineage-detail');
    if (!detail) return;
    var d = report.design;

    var deltaHTML = '';
    if (report.hasParent) {
      var rows = [];
      for (var i = 0; i < report.deltas.length; i++) {
        var k = report.deltas[i];
        var arrow = k.improved ? '▼' : (k.worsened ? '▲' : '=');
        var colour = k.improved ? CH.THEME.cyan : (k.worsened ? '#ff6b78' : CH.THEME.silverDim);
        rows.push(
          '<div class="ld-metric">' +
            '<span>' + escapeHTML(k.label) + '</span>' +
            '<span style="color:' + colour + '">' +
              arrow + ' ' + U.fmt(k.from, k.decimals) + ' → ' + U.fmt(k.to, k.decimals) +
              (U.isFiniteNumber(k.percent) && k.percent !== 0
                ? ' <span style="opacity:.7">(' + (k.percent > 0 ? '+' : '') + U.fmt(k.percent, 1) + '%)</span>'
                : '') +
            '</span>' +
          '</div>');
      }
      deltaHTML = '<div class="ld-box"><b>Changes From ' + escapeHTML(report.parent.name) + '</b>' +
                  '<div class="ld-metrics">' + rows.join('') + '</div></div>';
    }

    var metricRows = [];
    for (var m = 0; m < report.metrics.length; m++) {
      var metric = report.metrics[m];
      metricRows.push(
        '<div class="ld-metric">' +
          '<span>' + escapeHTML(metric.label) + '</span>' +
          '<span class="ld-metric-value">' + U.fmt(d[metric.key], metric.decimals) + ' ' +
            (metric.unit === '/10' ? '/ 10' : escapeHTML(metric.unit)) + '</span>' +
        '</div>');
    }

    var lineagePath = report.ancestry.map(function (a) { return escapeHTML(a.name); }).join(' → ');

    detail.innerHTML =
      '<div class="ld-name">' + escapeHTML(d.name) +
        (report.pareto.onFrontier ? '<span class="badge-pareto">Pareto optimal</span>' : '') +
      '</div>' +
      '<div class="ld-sub">' +
        (report.hasParent ? 'Descendant of ' + escapeHTML(report.parent.name) : 'Root design') +
        ' · depth ' + report.depth +
        ' · ' + (report.isLeaf ? 'lineage tip' : report.children.length + ' child iteration' +
                 (report.children.length === 1 ? '' : 's')) +
      '</div>' +
      '<div class="ld-grid">' +
        '<div class="ld-box"><b>Why It Evolved</b><p>' + escapeHTML(report.whyEvolved) + '</p></div>' +
        '<div class="ld-box notes"><b>Why It Was Selected — Engineering Notes</b><p>' +
          escapeHTML(report.notes) + '</p></div>' +
        '<div class="ld-box"><b>Trade-Off Summary</b><p>' + escapeHTML(report.tradeOffSummary) + '</p></div>' +
        '<div class="ld-box"><b>Pareto Status</b><p>' + escapeHTML(report.pareto.status) + '</p></div>' +
        '<div class="ld-box notes"><b>Engineering Recommendation</b><p>' +
          escapeHTML(report.recommendation) + '</p></div>' +
        '<div class="ld-box"><b>Measured Metrics</b><div class="ld-metrics">' +
          metricRows.join('') + '</div></div>' +
        deltaHTML +
        '<div class="ld-box"><b>Lineage Path</b><p>' + lineagePath + '</p></div>' +
      '</div>';
  };

  /* ---- lineage charts and table ---- */

  App.renderParetoChart = function () {
    if (!App.charts || !App.state.store || !App.state.chartLibReady) return;
    if (!isLaidOut(el('tool-lineage'))) return;
    App.charts.render('chart-pareto', CH.paretoConfig(
      App.state.store.getAll(),
      App.state.pareto,
      function (id) { App.selectDesign(id); },
      App.state.selectedDesignId
    ));
    App.observeChartBoxes();
  };

  App.renderRadarChart = function (report) {
    if (!App.charts || !report || !App.state.chartLibReady) return;
    if (!isLaidOut(el('tool-lineage'))) return;
    App.charts.render('chart-radar', CH.radarConfig(
      report.metrics.map(function (m) { return m.label; }),
      report.design.name,
      report.normalizedScores,
      report.fleetNormalizedScores
    ));
    App.observeChartBoxes();
  };

  App.renderTradeTable = function () {
    var tbody = el('trade-tbody');
    var store = App.state.store;
    if (!tbody || !store) return;

    var all = store.getAll();
    var rows = [];
    for (var i = 0; i < all.length; i++) {
      var d = all[i];
      var parent = store.getParent(d.id);
      var onFrontier = App.state.pareto && App.state.pareto.frontierIds.has(d.id);
      var front = App.state.pareto ? App.state.pareto.rankById[d.id] : '';
      rows.push(
        '<tr data-id="' + d.id + '"' + (d.id === App.state.selectedDesignId ? ' class="selected"' : '') + '>' +
          '<td>' + escapeHTML(d.name) + (onFrontier ? '<span class="badge-pareto">Pareto</span>' : '') + '</td>' +
          '<td>' + (parent ? escapeHTML(parent.name) : '—') + '</td>' +
          '<td>' + U.fmt(d.mass, 2) + '</td>' +
          '<td>' + U.fmt(d.drag, 3) + '</td>' +
          '<td>' + U.fmt(d.deflection, 2) + '</td>' +
          '<td>' + U.fmt(d.complexity, 1) + '</td>' +
          '<td>' + U.fmt(d.mfgTime, 2) + '</td>' +
          '<td>' + (front === '' ? '—' : front) + '</td>' +
        '</tr>');
    }
    tbody.innerHTML = rows.join('');
  };

  /* ==================================================================== *
   * Tool switching, observers, init
   * ==================================================================== */

  /**
   * Show one tool panel and make sure its visuals exist and are correctly sized.
   * Charts skipped while the panel was hidden are built here, on first reveal.
   */
  App.activateTool = function (tool) {
    App.state.activeTool = tool;

    var buttons = root.document.querySelectorAll('.eng-tab-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.tool === tool);
    }
    var monte = el('tool-monte');
    var lineage = el('tool-lineage');
    if (monte) monte.classList.toggle('active', tool === 'monte');
    if (lineage) lineage.classList.toggle('active', tool === 'lineage');

    // Wait one frame so the panel has layout before charts are measured.
    root.requestAnimationFrame(function () {
      if (tool === 'monte') {
        if (App.state.run && App.charts && App.state.chartLibReady &&
            !App.charts.get('chart-hist')) {
          App.renderSimulationCharts();
        }
        App.resizeCharts(SIM_CHART_IDS);
      } else {
        if (App.charts && App.state.chartLibReady && !App.charts.get('chart-pareto')) {
          App.renderParetoChart();
          if (App.state.selectedDesignId && App.state.store) {
            App.renderRadarChart(App.state.store.inspect(App.state.selectedDesignId, App.state.pareto));
          }
        }
        App.resizeCharts(LINEAGE_CHART_IDS);
      }
    });
  };

  App.selectEngTool = function (tool) { App.activateTool(tool); };

  App.resizeCharts = function (ids) {
    if (!App.charts) return;
    for (var i = 0; i < ids.length; i++) {
      var chart = App.charts.get(ids[i]);
      if (chart) {
        try { chart.resize(); } catch (e) { /* detached canvas */ }
      }
    }
  };

  /**
   * Observe every chart container. When a box transitions from zero width
   * (hidden) to a real width, Chart.js is told to resize; without this a chart
   * created while hidden stays locked at 0x0 and never paints.
   */
  App.observeChartBoxes = function () {
    if (typeof root.ResizeObserver !== 'function') return;
    if (!App._resizeObserver) {
      App._observedBoxes = new Set();
      App._resizeObserver = new root.ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var canvas = entries[i].target.querySelector('canvas');
          if (!canvas || !canvas.id || !App.charts) continue;
          var chart = App.charts.get(canvas.id);
          if (chart && entries[i].contentRect.width > 0) {
            try { chart.resize(); } catch (e) { /* detached */ }
          }
        }
      });
    }
    var boxes = root.document.querySelectorAll('#engineering .chart-box');
    for (var b = 0; b < boxes.length; b++) {
      if (!App._observedBoxes.has(boxes[b])) {
        App._observedBoxes.add(boxes[b]);
        App._resizeObserver.observe(boxes[b]);
      }
    }
  };

  App.bindListeners = function () {
    if (App._listenersBound) return;
    App._listenersBound = true;

    var mcPanel = el('tool-monte');
    if (mcPanel) {
      mcPanel.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          App.runMonteCarlo();
        }
      });
    }

    var lnPanel = el('tool-lineage');
    if (lnPanel) {
      lnPanel.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && event.target && event.target.tagName === 'INPUT') {
          event.preventDefault();
          App.addDesignIteration();
        }
      });
    }

    // One delegated handler covers every current and future table row.
    var tbody = el('trade-tbody');
    if (tbody) {
      tbody.addEventListener('click', function (event) {
        var row = event.target.closest ? event.target.closest('tr[data-id]') : null;
        if (row && row.dataset.id) App.selectDesign(row.dataset.id);
      });
    }
  };

  /**
   * Boot sequence. The engine runs immediately so statistics and the lineage
   * are populated even if the chart library never arrives; charts are then
   * layered on once Chart.js resolves.
   */
  App.init = function () {
    if (!root.document || !el('engineering')) return;

    App.charts = new CH.ChartRegistry();
    App.bindListeners();

    // Engine-only work first: statistics, tree and table need no third party.
    App.resetLineageDemo();
    var simulation = App.runMonteCarlo();

    setText('mc-status', 'Loading charting library…');

    return LL.loadChart().then(function (info) {
      App.state.chartLibReady = true;
      App.state.chartLibError = null;

      root.Chart.defaults.color = CH.THEME.silverDim;
      root.Chart.defaults.font.family = "'Inter',-apple-system,BlinkMacSystemFont,sans-serif";
      root.Chart.defaults.responsive = true;
      root.Chart.defaults.maintainAspectRatio = false;

      if (root.console && root.console.info) {
        root.console.info('[SilverMach] Chart.js loaded from ' + info.source);
      }
      setAlert('');
      return simulation;
    }).then(function () {
      // Charts for the visible panel now; the hidden panel builds on reveal.
      App.renderSimulationCharts();
      App.renderParetoChart();
      if (App.state.selectedDesignId && App.state.store) {
        App.renderRadarChart(App.state.store.inspect(App.state.selectedDesignId, App.state.pareto));
      }
      App.observeChartBoxes();
    }).catch(function (err) {
      App.state.chartLibReady = false;
      App.state.chartLibError = err;
      setAlert('Charts are unavailable: the Chart.js library could not be loaded from any source. ' +
        'All statistics, the decision lineage and every CSV/SVG export still work. (' +
        err.message + ')', 'warn');
      if (root.console && root.console.error) root.console.error(err);
      return simulation;
    });
  };

  /* -------------------------------------------------- global thin wrappers *
   * Present so the markup's inline onclick attributes keep working unchanged. */

  root.selectEngTool = function (tool) { App.selectEngTool(tool); };
  root.runMonteCarlo = function () { App.runMonteCarlo(); };
  root.resetMonteCarloDefaults = function () { App.resetMonteCarloDefaults(); };
  root.exportMonteCarloCSV = function () { App.exportMonteCarloCSV(); };
  root.exportMonteCarloSummaryCSV = function () { App.exportMonteCarloSummaryCSV(); };
  root.exportMonteCarloPNG = function () { App.exportMonteCarloPNG(); };
  root.exportChartPNG = function (id, label) { App.exportChartPNG(id, label); };
  root.addDesignIteration = function () { App.addDesignIteration(); };
  root.resetLineageDemo = function () { App.resetLineageDemo(); };
  root.selectDesign = function (id) { App.selectDesign(id); };
  root.exportTreeSVG = function () { App.exportTreeSVG(); };
  root.exportTreePNG = function () { App.exportTreePNG(); };
  root.exportLineageCSV = function () { App.exportLineageCSV(); };

  root.SM = root.SM || {};
  root.SM.App = App;

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', App.init, { once: true });
    } else {
      App.init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
