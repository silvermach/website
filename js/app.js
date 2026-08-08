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
  var TH = root.SM.Thrust;

  // This build keeps the lineage in memory only; the key exists so the wipe
  // control also clears a persisted copy if persistence is ever introduced.
  var LINEAGE_STORAGE_KEY = 'silvermach.lineage';

  var TARGET_THRESHOLDS = [1.00, 0.95, 0.90];
  var PERCENTILE_POINTS = [25, 50, 75, 90, 99];

  var SIM_CHART_IDS = ['chart-hist', 'chart-bell', 'chart-cdf', 'chart-qq', 'chart-thrust'];
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
      treeSvg: null,
      thrustVisible: false
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

  /**
   * Peak thrust is NOT a hand-picked number: F₀ = m_CO2·v_e/τ, derived from the
   * 8 g charge. Computed here so the default field value and the physics agree.
   */
  var DEFAULT_PEAK_THRUST = TH.peakThrust(
    TH.THRUST_DEFAULTS.co2Mass, TH.THRUST_DEFAULTS.exhaustVelocity,
    TH.THRUST_DEFAULTS.tau);

  var MC_DEFAULTS = {
    'mc-mass-mean': 60, 'mc-mass-sigma': 2,
    'mc-drag-mean': 0.28, 'mc-drag-sigma': 0.02,
    'mc-force-mean': Number(DEFAULT_PEAK_THRUST.toFixed(2)), 'mc-force-sigma': 1,
    'mc-react-mean': 0.15, 'mc-react-sigma': 0.02,
    'mc-wheel-sigma-fl': 0.5, 'mc-wheel-sigma-fr': 0.5,
    'mc-wheel-sigma-rl': 0.5, 'mc-wheel-sigma-rr': 0.5,
    'mc-friction-mean': MC.PHYSICS.scrubCoefficient, 'mc-friction-sigma': 0,
    'mc-tau': TH.THRUST_DEFAULTS.tau,
    'mc-thrust-angle': TH.THRUST_DEFAULTS.thrustAngle,
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
      wheelAngleStdDevFL: readInput('mc-wheel-sigma-fl', 'Front-left toe σ (°)', { min: 0, max: 30 }),
      wheelAngleStdDevFR: readInput('mc-wheel-sigma-fr', 'Front-right toe σ (°)', { min: 0, max: 30 }),
      wheelAngleStdDevRL: readInput('mc-wheel-sigma-rl', 'Rear-left toe σ (°)', { min: 0, max: 30 }),
      wheelAngleStdDevRR: readInput('mc-wheel-sigma-rr', 'Rear-right toe σ (°)', { min: 0, max: 30 }),
      frictionMean: readInput('mc-friction-mean', 'Coefficient of friction μ', { min: 0, max: 2 }),
      frictionStdDev: readInput('mc-friction-sigma', 'Coefficient of friction σ', { min: 0, max: 1 }),
      trackLength: readInput('mc-track', 'Track length (m)', { min: 0, exclusiveMin: true }),
      runs: Math.round(readInput('mc-runs', 'Number of simulations', { min: 100, max: 1000000 })),
      thrust: {
        tau: readInput('mc-tau', 'Thrust decay time constant τ (s)',
          { min: 0, exclusiveMin: true, max: 5 }),
        thrustAngle: readInput('mc-thrust-angle', 'Thrust misalignment θ (°)',
          { min: -89, max: 89 }),
        co2Mass: TH.THRUST_DEFAULTS.co2Mass,
        exhaustVelocity: TH.THRUST_DEFAULTS.exhaustVelocity
      }
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
      var s = App.state.summary;
      var note = '';
      // Excluded trials are never quietly dropped. If any trial failed to reach
      // the line or could not be integrated, the statistics say so on screen
      // next to the numbers they were computed without.
      if (s.excludedCount > 0) {
        note = ' ' + U.fmtInt(s.excludedCount) + ' trial' +
               (s.excludedCount === 1 ? '' : 's') + ' excluded from the statistics (' +
               U.fmtInt(d.didNotFinish) + ' did not reach the line, ' +
               U.fmtInt(d.diverged) + ' numerically unresolved).';
      }
      setText('mc-status',
        U.fmtInt(d.runs) + ' trials complete in ' + U.fmtInt(d.elapsedMs) + ' ms — mean ' +
        U.fmt(s.mean, 4) + ' s ± ' + U.fmt(s.stdDev, 4) + ' s.' + note);
      if (s.excludedCount > 0) {
        setAlert(U.fmtInt(s.excludedCount) + ' of ' + U.fmtInt(d.runs) +
          ' trials did not produce a finite race time and were left out of every ' +
          'statistic and chart below. The summary describes the ' +
          U.fmtInt(s.count) + ' trials that resolved.', 'warn');
      }
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
    App.renderThrustCurve();
    App.observeChartBoxes();
  };

  /**
   * Draw the thrust-decay curve from the SAME parameters the run used.
   * Reading them off App.state.run.config (not off the input fields) means the
   * curve always depicts the physics that actually produced the statistics
   * on screen, even if the user has since typed a new value without re-running.
   */
  App.renderThrustCurve = function () {
    if (!App.charts || !App.state.chartLibReady) return;
    var card = el('thrust-card');
    if (!card || !App.state.thrustVisible) return;
    if (!isLaidOut(el('tool-monte'))) return;

    var cfg = App.state.run ? App.state.run.config : null;
    var peakN = cfg ? cfg.forceMean : DEFAULT_PEAK_THRUST;
    var tau = cfg ? cfg.thrust.tau : TH.THRUST_DEFAULTS.tau;
    var angle = cfg ? cfg.thrust.thrustAngle : 0;

    App.charts.render('chart-thrust', CH.thrustCurveConfig({
      peakN: peakN, tau: tau, thrustAngle: angle
    }));

    var impulse = peakN * tau * (1 - Math.exp(-TH.BURN_TIME_CONSTANTS));
    setText('thrust-equation', TH.equationText(peakN, tau));
    setText('thrust-params',
      'F₀ = ' + U.fmt(peakN, 2) + ' N · τ = ' + U.fmt(tau, 3) + ' s · ' +
      'burn 5τ = ' + U.fmt(TH.burnDuration(tau), 2) + ' s · ' +
      'impulse ≈ ' + U.fmt(impulse, 3) + ' N·s · θ = ' + U.fmt(angle, 1) + '°');
  };

  /** Show/hide the thrust curve. Hidden by default: the page looks unchanged. */
  App.toggleThrustCurve = function (visible) {
    var card = el('thrust-card');
    if (!card) return;
    App.state.thrustVisible = visible === undefined
      ? !App.state.thrustVisible : !!visible;

    var box = el('mc-thrust-toggle');
    if (box && box.checked !== App.state.thrustVisible) {
      box.checked = App.state.thrustVisible;
    }
    card.style.display = App.state.thrustVisible ? '' : 'none';

    if (App.state.thrustVisible) {
      // Build synchronously. requestAnimationFrame does not fire while a tab is
      // backgrounded, so deferring the build meant the chart could stay missing
      // until the tab was refocused. The rAF is kept only for the resize, which
      // genuinely needs a completed layout pass.
      App.renderThrustCurve();
      root.requestAnimationFrame(function () { App.resizeCharts(['chart-thrust']); });
    } else {
      App.charts.destroy('chart-thrust');
    }
  };

  /* ---- Monte Carlo exports ---- */

  /**
   * Build the CSV header block from the configuration that actually ran.
   * Exposed rather than inlined in the export handler so verification can read
   * the same object the download contains — a test that constructs its own
   * metadata proves nothing about what users receive.
   */
  App.buildTrialMetadata = function () {
    if (!App.state.run) return null;
    var cfg = App.state.run.config;
    return {
      generated: new Date().toISOString(),
      runs: cfg.runs,
      track_length_m: cfg.trackLength,
      mass_mean_g: cfg.massMean, mass_sigma_g: cfg.massStdDev,
      drag_mean_cd: cfg.dragMean, drag_sigma_cd: cfg.dragStdDev,
      launch_force_mean_n: cfg.forceMean, launch_force_sigma_n: cfg.forceStdDev,
      reaction_mean_s: cfg.reactionMean, reaction_sigma_s: cfg.reactionStdDev,
      toe_sigma_front_left_deg: cfg.wheelAngleStdDevFL,
      toe_sigma_front_right_deg: cfg.wheelAngleStdDevFR,
      toe_sigma_rear_left_deg: cfg.wheelAngleStdDevRL,
      toe_sigma_rear_right_deg: cfg.wheelAngleStdDevRR,
      friction_coefficient_mu: cfg.frictionMean,
      friction_coefficient_sigma: cfg.frictionStdDev,
      friction_provenance: cfg.frictionStdDev > 0
        ? 'user-supplied nominal and spread; sampled per trial'
        : 'user-supplied nominal, assumed (not measured); held constant across trials',
      air_density_kg_m3: cfg.physics.airDensity,
      frontal_area_m2: cfg.physics.frontalArea,
      scrub_coefficient: cfg.physics.scrubCoefficient,
      // Every thrust parameter the user can edit, plus the quantities derived
      // from them, so a CSV can be reproduced without the page.
      co2_charge_g: cfg.thrust.co2Mass,
      effective_exhaust_velocity_m_s: cfg.thrust.exhaustVelocity,
      peak_thrust_n: cfg.forceMean,
      thrust_decay_tau_s: cfg.thrust.tau,
      thrust_angle_deg: cfg.thrust.thrustAngle,
      burn_duration_s: TH.burnDuration(cfg.thrust.tau),
      delivered_impulse_ns: cfg.forceMean * cfg.thrust.tau *
        (1 - Math.exp(-TH.BURN_TIME_CONSTANTS)),
      integration_step_s: cfg.physics.integrationStep,
      // This string previously read "constant thrust … closed-form solution",
      // which stopped being true when the time-dependent model landed. An
      // exported file that misdescribes its own model is a fabricated claim,
      // so it is now generated from the model that actually ran.
      model: 'F(t) = F0·exp(-t/tau) truncated at ' + TH.BURN_TIME_CONSTANTS +
             'tau; quadratic aerodynamic drag; per-wheel scrub; RK4 powered ' +
             'phase with adaptive substepping, closed-form coast phase',
      seed: cfg.seed === null ? 'unseeded (system randomness)' : cfg.seed
    };
  };

  App.exportMonteCarloCSV = function () {
    if (!App.state.run) {
      setText('mc-status', 'Run the simulation before exporting.');
      return;
    }
    EX.downloadText('silvermach-montecarlo-trials-' + EX.timestampSlug() + '.csv',
      EX.trialsToCSV(App.state.run.trials, { metadata: App.buildTrialMetadata() }));
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
                  'chart-cdf': 'cdf', 'chart-qq': 'qq-plot',
                  'chart-thrust': 'thrust-curve' };
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

  /* ---- inline consent / confirmation ---- */

  /**
   * Ask the viewer a question inside the page's own UI and resolve with the
   * value of whatever they choose. Deliberately not window.confirm(): a browser
   * modal sits outside the site's styling and blocks the page.
   *
   * @param {string} message
   * @param {Array<{label:string, value:*, primary?:boolean}>} choices
   * @returns {Promise<*>} the chosen value
   */
  App.askLineage = function (message, choices) {
    var panel = el('ln-prompt');
    var msgNode = el('ln-prompt-msg');
    var actions = el('ln-prompt-actions');
    if (!panel || !msgNode || !actions) return Promise.resolve(null);

    msgNode.textContent = message;
    actions.innerHTML = '';
    panel.style.display = 'block';

    return new Promise(function (resolve) {
      choices.forEach(function (choice) {
        var button = root.document.createElement('button');
        button.type = 'button';
        button.className = 'btn ' + (choice.primary ? 'btn-primary' : 'btn-ghost');
        button.textContent = choice.label;
        button.addEventListener('click', function () {
          panel.style.display = 'none';
          actions.innerHTML = '';
          resolve(choice.value);
        });
        actions.appendChild(button);
      });
    });
  };

  App.closeLineagePrompt = function () {
    var panel = el('ln-prompt');
    if (panel) panel.style.display = 'none';
  };

  /* ---- destructive wipe ---- */

  /**
   * Remove every design from the lineage — user entries, imported values and
   * the demo seed alike. This clears the underlying store, not the display:
   * App.state.store is replaced with an empty DesignStore, so nothing survives
   * behind the visualisation. Any browser-persisted copy is cleared too, even
   * though this build keeps the lineage in memory only, so the control stays
   * correct if persistence is added later.
   */
  App.wipeLineageData = function () {
    return App.askLineage(
      'Are you sure you want to delete all decision-lineage data, including demo values? ' +
      'This cannot be undone.',
      [{ label: 'Delete Everything', value: true, primary: true },
       { label: 'Cancel', value: false }]
    ).then(function (confirmed) {
      if (!confirmed) {
        App.setLineageError('');
        return false;
      }
      App.state.store = new G.DesignStore();
      App.state.selectedDesignId = null;
      App.state.pareto = null;

      try {
        if (root.localStorage) root.localStorage.removeItem(LINEAGE_STORAGE_KEY);
        if (root.sessionStorage) root.sessionStorage.removeItem(LINEAGE_STORAGE_KEY);
      } catch (err) {
        // Private-browsing modes can throw on storage access; the in-memory
        // wipe above has already happened, so this is not a failure.
      }

      App.setLineageError('');
      App.rebuildLineage();
      return true;
    });
  };

  /* ---- Monte Carlo → lineage transfer ---- */

  /** Keys this import can write, in the order they are offered. */
  var IMPORT_KEYS = ['raceTime', 'friction', 'alignFL', 'alignFR', 'alignRL', 'alignRR'];

  /**
   * Offer to copy the current Monte Carlo result onto the selected design.
   *
   * Nothing moves without explicit consent, and nothing is overwritten without
   * a second, separate decision. The four wheel angles travel as four values —
   * their mean toe per corner across the run — never as a single total.
   */
  App.importMonteCarloToLineage = function () {
    var store = App.state.store;
    if (!store || !store.count()) {
      App.setLineageError('Add or restore a design before importing Monte Carlo results.');
      return Promise.resolve(false);
    }
    if (!App.state.run || !App.state.summary) {
      App.setLineageError('Run the Monte Carlo simulation first — there is no result to import.');
      return Promise.resolve(false);
    }
    var design = store.getById(App.state.selectedDesignId) ||
                 store.getAll()[store.count() - 1];
    if (!design) return Promise.resolve(false);

    var cfg = App.state.run.config;
    var trials = App.state.run.trials;

    function meanOf(key) {
      var total = 0;
      for (var i = 0; i < trials.count; i++) total += trials[key][i];
      return trials.count ? total / trials.count : 0;
    }

    var incoming = {
      raceTime: App.state.summary.mean,
      friction: cfg.frictionMean,
      alignFL: meanOf('wheelFL'),
      alignFR: meanOf('wheelFR'),
      alignRL: meanOf('wheelRL'),
      alignRR: meanOf('wheelRR')
    };

    var occupied = IMPORT_KEYS.filter(function (k) {
      return design[k] !== null && design[k] !== undefined;
    });

    App.setLineageError('');
    return App.askLineage(
      'Would you like to add the selected Monte Carlo results to the Decision Lineage Tree? ' +
      'Race time ' + U.fmt(incoming.raceTime, 4) + ' s, friction μ ' + U.fmt(incoming.friction, 3) +
      ', and the four wheel angles will be attached to "' + design.name + '".',
      [{ label: 'Add Data', value: 'yes', primary: true },
       { label: 'Cancel', value: 'no' }]
    ).then(function (answer) {
      if (answer !== 'yes') return false;
      if (!occupied.length) return App.applyLineageImport(design, incoming, 'replace');

      return App.askLineage(
        '"' + design.name + '" already has ' + occupied.length +
        ' of these values recorded. Replace them, keep them and fill only the empty ones, or cancel?',
        [{ label: 'Replace Existing', value: 'replace', primary: true },
         { label: 'Fill Empty Only', value: 'fill' },
         { label: 'Cancel', value: 'cancel' }]
      ).then(function (mode) {
        if (mode === 'cancel') return false;
        return App.applyLineageImport(design, incoming, mode);
      });
    });
  };

  App.applyLineageImport = function (design, incoming, mode) {
    var patch = {};
    IMPORT_KEYS.forEach(function (k) {
      var occupiedHere = design[k] !== null && design[k] !== undefined;
      if (mode === 'fill' && occupiedHere) return;
      patch[k] = incoming[k];
    });
    try {
      App.state.store.update(design.id, patch);
      App.state.selectedDesignId = design.id;
      App.setLineageError('');
      App.rebuildLineage();
      return true;
    } catch (err) {
      App.setLineageError('Import failed — ' + err.message);
      return false;
    }
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

  /**
   * Write the selected node's decision report to a file.
   *
   * This does NOT generate a new report. It serialises the object that
   * DesignStore.inspect() already returns — the same object App.renderDetail()
   * puts on screen — using the same section headings the panel uses, so the
   * downloaded text and the on-screen report are the same report. Every number
   * comes from the existing implementation; nothing is recomputed here.
   */
  App.exportDesignReport = function () {
    var store = App.state.store;
    if (!store || !store.count()) {
      App.setLineageError('There is no lineage to report on yet.');
      return;
    }
    var id = App.state.selectedDesignId;
    if (!id || !store.getById(id)) {
      App.setLineageError('Select a design in the tree to generate its report.');
      return;
    }
    var r = store.inspect(id, App.state.pareto);
    var d = r.design;
    var lines = [];

    lines.push('SILVERMACH — ENGINEERING DECISION LINEAGE');
    lines.push('Design report: ' + d.name);
    lines.push('Generated ' + new Date().toISOString());
    lines.push('');
    lines.push((r.hasParent ? 'Descendant of ' + r.parent.name : 'Root design') +
      ' · depth ' + r.depth + ' · ' +
      (r.isLeaf ? 'lineage tip' : r.children.length + ' child iteration' +
        (r.children.length === 1 ? '' : 's')) +
      (r.pareto.onFrontier ? ' · Pareto optimal' : ''));
    lines.push('');

    function section(title, body) {
      lines.push(title.toUpperCase());
      lines.push(body);
      lines.push('');
    }
    section('Why It Evolved', r.whyEvolved);
    section('Why It Was Selected — Engineering Notes', r.notes);
    section('Trade-Off Summary', r.tradeOffSummary);
    section('Pareto Status', r.pareto.status);
    section('Engineering Recommendation', r.recommendation);

    lines.push('MEASURED METRICS');
    for (var m = 0; m < r.metrics.length; m++) {
      var metric = r.metrics[m];
      lines.push('  ' + metric.label + ': ' + U.fmt(d[metric.key], metric.decimals) +
        ' ' + (metric.unit === '/10' ? '/ 10' : metric.unit));
    }
    lines.push('');

    // The optional simulation/setup data points, when a design carries them.
    var extras = [];
    for (var x = 0; x < G.EXTRA_METRICS.length; x++) {
      var ex = G.EXTRA_METRICS[x];
      if (d[ex.key] === null || d[ex.key] === undefined) continue;
      extras.push('  ' + ex.label + ': ' + U.fmt(d[ex.key], ex.decimals) + ' ' + ex.unit);
    }
    if (extras.length) {
      lines.push('SIMULATION & SETUP DATA');
      lines = lines.concat(extras);
      lines.push('');
    }

    if (r.hasParent) {
      lines.push('CHANGES FROM ' + r.parent.name.toUpperCase());
      for (var i = 0; i < r.deltas.length; i++) {
        var k = r.deltas[i];
        lines.push('  ' + k.label + ': ' + U.fmt(k.from, k.decimals) + ' → ' +
          U.fmt(k.to, k.decimals) + ' ' + k.unit +
          (U.isFiniteNumber(k.percent) && k.percent !== 0
            ? '  (' + (k.percent > 0 ? '+' : '') + U.fmt(k.percent, 1) + '%)' : '') +
          (k.improved ? '  improved' : (k.worsened ? '  worsened' : '  unchanged')));
      }
      lines.push('');
    }

    lines.push('LINEAGE PATH');
    lines.push('  ' + r.ancestry.map(function (a) { return a.name; }).join(' → '));
    lines.push('');

    EX.downloadText(
      'silvermach-lineage-report-' + d.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() +
      '-' + EX.timestampSlug() + '.txt',
      lines.join('\r\n'));
    App.setLineageError('');
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

    // Additional lineage data points. Rendered with the existing .ld-box and
    // .ld-metric markup, and only when at least one has been recorded, so a
    // design that has never had an import attached looks exactly as before.
    var extraHTML = '';
    var extraRows = [];
    for (var x = 0; x < G.EXTRA_METRICS.length; x++) {
      var ex = G.EXTRA_METRICS[x];
      var val = d[ex.key];
      if (val === null || val === undefined) continue;
      extraRows.push(
        '<div class="ld-metric">' +
          '<span>' + escapeHTML(ex.label) + '</span>' +
          '<span class="ld-metric-value">' + U.fmt(val, ex.decimals) + ' ' +
            escapeHTML(ex.unit) + '</span>' +
        '</div>');
    }
    if (extraRows.length) {
      extraHTML = '<div class="ld-box"><b>Simulation &amp; Setup Data</b>' +
                  '<div class="ld-metrics">' + extraRows.join('') + '</div></div>';
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
        extraHTML +
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
      // Canvas text must request the same typeface as the DOM, otherwise chart
      // labels stay on the old face while every other element switches.
      root.Chart.defaults.font.family = CH.FONT_STACK;
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
  root.toggleThrustCurve = function (v) { App.toggleThrustCurve(v); };
  root.addDesignIteration = function () { App.addDesignIteration(); };
  root.resetLineageDemo = function () { App.resetLineageDemo(); };
  root.exportDesignReport = function () { App.exportDesignReport(); };
  root.wipeLineageData = function () { App.wipeLineageData(); };
  root.importMonteCarloToLineage = function () { App.importMonteCarloToLineage(); };
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
