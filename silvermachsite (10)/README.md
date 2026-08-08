# Silver Mach — STEM Racing

Static site for Team SilverMach (STEM Racing Open Nationals 2026), including the
Engineering Analysis Suite: a Monte Carlo race-outcome simulator and an
Engineering Decision Lineage tool with Pareto analysis.

## Deploying to GitHub Pages

1. Push every file in this folder to the repository root.
2. Settings → Pages → **Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo-name>/`.

There is **no build step**. No Node.js, no Python, no bundler, no transpiler.
Every path in the HTML, CSS and JS is relative (`./css/styles.css`,
`./js/app.js`, `./assets/logo.png`), so the site works from a project subpath.

`.nojekyll` is included so GitHub Pages serves the files verbatim rather than
running them through Jekyll.

## Local preview

Open `index.html` by double-clicking it. Classic deferred `<script>` tags are
used rather than ES modules precisely so this works: native `import` is blocked
by CORS on the `file://` scheme.

## Third-party libraries

Chart.js and three.js are loaded by `js/engine/libLoader.js`, which tries
jsDelivr, then unpkg, then cdnjs, and finally the copies in `./vendor/`. The
vendored files mean the site still renders with no network at all.

## Running the engine test suite

Open `tests.html` in a browser. It executes the full 98-assertion validation
suite against the computational engine — no tooling required.

## Layout

```
index.html            main site + Engineering Analysis Suite
greenmach.html        sustainability programme page
tests.html            in-browser engine validation suite
css/                  styles.css (shared), greenmach.css (accent layer)
js/engine/            computational engine + rendering/export modules
js/data/              part copy, roster, CAD geometry
js/                   site.js, car3d.js, app.js, greenmach.js
assets/               logo, team portraits, partner logos
vendor/               offline fallbacks for Chart.js and three.js
```
