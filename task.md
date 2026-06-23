# Execution Checklist

- `[x]` Compile 120 polyhedra dataset from `scratch/polyhedra-viewer` into `js/PolyRegistry.js`
- `[x]` Create and run verification script `scratch/verify-registry.mjs`
- `[x]` Create `js/GeometryEngine.js` containing core math, windings, projections, spanning tree, and SAT collisions
- `[x]` Create `js/FoldingRenderer.js` containing Three.js 3D viewer and folding animation logic
- `[x]` Create `js/LayoutManager.js` containing interactive 2D canvas workspace
- `[x]` Create `js/App.js` to orchestrate state, controls, triggers, and exporters
- `[x]` Create `index.css` for custom premium dark-mode styling and animations
- `[x]` Update `index.html` as the app shell loading custom style and modules
- `[x]` Manually verify loading of complex solids (J92), edge-snapping, auto-folding, and exporters
- `[x]` Create walkthrough.md summarizing accomplishments and changes
- `[x]` Fix PolyCategories named export import in App.js to populate Prisms, Antiprisms, and J1-J92 dropdown menu options
- `[x]` Fix FoldingRenderer.js to support 3D rendering of multiple disconnected components
- `[x]` Fix 3D folding angle sign calculation in FoldingRenderer.js using a 2D cross product check
- `[x]` Restore premium 3D graphics (PointLight, GridHelper, unit-based scaling, shadow camera area) in FoldingRenderer.js
- `[x]` Add shrinkPolygon to GeometryEngine.js and use it in LayoutManager.js to fix the SAT false positive overlap warnings
- `[x]` Refactor OBJ exporter index mapping in App.js to use index arrays directly and prevent potential runtime errors
- `[x]` Convert ES6 modules to global scripts using window namespace registration and update index.html to support direct double-clicking via the file:// protocol (resolving CORS policy restrictions)
- `[x]` Correct 2D layout alignment in LayoutManager.js using edge orientation checks (alignReversed) and verify correctness with a custom Node.js sandbox test runner across all 120 polyhedra.

