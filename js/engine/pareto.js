/* ============================================================================
 * SilverMach Engineering Analysis Suite — pareto.js
 * ----------------------------------------------------------------------------
 * True multi-objective Pareto analysis via fast non-dominated sorting
 * (the O(M·N²) procedure from Deb et al.'s NSGA-II).
 *
 * Design A dominates design B if A is no worse than B on every objective and
 * strictly better on at least one. Designs that no other design dominates form
 * front 0 — the Pareto frontier. Removing that front and repeating yields
 * front 1, front 2, ... giving every design a dominance rank.
 *
 * Default objectives both minimise: mass and aerodynamic drag.
 * Attaches to `SM.Pareto`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;

  /** Objective descriptor: which field, and which direction is better. */
  var DEFAULT_OBJECTIVES = [
    { key: 'mass', direction: 'min', label: 'Mass' },
    { key: 'drag', direction: 'min', label: 'Aerodynamic Drag' }
  ];

  /** Signed comparison normalised so that "smaller is better" always holds. */
  function objectiveValue(item, objective) {
    var raw = item[objective.key];
    if (!U.isFiniteNumber(raw)) {
      throw new RangeError(
        'Objective "' + objective.key + '" is not a finite number on design "' +
        (item.name || item.id || '?') + '".'
      );
    }
    return objective.direction === 'max' ? -raw : raw;
  }

  /**
   * Does `a` dominate `b`?
   * @returns {boolean}
   */
  function dominates(a, b, objectives) {
    var objs = objectives || DEFAULT_OBJECTIVES;
    var strictlyBetterSomewhere = false;
    for (var i = 0; i < objs.length; i++) {
      var av = objectiveValue(a, objs[i]);
      var bv = objectiveValue(b, objs[i]);
      if (av > bv) return false;            // worse on this objective → cannot dominate
      if (av < bv) strictlyBetterSomewhere = true;
    }
    return strictlyBetterSomewhere;
  }

  /**
   * Fast non-dominated sort.
   * @param {Object[]} items
   * @param {Array} [objectives]
   * @returns {{fronts:Object[][], ranks:Map<Object,number>, rankById:Object}}
   */
  function nonDominatedSort(items, objectives) {
    var objs = objectives || DEFAULT_OBJECTIVES;
    var n = items.length;
    var fronts = [];
    var ranks = new Map();
    var rankById = {};

    if (n === 0) return { fronts: fronts, ranks: ranks, rankById: rankById };

    var dominationCount = new Uint32Array(n);   // how many items dominate i
    var dominatedBy = [];                       // items that i dominates
    for (var i = 0; i < n; i++) dominatedBy.push([]);

    for (var p = 0; p < n; p++) {
      for (var q = p + 1; q < n; q++) {
        if (dominates(items[p], items[q], objs)) {
          dominatedBy[p].push(q);
          dominationCount[q]++;
        } else if (dominates(items[q], items[p], objs)) {
          dominatedBy[q].push(p);
          dominationCount[p]++;
        }
      }
    }

    var current = [];
    for (var a = 0; a < n; a++) if (dominationCount[a] === 0) current.push(a);

    var rank = 0;
    while (current.length > 0) {
      var frontItems = [];
      for (var c = 0; c < current.length; c++) {
        var idx = current[c];
        frontItems.push(items[idx]);
        ranks.set(items[idx], rank);
        if (items[idx] && items[idx].id !== undefined) rankById[items[idx].id] = rank;
      }
      fronts.push(frontItems);

      var next = [];
      for (var d = 0; d < current.length; d++) {
        var list = dominatedBy[current[d]];
        for (var e = 0; e < list.length; e++) {
          if (--dominationCount[list[e]] === 0) next.push(list[e]);
        }
      }
      current = next;
      rank++;
    }

    return { fronts: fronts, ranks: ranks, rankById: rankById };
  }

  /**
   * The Pareto frontier — front 0 of the non-dominated sort, returned sorted by
   * the first objective so it can be drawn as a monotone staircase/line.
   * @returns {Object[]}
   */
  function frontier(items, objectives) {
    var objs = objectives || DEFAULT_OBJECTIVES;
    var sorted = nonDominatedSort(items, objs);
    var front = sorted.fronts.length ? sorted.fronts[0].slice() : [];
    front.sort(function (a, b) {
      return objectiveValue(a, objs[0]) - objectiveValue(b, objs[0]);
    });
    return front;
  }

  /**
   * Convenience wrapper returning a decorated analysis for UI consumption.
   * @returns {{frontier:Object[], frontierIds:Set<string>, fronts:Object[][],
   *            rankById:Object, dominatedBy:Object<string,string[]>,
   *            dominates:Object<string,string[]>}}
   */
  function analyse(items, objectives) {
    var objs = objectives || DEFAULT_OBJECTIVES;
    var sorted = nonDominatedSort(items, objs);
    var front = frontier(items, objs);

    var frontierIds = new Set();
    for (var i = 0; i < front.length; i++) frontierIds.add(front[i].id);

    // Explicit pairwise relations, useful for the trade-off narrative.
    var dominatedByMap = {};
    var dominatesMap = {};
    for (var a = 0; a < items.length; a++) {
      dominatedByMap[items[a].id] = [];
      dominatesMap[items[a].id] = [];
    }
    for (var p = 0; p < items.length; p++) {
      for (var q = 0; q < items.length; q++) {
        if (p === q) continue;
        if (dominates(items[p], items[q], objs)) {
          dominatesMap[items[p].id].push(items[q].id);
          dominatedByMap[items[q].id].push(items[p].id);
        }
      }
    }

    return {
      frontier: front,
      frontierIds: frontierIds,
      fronts: sorted.fronts,
      rankById: sorted.rankById,
      dominatedBy: dominatedByMap,
      dominates: dominatesMap,
      objectives: objs
    };
  }

  root.SM = root.SM || {};
  root.SM.Pareto = {
    DEFAULT_OBJECTIVES: DEFAULT_OBJECTIVES,
    objectiveValue: objectiveValue,
    dominates: dominates,
    nonDominatedSort: nonDominatedSort,
    frontier: frontier,
    analyse: analyse
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
