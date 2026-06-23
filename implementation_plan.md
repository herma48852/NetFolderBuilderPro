# Modular Polyhedron Net Builder & Folding Engine

Refactor the monolithic `one-shot/index.html` into a professional, modular ES6 architecture. Integrate a comprehensive geometry database supporting Platonic solids, Archimedean solids, prisms, antiprisms, and all 92 Johnson solids (J1-J92), sourced and compiled from the local `polyhedra-viewer` clone.

## User Review Required

> [!IMPORTANT]
> The hardcoded `PolyhedraRegistry` will be replaced by a compiled module (`js/PolyRegistry.js`) containing all 120 polyhedra. The dropdown menu in the UI will be dynamically populated and grouped into logical categories (Platonic, Archimedean, Prisms, Antiprisms, Johnson Solids J1-J92) to make navigation seamless.

> [!TIP]
> TailwindCSS styling in the UI will be maintained via CDN in `index.html`, supplemented by custom styling in `index.css` to govern smooth transitions, glassmorphism UI overlays, and JetBrains Mono monospace readouts.

## Open Questions

*No open questions are pending. The math kernels and interactivity rules from `one-shot/index.html` are complete and correct, and the target data format matches perfectly.*

---

## Proposed Changes

### Core Architecture & Geometry Data

#### [NEW] [PolyRegistry.js](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/js/PolyRegistry.js)
Contains the compiled vertex/face coordinates for all 120 polyhedra:
- Platonic solids (5)
- Archimedean solids (13)
- Prisms (5)
- Antiprisms (5)
- Johnson solids (92, J1-J92)

We will use a Node.js compiler script to merge and group the JSON data from `scratch/polyhedra-viewer/src/data/polyhedra/` into this single JavaScript registry module.

#### [NEW] [GeometryEngine.js](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/js/GeometryEngine.js)
Encapsulates mathematical operations:
- Face-winding validation (ensures normals face outward)
- Normal computation (`computeNormal` and `computeFaceNormal3D`)
- Face local 2D projection (`intrinsic2D`)
- Dihedral angles and edge connectivity mapping (`baseEdges`)
- Spanning tree traversal (`activeConnections`) for topological unfolding
- Connected component detection for split nets
- Separating Axis Theorem (SAT) collision checking for 2D overlap warnings

---

### UI & Presentation Layer

#### [NEW] [index.css](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/index.css)
Declares the visual theme:
- Premium dark-theme colors, deep slate backgrounds, and neon-tinted accents (indigo, purple, pink)
- Monospace font styling for geometry readouts (V/E/F stats)
- CSS custom scrollbars and transition states

#### [NEW] [FoldingRenderer.js](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/js/FoldingRenderer.js)
Coordinates the 3D viewer (Three.js + OrbitControls):
- Set up scene, camera, lights, and rendering loop
- Rebuild 3D face geometries and hinges based on 2D layout and fold progress
- Animate individual face rotations along fold seams (hinges) using local coordinate frames
- Toggle wireframes, vertex joint indicators, and face indices
- Update hover states from 2D mouseover actions

#### [NEW] [LayoutManager.js](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/js/LayoutManager.js)
Manages the 2D interactive canvas workspace:
- Render nets with custom colors (face color, overlap color, joint hinges, scissors/seam markers)
- Manage user mouse/touch interactions: dragging faces, panning/zooming, edge snapping detection
- Apply keypress listeners (e.g., `'R'` / `'L'` for face rotating while dragging)
- Handle seam splitting (scissors) and snapping logic

#### [NEW] [App.js](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/js/App.js)
Main application coordinator (AppState):
- Bridge between components
- Manage playback animations (Auto Fold/Unfold) and fold percentage calculations
- Coordinate selector triggers and stat updates (V, E, F counters)
- Trigger SVG and OBJ exports

#### [MODIFY] [index.html](file:///Users/fherman/Documents/gemini/3.5-pre/NetFolderBuilderV2/index.html)
Cleaned-up interface file at the root:
- References external modules: `index.css`, `js/App.js`
- Contains structured HTML layout with Sidebar controls and canvas placeholders
- Loads libraries (Three.js, OrbitControls, Lucide Icons) via CDN

---

## Verification Plan

### Automated Tests
- Build and verify compiling script (`scratch/compile-data.js`) runs successfully to create the JS registry.
- Run a static check using a small verification script (`scratch/verify-registry.js`) to ensure all 120 solids have:
  - Valid `name` properties
  - Valid non-empty `vertices` coordinates
  - Valid non-empty `faces` arrays
  - Normalized scaling

### Manual Verification
- Open the refactored `index.html` in Safari/Chrome.
- Verify that the shape library dropdown displays all Platonic, Archimedean, Prisms, Antiprisms, and Johnson Solids.
- Load multiple complex Johnson solids (e.g., J92) and check that:
  - Spanning tree and 2D net layout compute correctly.
  - The 3D model loads and folds/unfolds smoothly without rendering artifacts.
  - Edge snapping and seam breaking function interactively in the 2D workspace.
  - Exporters (SVG net pattern and OBJ mesh) download files containing the correct data.
