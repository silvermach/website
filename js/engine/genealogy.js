/* ============================================================================
 * SilverMach Engineering Analysis Suite — genealogy.js
 * ----------------------------------------------------------------------------
 * Design lineage data model and graph engine.
 *
 * Designs form a forest: every design either is a root or references exactly
 * one parent by UUID. The store maintains the authoritative in-memory state,
 * enforces validation invariants (including cycle prevention on re-parenting),
 * and exposes real graph traversal — parents, children, depth, branching,
 * ancestry, descendants and level bucketing — rather than any static layout.
 *
 * The trade-off engine derives every statement it makes from the stored
 * numbers and the live Pareto analysis. Nothing is hardcoded.
 * Attaches to `SM.Genealogy`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;

  /**
   * Engineering metrics tracked per design. All five are "lower is better",
   * which is what makes the radar normalisation and trade-off language valid.
   */
  var METRICS = [
    { key: 'mass',       label: 'Mass',                     unit: 'g',   direction: 'min', decimals: 2 },
    { key: 'drag',       label: 'Aerodynamic Drag',         unit: 'Cd',  direction: 'min', decimals: 3 },
    { key: 'deflection', label: 'Structural Deflection',    unit: 'mm',  direction: 'min', decimals: 2 },
    { key: 'complexity', label: 'Manufacturing Complexity', unit: '/10', direction: 'min', decimals: 1 },
    { key: 'mfgTime',    label: 'Manufacturing Time',       unit: 'hrs', direction: 'min', decimals: 2 }
  ];

  function metricByKey(key) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === key) return METRICS[i];
    return null;
  }

  /* -------------------------------------------------------------- store */

  /**
   * @constructor
   * Authoritative design store. Unlimited iterations.
   */
  function DesignStore() {
    this.designs = [];          // active state array, insertion-ordered
    this._byId = new Map();
  }

  /* ---- internal helpers ---- */

  DesignStore.prototype._assertUniqueName = function (name, exceptId) {
    var lowered = String(name).trim().toLowerCase();
    for (var i = 0; i < this.designs.length; i++) {
      var d = this.designs[i];
      if (d.id === exceptId) continue;
      if (d.name.trim().toLowerCase() === lowered) {
        throw new Error('Duplicate design name: "' + name + '" already exists in the lineage.');
      }
    }
  };

  DesignStore.prototype._assertParentExists = function (parentId) {
    if (parentId === null || parentId === undefined || parentId === '') return null;
    if (!this._byId.has(parentId)) {
      throw new ReferenceError('Parent design reference "' + parentId + '" does not exist.');
    }
    return parentId;
  };

  /** Reject a parent assignment that would create a cycle. */
  DesignStore.prototype._assertNoCycle = function (childId, parentId) {
    if (!parentId) return;
    if (parentId === childId) {
      throw new Error('A design cannot be its own parent.');
    }
    var seen = new Set();
    var cursor = parentId;
    while (cursor) {
      if (cursor === childId) {
        throw new Error(
          'Invalid parent: assigning "' + parentId + '" would create a circular lineage.'
        );
      }
      if (seen.has(cursor)) break; // pre-existing corruption; stop rather than hang
      seen.add(cursor);
      var node = this._byId.get(cursor);
      cursor = node ? node.parent : null;
    }
  };

  /**
   * Validate and normalise raw design input.
   * @returns {Object} normalised field values (no id/timestamp yet)
   */
  DesignStore.prototype.normalizeInput = function (input) {
    if (!input || typeof input !== 'object') {
      throw new TypeError('Design input object is required.');
    }
    var name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '') {
      throw new Error('Design name is required.');
    }
    if (name.length > 80) {
      throw new Error('Design name must be 80 characters or fewer.');
    }

    var out = { name: name };
    out.mass = U.requireNumber(input.mass, 'Mass (g)', { min: 0, exclusiveMin: true });
    out.drag = U.requireNumber(input.drag, 'Aerodynamic drag (Cd)', { min: 0 });
    out.deflection = U.requireNumber(input.deflection, 'Structural deflection (mm)', { min: 0 });
    out.complexity = U.requireNumber(input.complexity, 'Manufacturing complexity', { min: 1, max: 10 });
    out.mfgTime = U.requireNumber(input.mfgTime, 'Manufacturing time (hrs)', { min: 0 });
    out.notes = typeof input.notes === 'string' && input.notes.trim() !== ''
      ? input.notes.trim()
      : 'No engineering notes recorded for this iteration.';
    return out;
  };

  /* ---- mutations ---- */

  /**
   * Add a design.
   * @param {Object} input  {name, parent, mass, drag, deflection, complexity, mfgTime, notes}
   * @returns {Object} the stored design
   */
  DesignStore.prototype.add = function (input) {
    var fields = this.normalizeInput(input);
    this._assertUniqueName(fields.name, null);
    var parentId = this._assertParentExists(input.parent);

    var design = {
      id: U.uuid(),
      name: fields.name,
      parent: parentId,
      mass: fields.mass,
      drag: fields.drag,
      deflection: fields.deflection,
      complexity: fields.complexity,
      mfgTime: fields.mfgTime,
      notes: fields.notes,
      timestamp: Date.now()
    };

    this.designs.push(design);
    this._byId.set(design.id, design);
    return design;
  };

  /**
   * Update an existing design in place.
   * @param {string} id
   * @param {Object} patch  Any subset of the editable fields, plus `parent`.
   * @returns {Object} the updated design
   */
  DesignStore.prototype.update = function (id, patch) {
    var design = this._byId.get(id);
    if (!design) throw new ReferenceError('Unknown design id: ' + id);
    if (!patch || typeof patch !== 'object') throw new TypeError('Patch object is required.');

    var merged = {
      name: patch.name !== undefined ? patch.name : design.name,
      mass: patch.mass !== undefined ? patch.mass : design.mass,
      drag: patch.drag !== undefined ? patch.drag : design.drag,
      deflection: patch.deflection !== undefined ? patch.deflection : design.deflection,
      complexity: patch.complexity !== undefined ? patch.complexity : design.complexity,
      mfgTime: patch.mfgTime !== undefined ? patch.mfgTime : design.mfgTime,
      notes: patch.notes !== undefined ? patch.notes : design.notes
    };
    var fields = this.normalizeInput(merged);
    this._assertUniqueName(fields.name, id);

    if (patch.parent !== undefined) {
      var newParent = patch.parent === '' ? null : patch.parent;
      this._assertParentExists(newParent);
      this._assertNoCycle(id, newParent);
      design.parent = newParent;
    }

    design.name = fields.name;
    design.mass = fields.mass;
    design.drag = fields.drag;
    design.deflection = fields.deflection;
    design.complexity = fields.complexity;
    design.mfgTime = fields.mfgTime;
    design.notes = fields.notes;
    return design;
  };

  /**
   * Remove a design. Its children are re-parented to the removed node's own
   * parent so the forest never contains dangling references.
   * @returns {{removed:Object, reparented:string[]}}
   */
  DesignStore.prototype.remove = function (id) {
    var design = this._byId.get(id);
    if (!design) throw new ReferenceError('Unknown design id: ' + id);

    var reparented = [];
    for (var i = 0; i < this.designs.length; i++) {
      if (this.designs[i].parent === id) {
        this.designs[i].parent = design.parent;
        reparented.push(this.designs[i].id);
      }
    }
    this.designs = this.designs.filter(function (d) { return d.id !== id; });
    this._byId.delete(id);
    return { removed: design, reparented: reparented };
  };

  DesignStore.prototype.clear = function () {
    this.designs = [];
    this._byId = new Map();
  };

  /* ---- accessors ---- */

  DesignStore.prototype.count = function () { return this.designs.length; };
  DesignStore.prototype.getAll = function () { return this.designs.slice(); };
  DesignStore.prototype.getById = function (id) { return this._byId.get(id) || null; };

  DesignStore.prototype.getByName = function (name) {
    var lowered = String(name).trim().toLowerCase();
    for (var i = 0; i < this.designs.length; i++) {
      if (this.designs[i].name.trim().toLowerCase() === lowered) return this.designs[i];
    }
    return null;
  };

  DesignStore.prototype.getParent = function (id) {
    var d = this._byId.get(id);
    return d && d.parent ? (this._byId.get(d.parent) || null) : null;
  };

  DesignStore.prototype.getChildren = function (id) {
    return this.designs.filter(function (d) { return d.parent === id; });
  };

  DesignStore.prototype.getRoots = function () {
    var self = this;
    return this.designs.filter(function (d) {
      return !d.parent || !self._byId.has(d.parent);
    });
  };

  /** Depth of a node: 0 for roots. Cycle-safe. */
  DesignStore.prototype.getDepth = function (id) {
    var depth = 0;
    var seen = new Set([id]);
    var cursor = this._byId.get(id);
    while (cursor && cursor.parent && this._byId.has(cursor.parent) && !seen.has(cursor.parent)) {
      seen.add(cursor.parent);
      cursor = this._byId.get(cursor.parent);
      depth++;
    }
    return depth;
  };

  /** Path from the root down to `id`, inclusive. */
  DesignStore.prototype.getAncestry = function (id) {
    var chain = [];
    var seen = new Set();
    var cursor = this._byId.get(id);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.unshift(cursor);
      cursor = cursor.parent ? this._byId.get(cursor.parent) : null;
    }
    return chain;
  };

  /** All descendants of `id`, depth-first. */
  DesignStore.prototype.getDescendants = function (id) {
    var out = [];
    var self = this;
    (function walk(nodeId) {
      var kids = self.getChildren(nodeId);
      for (var i = 0; i < kids.length; i++) {
        out.push(kids[i]);
        walk(kids[i].id);
      }
    })(id);
    return out;
  };

  /** True when a design has no children — a lineage tip. */
  DesignStore.prototype.isLeaf = function (id) {
    return this.getChildren(id).length === 0;
  };

  /** Depth-first traversal over the whole forest. */
  DesignStore.prototype.traverseDFS = function (visitor) {
    var self = this;
    var order = [];
    var visited = new Set();

    function walk(node, depth) {
      if (!node || visited.has(node.id)) return;
      visited.add(node.id);
      order.push(node);
      if (typeof visitor === 'function') visitor(node, depth);
      var kids = self.getChildren(node.id);
      for (var i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
    }

    var roots = this.getRoots();
    for (var r = 0; r < roots.length; r++) walk(roots[r], 0);
    // Any node unreachable from a root (shouldn't happen) is still emitted.
    for (var i = 0; i < this.designs.length; i++) {
      if (!visited.has(this.designs[i].id)) {
        visited.add(this.designs[i].id);
        order.push(this.designs[i]);
        if (typeof visitor === 'function') visitor(this.designs[i], this.getDepth(this.designs[i].id));
      }
    }
    return order;
  };

  /** Breadth-first traversal over the whole forest. */
  DesignStore.prototype.traverseBFS = function (visitor) {
    var order = [];
    var visited = new Set();
    var queue = this.getRoots().map(function (r) { return { node: r, depth: 0 }; });
    while (queue.length) {
      var item = queue.shift();
      if (!item.node || visited.has(item.node.id)) continue;
      visited.add(item.node.id);
      order.push(item.node);
      if (typeof visitor === 'function') visitor(item.node, item.depth);
      var kids = this.getChildren(item.node.id);
      for (var i = 0; i < kids.length; i++) queue.push({ node: kids[i], depth: item.depth + 1 });
    }
    for (var j = 0; j < this.designs.length; j++) {
      if (!visited.has(this.designs[j].id)) {
        visited.add(this.designs[j].id);
        order.push(this.designs[j]);
        if (typeof visitor === 'function') visitor(this.designs[j], this.getDepth(this.designs[j].id));
      }
    }
    return order;
  };

  /**
   * Bucket designs by depth — the layout primitive the tree renderer consumes.
   * @returns {Object[][]} index = depth
   */
  DesignStore.prototype.getLevels = function () {
    var levels = [];
    for (var i = 0; i < this.designs.length; i++) {
      var d = this.designs[i];
      var depth = this.getDepth(d.id);
      while (levels.length <= depth) levels.push([]);
      levels[depth].push(d);
    }
    return levels;
  };

  /** Structural statistics of the lineage graph. */
  DesignStore.prototype.graphStats = function () {
    var levels = this.getLevels();
    var branchCounts = [];
    for (var i = 0; i < this.designs.length; i++) {
      branchCounts.push(this.getChildren(this.designs[i].id).length);
    }
    var branching = branchCounts.filter(function (c) { return c > 1; }).length;
    return {
      total: this.designs.length,
      roots: this.getRoots().length,
      leaves: branchCounts.filter(function (c) { return c === 0; }).length,
      maxDepth: Math.max(0, levels.length - 1),
      branchPoints: branching,
      maxBranching: branchCounts.length ? Math.max.apply(null, branchCounts) : 0
    };
  };

  /* ---- analysis ---- */

  /** Arithmetic mean of every metric across all designs. */
  DesignStore.prototype.fleetAverage = function () {
    var n = this.designs.length;
    var avg = { name: 'Fleet Average', id: '__fleet_average__' };
    for (var m = 0; m < METRICS.length; m++) {
      var key = METRICS[m].key;
      if (n === 0) { avg[key] = NaN; continue; }
      var acc = 0;
      for (var i = 0; i < n; i++) acc += this.designs[i][key];
      avg[key] = acc / n;
    }
    return avg;
  };

  /** Per-metric min/max across the fleet, used to normalise the radar chart. */
  DesignStore.prototype.metricBounds = function () {
    var bounds = {};
    for (var m = 0; m < METRICS.length; m++) {
      var key = METRICS[m].key;
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < this.designs.length; i++) {
        var v = this.designs[i][key];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      bounds[key] = { min: lo, max: hi };
    }
    return bounds;
  };

  /**
   * Normalise a design's metrics to a 0–100 "goodness" score per axis, where
   * 100 is the best value present in the fleet. Degenerate ranges score 100.
   */
  DesignStore.prototype.normalizedScores = function (design) {
    var bounds = this.metricBounds();
    var out = [];
    for (var m = 0; m < METRICS.length; m++) {
      var key = METRICS[m].key;
      var b = bounds[key];
      var span = b.max - b.min;
      var v = design[key];
      if (!U.isFiniteNumber(v) || !U.isFiniteNumber(span) || span <= 0) {
        out.push(100);
      } else {
        // All metrics minimise, so lower raw value ⇒ higher score.
        out.push(U.clamp((1 - (v - b.min) / span) * 100, 0, 100));
      }
    }
    return out;
  };

  /**
   * Metric-by-metric delta against the parent design.
   * @returns {{hasParent:boolean, parent:Object|null, deltas:Object[]}}
   *   Each delta: {key,label,unit,decimals,from,to,delta,percent,improved,worsened,unchanged}
   */
  DesignStore.prototype.deltaFromParent = function (id) {
    var design = this._byId.get(id);
    if (!design) throw new ReferenceError('Unknown design id: ' + id);
    var parent = this.getParent(id);
    if (!parent) return { hasParent: false, parent: null, deltas: [] };

    var deltas = [];
    for (var m = 0; m < METRICS.length; m++) {
      var metric = METRICS[m];
      var from = parent[metric.key];
      var to = design[metric.key];
      var delta = to - from;
      var percent = from !== 0 ? (delta / Math.abs(from)) * 100 : NaN;
      deltas.push({
        key: metric.key,
        label: metric.label,
        unit: metric.unit,
        decimals: metric.decimals,
        from: from,
        to: to,
        delta: delta,
        percent: percent,
        improved: delta < 0,      // every metric minimises
        worsened: delta > 0,
        unchanged: delta === 0
      });
    }
    return { hasParent: true, parent: parent, deltas: deltas };
  };

  /* ---- trade-off engine ---- */

  function signed(value, decimals) {
    var s = U.fmt(Math.abs(value), decimals);
    if (value > 0) return '+' + s;
    if (value < 0) return '−' + s;
    return '±' + s;
  }

  function joinList(parts) {
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /**
   * Generate the full analytical narrative for one design. Every clause is
   * derived from stored numbers and the live Pareto analysis.
   *
   * @param {string} id
   * @param {Object} paretoAnalysis  Result of SM.Pareto.analyse(store.getAll())
   * @returns {Object} inspection report
   */
  DesignStore.prototype.inspect = function (id, paretoAnalysis) {
    var design = this._byId.get(id);
    if (!design) throw new ReferenceError('Unknown design id: ' + id);

    var deltaInfo = this.deltaFromParent(id);
    var children = this.getChildren(id);
    var ancestry = this.getAncestry(id);
    var fleet = this.fleetAverage();

    var onFrontier = false;
    var dominatedByIds = [];
    var dominatesIds = [];
    var frontRank = null;
    if (paretoAnalysis) {
      onFrontier = paretoAnalysis.frontierIds.has(id);
      dominatedByIds = paretoAnalysis.dominatedBy[id] || [];
      dominatesIds = paretoAnalysis.dominates[id] || [];
      frontRank = paretoAnalysis.rankById[id];
    }

    /* --- why it evolved --- */
    var whyEvolved;
    if (!deltaInfo.hasParent) {
      whyEvolved = design.name + ' is a root design with no parent — the starting point of ' +
                   'this branch of the lineage, against which later iterations are measured.';
    } else {
      var improvedParts = [], worsenedParts = [];
      for (var i = 0; i < deltaInfo.deltas.length; i++) {
        var d = deltaInfo.deltas[i];
        if (d.unchanged) continue;
        var phrase = d.label.toLowerCase() + ' ' + signed(d.delta, d.decimals) +
                     (d.unit === '/10' ? '' : ' ' + d.unit);
        if (d.improved) improvedParts.push(phrase); else worsenedParts.push(phrase);
      }
      whyEvolved = 'Evolved from ' + deltaInfo.parent.name + '. ';
      if (improvedParts.length) whyEvolved += 'It improves ' + joinList(improvedParts) + '. ';
      if (worsenedParts.length) whyEvolved += 'It gives up ' + joinList(worsenedParts) + '. ';
      if (!improvedParts.length && !worsenedParts.length) {
        whyEvolved += 'Every tracked metric is numerically identical to the parent — this ' +
                      'iteration records a change that the tracked metrics do not capture.';
      }
    }

    /* --- advantages / disadvantages vs the fleet --- */
    var advantages = [], disadvantages = [];
    for (var m = 0; m < METRICS.length; m++) {
      var metric = METRICS[m];
      var mine = design[metric.key];
      var avg = fleet[metric.key];
      if (!U.isFiniteNumber(mine) || !U.isFiniteNumber(avg)) continue;
      var diff = mine - avg;
      if (Math.abs(diff) < 1e-12) continue;
      var text = metric.label.toLowerCase() + ' ' + U.fmt(mine, metric.decimals) +
                 (metric.unit === '/10' ? '/10' : ' ' + metric.unit) +
                 ' vs fleet mean ' + U.fmt(avg, metric.decimals);
      if (diff < 0) advantages.push(text); else disadvantages.push(text);
    }

    /* --- dominated metrics: where a frontier design beats this one --- */
    var dominatedMetrics = [];
    if (dominatedByIds.length) {
      var seenKeys = {};
      for (var b = 0; b < dominatedByIds.length; b++) {
        var better = this._byId.get(dominatedByIds[b]);
        if (!better) continue;
        for (var k = 0; k < METRICS.length; k++) {
          var mk = METRICS[k].key;
          if (better[mk] < design[mk] && !seenKeys[mk]) {
            seenKeys[mk] = true;
            dominatedMetrics.push({
              key: mk,
              label: METRICS[k].label,
              by: better.name,
              theirs: better[mk],
              mine: design[mk]
            });
          }
        }
      }
    }

    /* --- Pareto status --- */
    var paretoStatus;
    if (!paretoAnalysis) {
      paretoStatus = 'Pareto analysis unavailable.';
    } else if (onFrontier) {
      paretoStatus = 'Pareto optimal (front 0). No other design in the lineage is better on ' +
                     'both mass and drag simultaneously' +
                     (dominatesIds.length
                       ? ', and it dominates ' + dominatesIds.length + ' other design' +
                         (dominatesIds.length === 1 ? '' : 's') + '.'
                       : '.');
    } else {
      var dominatorNames = dominatedByIds.map(function (did) {
        var dd = this._byId.get(did);
        return dd ? dd.name : did;
      }, this);
      paretoStatus = 'Dominated (front ' + frontRank + '). ' + joinList(dominatorNames) +
                     (dominatedByIds.length === 1 ? ' is' : ' are') +
                     ' better on both mass and drag, so this design is not on the frontier.';
    }

    /* --- trade-off summary --- */
    var tradeOffSummary;
    if (!deltaInfo.hasParent) {
      tradeOffSummary = 'As the baseline of its branch there is no parent trade-off to report. ' +
                        (advantages.length
                          ? 'Against the fleet it leads on ' + joinList(advantages.map(function (a) { return a.split(' ')[0]; })) + '.'
                          : 'It sits at or behind the fleet mean on every tracked metric.');
    } else {
      var gained = deltaInfo.deltas.filter(function (d) { return d.improved; });
      var lost = deltaInfo.deltas.filter(function (d) { return d.worsened; });
      if (gained.length && lost.length) {
        tradeOffSummary = 'This iteration is a genuine trade: it buys ' +
          joinList(gained.map(function (d) { return d.label.toLowerCase(); })) +
          ' at the cost of ' + joinList(lost.map(function (d) { return d.label.toLowerCase(); })) + '.';
      } else if (gained.length) {
        tradeOffSummary = 'A strict improvement over ' + deltaInfo.parent.name +
          ': it is better on ' + joinList(gained.map(function (d) { return d.label.toLowerCase(); })) +
          ' with no measured regression.';
      } else if (lost.length) {
        tradeOffSummary = 'A regression against ' + deltaInfo.parent.name +
          ': worse on ' + joinList(lost.map(function (d) { return d.label.toLowerCase(); })) +
          ' with no measured gain. Retained only if it unlocks something the tracked metrics miss.';
      } else {
        tradeOffSummary = 'Numerically identical to ' + deltaInfo.parent.name +
          ' on every tracked metric.';
      }
    }

    /* --- engineering recommendation --- */
    var recommendation;
    var isTip = children.length === 0;
    if (onFrontier && isTip) {
      recommendation = 'Carry forward. This is a Pareto-optimal lineage tip — the strongest ' +
                       'candidate to develop or race from this branch.';
    } else if (onFrontier && !isTip) {
      recommendation = 'Keep as reference. It remains Pareto optimal, but ' + children.length +
                       ' later iteration' + (children.length === 1 ? '' : 's') +
                       ' already branch from it — compare against those before reopening this line.';
    } else if (!onFrontier && dominatedMetrics.length) {
      var worstBy = dominatedMetrics[0];
      recommendation = 'Deprioritise. ' + worstBy.by + ' already beats it on ' +
                       worstBy.label.toLowerCase() + ' (' + U.fmt(worstBy.theirs, 3) + ' vs ' +
                       U.fmt(worstBy.mine, 3) + ') without giving anything up. Revisit only if a ' +
                       'requirement outside mass and drag makes it necessary.';
    } else {
      recommendation = 'Hold. Not on the frontier, but no single design dominates it outright — ' +
                       'it stays viable as a fallback.';
    }

    return {
      design: design,
      metrics: METRICS,
      notes: design.notes,
      parent: deltaInfo.parent,
      hasParent: deltaInfo.hasParent,
      deltas: deltaInfo.deltas,
      children: children,
      ancestry: ancestry,
      depth: this.getDepth(id),
      isLeaf: isTip,
      fleetAverage: fleet,
      normalizedScores: this.normalizedScores(design),
      fleetNormalizedScores: this.normalizedScores(fleet),
      pareto: {
        onFrontier: onFrontier,
        front: frontRank,
        dominatedBy: dominatedByIds,
        dominates: dominatesIds,
        status: paretoStatus
      },
      advantages: advantages,
      disadvantages: disadvantages,
      dominatedMetrics: dominatedMetrics,
      whyEvolved: whyEvolved,
      tradeOffSummary: tradeOffSummary,
      recommendation: recommendation
    };
  };

  /* ------------------------------------------------------------ seeding */

  /**
   * The team's real Open Nationals iteration history. Seed data only — every
   * number below is stored and then analysed by the engine, never assumed by it.
   */
  var SEED_DESIGNS = [
    { name: 'Concept V1', parentName: null, mass: 68, drag: 0.34, deflection: 1.8, complexity: 4, mfgTime: 3.5,
      notes: 'Baseline block-body concept scaled from reference dimensions; prioritised getting a legal, safe shape onto the track fast.' },
    { name: 'Aero Rev A', parentName: 'Concept V1', mass: 63, drag: 0.27, deflection: 1.6, complexity: 6, mfgTime: 5,
      notes: 'Tapered the nose and raised the rear deck after CFD flagged high pressure drag at the front splitter; complexity rose from the compound curves.' },
    { name: 'Aero Rev B', parentName: 'Aero Rev A', mass: 60, drag: 0.24, deflection: 1.5, complexity: 7, mfgTime: 5.5,
      notes: 'Added a twin-element rear wing. Drag fell further but manufacturing complexity crept up — kept because the drag win outweighed the extra CNC time.' },
    { name: 'Lightweight Rev A', parentName: 'Concept V1', mass: 54, drag: 0.31, deflection: 2.4, complexity: 5, mfgTime: 4,
      notes: 'Hollowed the chassis and switched to a balsa core to chase mass reduction; deflection rose too far so this branch was parked pending a rib redesign.' },
    { name: 'Final Assembly', parentName: 'Aero Rev B', mass: 58, drag: 0.235, deflection: 1.55, complexity: 7, mfgTime: 6,
      notes: 'Merged the Aero Rev B shell with a lightened internal rib pattern borrowed from the Lightweight branch — this is the design that raced at Open Nationals.' }
  ];

  /**
   * Build a store from seed data, resolving parents by name.
   * @returns {DesignStore}
   */
  function createSeededStore() {
    var store = new DesignStore();
    for (var i = 0; i < SEED_DESIGNS.length; i++) {
      var seed = SEED_DESIGNS[i];
      var parentId = null;
      if (seed.parentName) {
        var p = store.getByName(seed.parentName);
        if (!p) throw new ReferenceError('Seed parent not found: ' + seed.parentName);
        parentId = p.id;
      }
      store.add({
        name: seed.name,
        parent: parentId,
        mass: seed.mass,
        drag: seed.drag,
        deflection: seed.deflection,
        complexity: seed.complexity,
        mfgTime: seed.mfgTime,
        notes: seed.notes
      });
    }
    return store;
  }

  root.SM = root.SM || {};
  root.SM.Genealogy = {
    METRICS: METRICS,
    metricByKey: metricByKey,
    DesignStore: DesignStore,
    SEED_DESIGNS: SEED_DESIGNS,
    createSeededStore: createSeededStore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
