/* ============================================================================
 * SilverMach Engineering Analysis Suite — libLoader.js
 * ----------------------------------------------------------------------------
 * Resilient loader for the two third-party libraries the site needs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous build loaded Chart.js from:
 *     https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js
 * That file does not exist. Chart.js 4.4.x publishes `chart.umd.js` only — there
 * is no pre-minified `chart.umd.min.js` in the npm dist folder that cdnjs
 * mirrors, so the request returned 404, `window.Chart` stayed undefined, and
 * every canvas silently rendered blank while exports reported "run the
 * simulation first".
 *
 * A single hardcoded CDN URL is a single point of failure. This loader instead
 * walks an ordered chain of sources and resolves on the first that works:
 *
 *     jsDelivr → unpkg → cdnjs (correct filename) → ./vendor/ (bundled copy)
 *
 * The local vendored copy is the final link, so the page renders even when the
 * network is unavailable, a CDN is blocked by a corporate proxy, or a future CDN
 * path changes again. Nothing here is a build step: `vendor/` is just two files
 * committed to the repository and served statically.
 *
 * Every URL is versioned and ends in an explicit `.js` extension. The local
 * paths are relative (`./vendor/...`) so they resolve correctly when the site is
 * hosted from a GitHub Pages subpath such as `user.github.io/repo-name/`.
 * ========================================================================== */
(function (root) {
  'use strict';

  var CHART_SOURCES = [
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js',
    'https://unpkg.com/chart.js@4.4.4/dist/chart.umd.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.js',
    './vendor/chart.umd.js'
  ];

  var THREE_SOURCES = [
    'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
    'https://unpkg.com/three@0.128.0/build/three.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    './vendor/three.min.js'
  ];

  /** Per-library load state, so a second caller reuses the first attempt. */
  var pending = {};

  /**
   * Inject one classic <script> and settle when it loads or errors.
   * A script tag is used rather than fetch() so no CORS headers are required
   * from the CDN and the library installs itself on `window` exactly as its
   * UMD build expects.
   *
   * @param {string} url
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  function loadScript(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var script = root.document.createElement('script');
      var settled = false;
      var timer = null;

      function finish(ok, reason) {
        if (settled) return;
        settled = true;
        if (timer !== null) root.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (ok) resolve();
        else reject(new Error(reason));
      }

      script.src = url;
      script.async = false;          // preserve execution order

      // crossOrigin must only be set for genuinely cross-origin http(s) sources.
      // Setting it on a relative path makes the browser apply a CORS check to a
      // same-origin request, and under the file:// scheme that check always
      // fails — which silently broke the ./vendor/ fallback when the page was
      // opened by double-clicking it rather than served over http.
      if (/^https?:\/\//i.test(url)) script.crossOrigin = 'anonymous';

      script.onload = function () { finish(true); };
      script.onerror = function () { finish(false, 'network or 404: ' + url); };

      // A hung CDN must not stall the page forever.
      timer = root.setTimeout(function () { finish(false, 'timeout: ' + url); },
        timeoutMs || 8000);

      root.document.head.appendChild(script);
    });
  }

  /**
   * Walk a source chain until the global appears.
   *
   * @param {string} globalName  Property expected on window (e.g. 'Chart').
   * @param {string[]} sources
   * @param {number} [timeoutMs]
   * @returns {Promise<{source:string, attempts:Array}>}
   */
  function loadFirstAvailable(globalName, sources, timeoutMs) {
    if (root[globalName]) {
      return Promise.resolve({ source: 'already-present', attempts: [] });
    }
    if (pending[globalName]) return pending[globalName];

    var attempts = [];

    var chain = sources.reduce(function (promise, url) {
      return promise.catch(function () {
        return loadScript(url, timeoutMs).then(function () {
          // A CDN can return 200 with an HTML error page; verify the global.
          if (!root[globalName]) {
            attempts.push({ url: url, ok: false, reason: 'loaded but ' + globalName + ' undefined' });
            throw new Error(globalName + ' undefined after ' + url);
          }
          attempts.push({ url: url, ok: true });
          return { source: url, attempts: attempts };
        }).catch(function (err) {
          if (!attempts.length || attempts[attempts.length - 1].url !== url) {
            attempts.push({ url: url, ok: false, reason: err.message });
          }
          throw err;
        });
      });
    }, Promise.reject(new Error('start')));

    pending[globalName] = chain.catch(function () {
      var detail = attempts.map(function (a) {
        return (a.ok ? 'OK ' : 'FAIL ') + a.url + (a.reason ? ' (' + a.reason + ')' : '');
      }).join(' | ');
      throw new Error('Could not load ' + globalName + '. Tried: ' + detail);
    });

    return pending[globalName];
  }

  function loadChart(timeoutMs) {
    return loadFirstAvailable('Chart', CHART_SOURCES, timeoutMs);
  }

  function loadThree(timeoutMs) {
    return loadFirstAvailable('THREE', THREE_SOURCES, timeoutMs);
  }

  root.SM = root.SM || {};
  root.SM.LibLoader = {
    CHART_SOURCES: CHART_SOURCES,
    THREE_SOURCES: THREE_SOURCES,
    loadScript: loadScript,
    loadFirstAvailable: loadFirstAvailable,
    loadChart: loadChart,
    loadThree: loadThree
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
