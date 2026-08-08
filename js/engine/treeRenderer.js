/* ============================================================================
 * SilverMach Engineering Analysis Suite — treeRenderer.js
 * ----------------------------------------------------------------------------
 * Renders the Engineering Decision Lineage genealogy tree as ONE self-contained
 * inline SVG, laid out by arithmetic rather than by measuring the DOM.
 *
 * WHY THE PREVIOUS APPROACH FAILED
 * --------------------------------
 * The tree used to be HTML <div> nodes in flex columns with an absolutely
 * positioned <svg> overlay for the connector curves. The connector geometry was
 * derived from getBoundingClientRect() of those divs. But the whole lineage
 * panel starts as `display:none` (the Monte Carlo tab is active first), and an
 * element inside a display:none subtree has no layout box: every rect comes back
 * as zeros. So on first render `wrap.scrollWidth` was 0, the <svg> was sized
 * 0x0, and all four connector paths collapsed to zero-length curves at the
 * origin. The nodes appeared; the lineage structure did not.
 *
 * Measuring layout is also unexportable: an HTML/SVG hybrid cannot be
 * serialised into a standalone file, which is why no tree export existed.
 *
 * THE FIX
 * -------
 * Compute every coordinate from the graph itself — a standard tidy-tree pass:
 * leaves take sequential vertical slots, each parent centres on its children,
 * and depth maps to a column. No getBoundingClientRect, no reflow dependency,
 * so the result is identical whether the panel is visible, hidden, or has never
 * been painted. Because the output is a single SVG element carrying its own
 * <style>, it serialises directly to a valid .svg file and rasterises to .png.
 *
 * Interaction is preserved: each node is a <g> with a data-id and a click
 * handler, and hover/selection styling lives in the embedded stylesheet.
 * ========================================================================== */
(function (root) {
  'use strict';

  var U = root.SM.Utils;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** Geometry and palette. Palette mirrors the site's CSS custom properties. */
  var LAYOUT = {
    nodeWidth: 176,
    nodeHeight: 52,
    columnGap: 64,
    rowGap: 18,
    padding: 18,
    badgeHeight: 16,
    cornerRadius: 10
  };

  var PALETTE = {
    background: 'transparent',
    exportBackground: '#0b0e12',
    nodeFill: '#0b0e12',
    nodeStroke: '#1f242b',
    nodeStrokeSelected: '#2ad6ee',
    nodeStrokeFrontier: '#0e6f7e',
    link: '#2ad6ee',
    name: '#ffffff',
    meta: '#868c95',
    badgeFill: '#2ad6ee',
    badgeText: '#04222a',
    tipFill: '#e8b64c'
  };

  /* SVG text needs an explicit font-family: it does not inherit the page's.
     Kept identical to the CSS/Chart.js stack so exported .svg and .png files
     carry the same typeface as the site. */
  var FONT_STACK = "'BauhausStd Light'," +
                   "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto," +
                   "Helvetica,Arial,sans-serif";

  /* ------------------------------------------------------------- layout */

  /**
   * Tidy-tree layout computed purely from the store's graph.
   *
   * @param {Object} store  SM.Genealogy.DesignStore
   * @returns {{nodes:Object[], links:Object[], width:number, height:number}}
   */
  function computeLayout(store) {
    var all = store.getAll();
    if (!all.length) {
      return { nodes: [], links: [], width: LAYOUT.padding * 2, height: LAYOUT.padding * 2 };
    }

    var positions = Object.create(null);
    var cursor = LAYOUT.padding;   // next free vertical slot
    var visiting = Object.create(null);

    /**
     * Post-order placement: descend first so a parent can centre on the span
     * of its already-placed children.
     */
    function place(design) {
      if (positions[design.id]) return positions[design.id];
      // Guard against a corrupted cycle so layout can never hang.
      if (visiting[design.id]) {
        var fallback = { design: design, depth: store.getDepth(design.id), y: cursor };
        cursor += LAYOUT.nodeHeight + LAYOUT.rowGap;
        positions[design.id] = fallback;
        return fallback;
      }
      visiting[design.id] = true;

      var children = store.getChildren(design.id);
      var entry;

      if (!children.length) {
        entry = { design: design, depth: store.getDepth(design.id), y: cursor };
        cursor += LAYOUT.nodeHeight + LAYOUT.rowGap;
      } else {
        var placedChildren = children.map(place);
        var first = placedChildren[0].y;
        var last = placedChildren[placedChildren.length - 1].y;
        entry = { design: design, depth: store.getDepth(design.id), y: (first + last) / 2 };
      }

      delete visiting[design.id];
      positions[design.id] = entry;
      return entry;
    }

    var roots = store.getRoots();
    for (var r = 0; r < roots.length; r++) place(roots[r]);
    // Any node unreachable from a root still gets a slot.
    for (var a = 0; a < all.length; a++) if (!positions[all[a].id]) place(all[a]);

    var nodes = [];
    var maxRight = 0;
    var maxBottom = 0;

    for (var i = 0; i < all.length; i++) {
      var entry2 = positions[all[i].id];
      var x = LAYOUT.padding + entry2.depth * (LAYOUT.nodeWidth + LAYOUT.columnGap);
      var node = {
        id: all[i].id,
        design: all[i],
        depth: entry2.depth,
        x: x,
        y: entry2.y,
        width: LAYOUT.nodeWidth,
        height: LAYOUT.nodeHeight,
        centerY: entry2.y + LAYOUT.nodeHeight / 2
      };
      nodes.push(node);
      if (x + LAYOUT.nodeWidth > maxRight) maxRight = x + LAYOUT.nodeWidth;
      if (entry2.y + LAYOUT.nodeHeight > maxBottom) maxBottom = entry2.y + LAYOUT.nodeHeight;
    }

    var byId = Object.create(null);
    for (var n = 0; n < nodes.length; n++) byId[nodes[n].id] = nodes[n];

    var links = [];
    for (var k = 0; k < nodes.length; k++) {
      var parentId = nodes[k].design.parent;
      if (!parentId || !byId[parentId]) continue;
      links.push({ from: byId[parentId], to: nodes[k] });
    }

    return {
      nodes: nodes,
      links: links,
      byId: byId,
      width: maxRight + LAYOUT.padding,
      height: maxBottom + LAYOUT.padding
    };
  }

  /* -------------------------------------------------------------- build */

  function svgEl(name, attrs) {
    var node = root.document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    }
    return node;
  }

  /** Stylesheet embedded in the SVG so a serialised export keeps its styling. */
  function embeddedStyle() {
    return [
      '.sm-tree-node{cursor:pointer}',
      '.sm-tree-box{transition:stroke .18s ease,filter .18s ease}',
      '.sm-tree-node:hover .sm-tree-box{stroke:' + PALETTE.nodeStrokeSelected + '}',
      '.sm-tree-node.is-selected .sm-tree-box{stroke:' + PALETTE.nodeStrokeSelected +
        ';stroke-width:2;filter:url(#sm-tree-glow)}',
      '.sm-tree-name{font:600 13px ' + FONT_STACK + ';fill:' + PALETTE.name + '}',
      '.sm-tree-meta{font:400 10.5px ' + FONT_STACK + ';fill:' + PALETTE.meta + '}',
      '.sm-tree-badge-text{font:800 9px ' + FONT_STACK + ';fill:' + PALETTE.badgeText +
        ';letter-spacing:.4px}',
      '.sm-tree-link{fill:none;stroke:' + PALETTE.link + ';stroke-opacity:.45;stroke-width:1.5}'
    ].join('');
  }

  /**
   * Build the complete SVG element for a lineage.
   *
   * @param {Object} store
   * @param {Object} paretoAnalysis  from SM.Pareto.analyse (may be null)
   * @param {{selectedId?:string, onSelect?:function(string):void,
   *          forExport?:boolean}} [options]
   * @returns {SVGSVGElement}
   */
  function buildSVG(store, paretoAnalysis, options) {
    options = options || {};
    var layout = computeLayout(store);

    var svg = svgEl('svg', {
      xmlns: SVG_NS,
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      width: layout.width,
      height: layout.height,
      viewBox: '0 0 ' + layout.width + ' ' + layout.height,
      role: 'img',
      'aria-label': 'Engineering decision lineage genealogy tree'
    });
    svg.classList.add('sm-tree-svg');

    var defs = svgEl('defs');
    var filter = svgEl('filter', {
      id: 'sm-tree-glow', x: '-40%', y: '-40%', width: '180%', height: '180%'
    });
    filter.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '3', result: 'blur' }));
    var merge = svgEl('feMerge');
    merge.appendChild(svgEl('feMergeNode', { in: 'blur' }));
    merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    var style = svgEl('style');
    style.textContent = embeddedStyle();
    svg.appendChild(style);

    // Opaque backing only for exports; on-page the card's own background shows.
    if (options.forExport) {
      svg.insertBefore(svgEl('rect', {
        x: 0, y: 0, width: layout.width, height: layout.height, fill: PALETTE.exportBackground
      }), defs);
    }

    /* ---- links first so nodes paint on top ---- */
    var linkGroup = svgEl('g', { 'class': 'sm-tree-links' });
    for (var l = 0; l < layout.links.length; l++) {
      var from = layout.links[l].from;
      var to = layout.links[l].to;
      var x1 = from.x + from.width;
      var y1 = from.centerY;
      var x2 = to.x;
      var y2 = to.centerY;
      var mid = (x1 + x2) / 2;
      linkGroup.appendChild(svgEl('path', {
        'class': 'sm-tree-link',
        d: 'M' + x1 + ',' + y1 + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2
      }));
    }
    svg.appendChild(linkGroup);

    /* ---- nodes ---- */
    var nodeGroup = svgEl('g', { 'class': 'sm-tree-nodes' });
    for (var n = 0; n < layout.nodes.length; n++) {
      nodeGroup.appendChild(buildNode(layout.nodes[n], store, paretoAnalysis, options));
    }
    svg.appendChild(nodeGroup);

    return svg;
  }

  function buildNode(node, store, paretoAnalysis, options) {
    var design = node.design;
    var onFrontier = !!(paretoAnalysis && paretoAnalysis.frontierIds &&
                        paretoAnalysis.frontierIds.has(design.id));
    var isSelected = design.id === options.selectedId;
    var isTip = store.isLeaf(design.id);

    var group = svgEl('g', {
      'class': 'sm-tree-node' + (isSelected ? ' is-selected' : ''),
      'data-id': design.id,
      transform: 'translate(' + node.x + ',' + node.y + ')'
    });

    group.appendChild(svgEl('rect', {
      'class': 'sm-tree-box',
      x: 0, y: 0, width: node.width, height: node.height,
      rx: LAYOUT.cornerRadius, ry: LAYOUT.cornerRadius,
      fill: PALETTE.nodeFill,
      stroke: isSelected ? PALETTE.nodeStrokeSelected
        : (onFrontier ? PALETTE.nodeStrokeFrontier : PALETTE.nodeStroke),
      'stroke-width': isSelected ? 2 : 1
    }));

    var name = svgEl('text', { 'class': 'sm-tree-name', x: 13, y: 21 });
    name.textContent = truncate(design.name, 21);
    group.appendChild(name);

    var meta = svgEl('text', { 'class': 'sm-tree-meta', x: 13, y: 38 });
    meta.textContent = U.fmt(design.mass, 1) + ' g · Cd ' + U.fmt(design.drag, 3) +
                       (isTip ? ' · tip' : '');
    group.appendChild(meta);

    if (onFrontier) {
      var label = 'pareto';
      var badgeWidth = label.length * 5.4 + 12;
      var badge = svgEl('g', {
        transform: 'translate(' + (node.width - badgeWidth - 8) + ',' + (-LAYOUT.badgeHeight / 2) + ')'
      });
      badge.appendChild(svgEl('rect', {
        x: 0, y: 0, width: badgeWidth, height: LAYOUT.badgeHeight,
        rx: LAYOUT.badgeHeight / 2, ry: LAYOUT.badgeHeight / 2, fill: PALETTE.badgeFill
      }));
      var badgeText = svgEl('text', {
        'class': 'sm-tree-badge-text', x: badgeWidth / 2, y: 11, 'text-anchor': 'middle'
      });
      badgeText.textContent = label;
      badge.appendChild(badgeText);
      group.appendChild(badge);
    }

    // Full detail on hover, useful because the label is truncated.
    var title = svgEl('title');
    title.textContent = design.name + ' — ' + U.fmt(design.mass, 2) + ' g, Cd ' +
      U.fmt(design.drag, 3) + ', deflection ' + U.fmt(design.deflection, 2) + ' mm, complexity ' +
      U.fmt(design.complexity, 1) + '/10, build ' + U.fmt(design.mfgTime, 2) + ' hrs';
    group.appendChild(title);

    if (typeof options.onSelect === 'function') {
      group.addEventListener('click', function () { options.onSelect(design.id); });
    }
    return group;
  }

  function truncate(text, max) {
    var s = String(text);
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
  }

  /**
   * Replace the contents of a container with a freshly built tree.
   * Rebuilding wholesale means old nodes are garbage collected together with
   * their click handlers, so listeners cannot accumulate across renders.
   *
   * @returns {SVGSVGElement|null}
   */
  function renderInto(container, store, paretoAnalysis, options) {
    if (!container || !store) return null;
    while (container.firstChild) container.removeChild(container.firstChild);
    var svg = buildSVG(store, paretoAnalysis, options);
    container.appendChild(svg);
    return svg;
  }

  /** Mark one node selected without rebuilding the whole tree. */
  function setSelected(container, id) {
    if (!container) return;
    var nodes = container.querySelectorAll('.sm-tree-node');
    for (var i = 0; i < nodes.length; i++) {
      var match = nodes[i].getAttribute('data-id') === id;
      nodes[i].classList.toggle('is-selected', match);
      var box = nodes[i].querySelector('.sm-tree-box');
      if (box) {
        box.setAttribute('stroke', match ? PALETTE.nodeStrokeSelected
          : (box.getAttribute('data-base-stroke') || box.getAttribute('stroke')));
        box.setAttribute('stroke-width', match ? 2 : 1);
      }
    }
  }

  /* ------------------------------------------------------------- export */

  /**
   * Serialise a standalone, self-contained SVG document string.
   * Built fresh with `forExport` so the file carries an opaque background
   * instead of inheriting the page's.
   *
   * @returns {string}
   */
  function toSVGString(store, paretoAnalysis, options) {
    var opts = Object.assign({}, options || {}, { forExport: true, onSelect: null });
    var svg = buildSVG(store, paretoAnalysis, opts);
    var serialized = new root.XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + serialized;
  }

  /**
   * UTF-8 safe base64. The tree text contains '·' and '…', which plain btoa()
   * cannot encode — it throws InvalidCharacterError on any code point > 0xFF.
   */
  function base64Utf8(text) {
    var bytes = new root.TextEncoder().encode(text);
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return root.btoa(binary);
  }

  /**
   * Rasterise the tree to a PNG data URL at `scale`x resolution.
   * @returns {Promise<string>}
   */
  function toPNGDataURL(store, paretoAnalysis, options, scale) {
    var factor = scale || 2;
    var svgText = toSVGString(store, paretoAnalysis, options);
    var layout = computeLayout(store);

    return new Promise(function (resolve, reject) {
      var image = new root.Image();
      // A data: URL keeps the image same-origin, so the canvas stays untainted
      // and toDataURL() will not throw a SecurityError.
      image.src = 'data:image/svg+xml;base64,' + base64Utf8(svgText);

      image.onload = function () {
        try {
          var canvas = root.document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(layout.width * factor));
          canvas.height = Math.max(1, Math.round(layout.height * factor));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = PALETTE.exportBackground;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.setTransform(factor, 0, 0, factor, 0, 0);
          ctx.drawImage(image, 0, 0, layout.width, layout.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      image.onerror = function () {
        reject(new Error('Could not rasterise the lineage tree SVG.'));
      };
    });
  }

  root.SM = root.SM || {};
  root.SM.TreeRenderer = {
    LAYOUT: LAYOUT,
    PALETTE: PALETTE,
    computeLayout: computeLayout,
    buildSVG: buildSVG,
    renderInto: renderInto,
    setSelected: setSelected,
    toSVGString: toSVGString,
    toPNGDataURL: toPNGDataURL,
    base64Utf8: base64Utf8
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
