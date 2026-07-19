# NetFolderBuilder Pro — Code-Review Fixes & Test Report

All issues from the review were implemented in the suggested fix order and are
covered by automated tests. **32 integration assertions + 8 unit assertions pass;
17 of them were verified to FAIL against the pre-fix code** (negative control),
and all 120 library solids load cleanly through the real UI path with zero page
errors.

Modified files: `js/LayoutManager.js`, `js/App.js`, `js/FoldingRenderer.js`
(plus this report and the README "Recent Fixes" section). All other files are
unchanged.

---

## Fix 1 — Scissors falsy-ID bug (`LayoutManager.js`)

**Bug:** `_canDetachFreeConn` / `_getIsolatedFreePoly` BFS used
`if (other && …)`. Polygon ids start at `0` (falsy), so the BFS could never
traverse *into* the first-placed polygon. A region containing id 0 was
miscounted, and mid-net seams passed the "isolates exactly one face" check —
cutting a 4-chain `0—1—2—3` at `1—2` was allowed, shattering the net.

**Fix:** `other !== null` (matching the already-correct `_getFreeComponent`).

**Tests:** `tests/test-fix1-scissors.js` — 8 assertions: leaf seams detachable,
mid-chain seam rejected, id-0 isolation detected. Browser cross-check in the
integration suite.

## Fix 2 — Library ↔ free-build mode mixing (`App.js`, `LayoutManager.js`)

**Bug:** `loadSolid` never cleared free-build state. Stale free polygons kept
rendering over the library net, and on the next mouse-move
`_syncFreeToLibrary()` replaced the loaded solid with a synthetic
"Free-Built Net" — the solid silently vanished. Symmetrically, placing a
palette shape with a solid loaded destroyed the solid.

**Fix:**
- `App.loadSolid` calls the new `LayoutManager.clearFreeBuild()` (wipes free
  polygons, connections, selection, palette state) before laying out the solid.
- The palette-placement branch in `handleMouseDown` unloads the library solid
  first (polyhedron → null, selector reset, `currentKey` cleared).

**Tests:** build free net → load Cube → mouse-move: solid survives, free state
wiped. Load Cube → place square: clean switch to free mode, selector reset.

## Fix 3 — SVG export crash on empty canvas (`App.js`)

**Bug:** `triggerSvgExport` dereferenced `this.polyhedron.faces` when
`polyhedron` was `null` (startup / after Clear Canvas) — `TypeError`.

**Fix:** early return on null polyhedron / empty layout / non-finite bbox.

**Tests:** export on a fresh page and after Clear Canvas — no throw, no download.

## Fix 4 — GPU memory leak (`FoldingRenderer.js`)

**Bug:** `rebuildFoldingMesh` removed the old pivot subtree without disposing
geometries/materials. Measured on the pre-fix code: `renderer.info.memory.
geometries` grew **67 → 467** over 10 rendered rebuilds of an icosahedron
(+2 geometries/face/rebuild; JS GC cannot reclaim GPU buffers).

**Fix:** new `_disposeGroup` traverses the old subtree and disposes every
geometry and material (array-aware) before removal.

**Tests:** geometry count stable across 10 rendered rebuilds. Note the test
renders a frame between rebuilds — three.js only uploads (and counts) a
geometry once rendered, which is why a naive synchronous loop can't see the leak.

## Fix 5 — Free-net connection endpoints clobbered (`LayoutManager.js`)

**Bug:** `buildFreeNetForFolding` wrote `u: 0, v: 0` into every connection.
`getScissorsAt` and the SVG hinge exporter resolve endpoints via
`parentFace.indexOf(conn.u/v)`, so after any 3D refresh, scissors markers and
exported hinge lines collapsed to vertex 0 until the next mouse-move.

**Fix:** preserve real endpoints (`u: fc.edgeA`, `v: (fc.edgeA + 1) % len`) —
valid because free-net faces are identity index sequences.

**Tests:** after `update3DViewer`, connection keeps `u:1, v:2` and both resolve
on the parent face.

## Fix 6 — Free-net V/E stats (`LayoutManager.js`)

**Bug:** `statV` counted duplicated per-face vertices and
`statE = Σ|faces| / 2` assumed a closed mesh — a lone square reported V:4 E:2,
two joined squares V:8 E:4.

**Fix:** count V by distinct vertex positions and E by distinct edge endpoint
pairs (geometric, tolerance 1e-4).

**Tests:** lone square → V:4 E:4; two edge-sharing squares → V:6 E:7.

## Fix 7 — SVG export ignored per-face colors (`App.js`)

**Bug:** every exported polygon used the global Face Color; per-face colors
set via right-click or Random Proper Coloring were lost.

**Fix:** same fallback chain as the canvas
(`faceColors[idx] → renderParams.colorFace`), rendered with
`fill-opacity="0.2"` so named colors (free-build defaults like `'yellow'`)
work — the old `${hex}33` suffix only worked for hex.

**Tests:** exported SVG contains `#ff0000` / `#00ff00` custom faces, global
fallback for unset faces, and the `fill-opacity` attribute.

---

## Test suite (`tests/`)

| File | What it covers |
|---|---|
| `test-fix1-scissors.js` | Node unit test, Fix 1 (8 assertions) |
| `test-browser.js` | Headless-Chromium integration: Fixes 1–7 + 5-solid regression (32 assertions) |
| `test-all-solids.js` | All 120 solids via the real UI path: Euler-valid stats, complete layouts, spanning trees, fold cycle; free-build lifecycle; zero page errors |

Run them with:

```bash
node tests/test-fix1-scissors.js
node tests/test-browser.js        # needs Chromium at /usr/bin/chromium
node tests/test-all-solids.js     # or edit executablePath in the file
```

### Negative control

The integration suite was also run against the **original pre-fix code**: 17
assertions fail there (every fix is caught by at least one assertion), and all
32 pass on the fixed code — so the tests genuinely discriminate.

### Regression results (fixed code)

- 120/120 solids load through `loadSolid`: stats satisfy V−E+F=2, layouts
  complete, spanning trees have exactly F−1 connections, 0→50→0% fold cycle
  clean.
- Free-build lifecycle (place → proper-color → clear → exports) clean.
- Zero console/page errors across the entire run.
