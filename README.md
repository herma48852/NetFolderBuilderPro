# NetFolderBuilder Pro

**Universal Topology Engine for Polyhedron Nets** — build, unfold, snap, and fold the nets of all 120 convex uniform polyhedra (the 5 Platonic, 13 Archimedean, 5 prisms, 5 antiprisms, and 92 Johnson solids J1–J92), or construct your own free-form nets from a regular-polygon palette and watch them fold into 3D.

NetFolderBuilder Pro is a single-page, browser-based tool that pairs an interactive 2D net editor with a live Three.js 3D folding viewer. It runs out-of-the-box by double-clicking `index.html` — no build step, no server, no dependencies to install.

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [Architecture](#architecture)
- [Geometry & Math](#geometry--math)
- [The Library Database](#the-library-database)
- [Exporters](#exporters)
- [Project Structure](#project-structure)
- [Recent Fixes](#recent-fixes)
- [Limitations & Known Behaviors](#limitations--known-behaviors)
- [Credits](#credits)

---

## Features

### Library mode — all 120 convex uniform polyhedra
- Browse the full catalog grouped by category: **Platonic**, **Archimedean**, **Prisms**, **Antiprisms**, and **Johnson Solids (J1–J92)**.
- Selecting a solid auto-generates its spanning-tree net (a single connected, non-overlapping 2D unfolding) and renders the folded 3D solid beside it.
- Live V / E / F counters (vertices, edges, faces) and a net-validity indicator that turns red when the SAT overlap detector finds overlapping faces.

### Free-build mode — design your own nets
- Six regular polygons on the palette: **Triangle, Square, Pentagon, Hexagon, Octagon, Decagon**.
- Click to place, then drag, rotate, and snap pieces together along matching-length edges.
- Build any connected net you like — it doesn't have to match a library member.

### Folding viewer (3D)
- Animated **Auto Fold** playback that swings faces up along their hinges to the target dihedral angle, then back down, on a loop.
- Manual fold control via the **Fold Mechanics** slider (0–100%).
- Premium dark-mode 3D scene with directional + colored point lighting, soft shadows, and a grid floor.
- Orbit / pan / zoom with the mouse.
- Toggles for **wireframe**, **joint vertices**, **face indices**, and **SAT collision detection**.

### Interaction & editing
- **Drag** any face to relocate its whole connected region.
- **`R` / `L` keys** rotate the selected (or hovered) connected region — the selected face is the pivot; the rest of the region swings around it as a rigid body. No detachment occurs.
- **Scissors (✂️)** appear at every detachable seam; clicking one splits a region (only when it isolates exactly one face).
- **Edge snapping** — drag an open edge near another open edge of equal length and a dashed pink guide appears; release to snap and weld the seam.
- **Right-click** any face (library or free-build) for a color context menu: per-polygon-type defaults, recent custom colors, or a free-form color picker.
- **Random Proper Coloring** — click the button in the sidebar to assign every face a random color such that no two edge-adjacent faces share a color (proper graph coloring). Works on library solids and free-build nets alike.
- **Global Face Color** and **Snap Seam** color pickers in the sidebar.

### Smart folding for custom nets
When a free-built net does not exactly match any library member, NetFolderBuilder Pro searches the database for the **smallest (fewest-faces) library solid that contains the net as a connected subset**, and folds the net as an incomplete member of that solid — inheriting its dihedral angles. An **Incomplete Fold** banner annotates the builder panel (e.g. *"Folding as an incomplete Tetrahedron — 2 of 4 faces present"*), and the header shows a `subset of <name>` badge.

### Exporters
- **SVG Net Pattern** — the flat 2D net with face fills and dashed hinge lines.
- **OBJ Folded Mesh** — the 3D mesh at the current fold percentage, in Wavefront OBJ format.

---

## Screenshots

Screenshots live in the [`screenshots/`](screenshots) directory.

---

## Quick Start

No build tools required. Pick either option:

### Option A — double-click (file:// protocol)
Just open `index.html` in your browser. The scripts are loaded as classic `<script>` tags that register on the `window` namespace, so there are no CORS/ES-module restrictions.

### Option B — local server (recommended for development)
```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000/
```

### Requirements
- A modern browser with WebGL support (Chrome, Edge, Firefox, Safari).
- An internet connection on first load (Three.js, OrbitControls, Tailwind CSS, Lucide icons, and Google Fonts are pulled from CDNs).

---

## How to Use

### Load a library solid
1. Pick a solid from the **Polyhedron Library** dropdown at the top of the sidebar.
2. Its net appears in the 2D editor (left) and the folded solid in the 3D viewer (right).
3. Drag the **Fold Mechanics** slider or press **Auto Fold** to animate.

### Build a net from scratch
1. Click a shape in the **Free Build Palette** (your cursor turns to `copy`).
2. Click on the 2D canvas to place it. Repeat with more shapes.
3. **Drag** a shape's open edge near another shape's open edge of the same length — a dashed pink guide appears. Release the mouse to snap them together.
4. Press **`R`** (clockwise) or **`L`** (counter-clockwise) while a face is selected or hovered to rotate that face's whole connected region around the face.
5. Click a **✂️ scissors** marker at a seam to detach the lone face on that side.
6. Right-click a face to recolor it.
7. Use the fold slider / Auto Fold to watch your custom net fold in 3D.

### Tips
- **Scroll** to zoom; **drag empty space** to pan.
- The header's **NET VALID** pill turns into **OVERLAP WARNING** (red) when faces overlap in the 2D layout.
- The **Clear Canvas** button wipes everything and resets the selector.
- Click **Random Proper Coloring** in the Render Parameters section to instantly recolor every face so that no two edge-adjacent faces share a color. The result is always a valid graph coloring, with random variation each click.

---

## Architecture

NetFolderBuilder Pro is written in vanilla JavaScript (no framework, no bundler). Each module is a classic script that attaches its class/namespace to `window`, loaded in order by `index.html`:

```
index.html
  └─ js/PolyRegistry.js     ← 120 polyhedra (vertices/faces) + PolyCategories
  └─ js/GeometryEngine.js   ← math: normals, windings, 2D projection, spanning tree, SAT
  └─ js/PolyDatabase.js     ← face-count → polyhedron lookup, dihedral maps, superset matching
  └─ js/Polygon.js          ← regular-polygon primitive for free-build mode
  └─ js/LayoutManager.js    ← 2D canvas: drag, snap, rotate, scissors, colors, sync
  └─ js/FoldingRenderer.js  ← Three.js 3D viewer: pivot hierarchy, fold animation
  └─ js/App.js              ← AppState coordinator: UI bindings, stats, exporters, loop
```

### `App.js` — `AppState`
The central coordinator. Owns the global render parameters, wires up DOM listeners (selector, fold slider, checkboxes, color pickers, exporters), populates the library dropdown from `PolyCategories`, drives the auto-fold animation loop, and triggers SVG/OBJ export. Delegates 2D work to `LayoutManager` and 3D work to `FoldingRenderer`.

### `LayoutManager.js`
The 2D interactive canvas. Responsibilities:
- **Layout generation** — builds the flat net from a library solid via a BFS spanning tree over shared edges, aligning each child face's edge to its parent's edge (with a winding-reversal check to fold faces outward instead of overlapping).
- **Free-build data model** — `freePolygons` (regular polygons with center/rotation/color) and `freeConnections` (snapped seams), kept in sync with the library-format `faceCoords2D` / `connections` via `_syncFreeToLibrary` / `_syncLibraryToFree`.
- **Interaction** — mouse drag (whole connected component), pan, wheel zoom, `R`/`L` rotate (region around selected face as pivot), `Delete`/`Backspace` remove, edge-snap detection with visual guides, scissors detach (only when it isolates one face), right-click color menu.
- **Overlap detection** — runs SAT (Separating Axis Theorem) on shrunk polygons every frame.
- **Incomplete-fold matching** — when a free net has no exact library match, queries `PolyDatabase.bestSuperset` for the smallest containing member and inherits its dihedral angles; annotates the builder panel via the **Incomplete Fold** banner.
- **Proper graph coloring** — `applyRandomProperColoring()` greedily colors the face-adjacency graph so no two edge-sharing faces share a color. Uses an 8-color palette with random shuffling, so each click produces a different valid coloring. Adjacency is detected via shared vertex indices (library solids) or geometric edge matching (free-build synthetic polyhedra).

### `FoldingRenderer.js`
The Three.js 3D viewer. Builds a nested pivot hierarchy: each face is parented to a pivot group positioned at its shared edge with the parent face, so rotating a pivot swings its whole subtree. Per-component root pivots are placed at the face centroid. Dihedral angles come from 3D normals (library solids) or from the matched/inherited map (free-build nets). A 2D cross-product sign check decides whether each face folds inward or outward.

### `GeometryEngine.js`
Static math utilities: Newell-method face normals, winding validation via signed volume, local 2D face projection (`intrinsic2D`), adjacency tree + BFS spanning tree, polygon shrink (for SAT tolerance), and SAT collision test.

### `PolyDatabase.js`
Builds a face-count-signature → polyhedron lookup table from `PolyRegistry` at load time, precomputing each solid's external dihedral-angle map and per-face neighbour-type adjacency. Public API:
- `findMatches(counts)` — exact face-count matches.
- `defaultDihedrals(counts)` — dihedral map of the first exact match.
- `bestSuperset(counts, netFaceAdj, netFaceSides)` — the smallest (fewest-total-faces) library solid whose face counts are a superset of the net's and whose faces can host the net as a connected subset (verified by bipartite matching via Kuhn's algorithm). Used for incomplete-fold detection.

### `Polygon.js`
A regular-polygon primitive (triangle … decagon) with absolute-vertex computation, point-in-polygon test, per-side default colors, and JSON serialization. Used only in free-build mode.

### `PolyRegistry.js`
The compiled dataset: vertices and faces for all 120 convex uniform polyhedra, plus the `PolyCategories` array that drives the grouped dropdown.

---

## Geometry & Math

### Net generation
For a library solid, a **BFS spanning tree** over face-edge adjacency selects a set of hinge edges that connects all faces without cycles. Each face is then laid out in 2D by projecting its 3D vertices into the local frame of its parent's shared edge and rigidly aligning the child edge to the parent edge. A winding check (`alignReversed` when `pU === cV && pV === cU`) flips the child projection outward so faces don't stack on top of each other.

### Folding
Each hinge edge becomes a **pivot** in a Three.js group hierarchy. Folding is parametrized by a single scalar `t ∈ [0, 1]` (the fold percentage). At fold time each non-root face's pivot rotates about its hinge by `dihedralAngle × t`. The sign of the rotation is chosen by a 2D cross product between the shared edge direction and the vector to the child face's centroid, so faces fold to the correct side (inward vs outward).

### Dihedral angles
- **Library solids**: computed exactly from the 3D face normals (`acos(nA · nB)`).
- **Free-built nets**: looked up from the matched library member's dihedral map by face-type pair key (`"minSides-maxSides"`). If the net exactly matches a library member's face counts, that member's angles are used. Otherwise the smallest containing superset member supplies them; any unmatched face-pair type falls back to a generic default table.

### Overlap detection
Each frame, every pair of 2D faces is tested with the **Separating Axis Theorem**. To avoid false positives on edges that merely touch, polygons are shrunk by a factor of 0.96 about their centroid before testing. Overlapping faces are highlighted red and the header indicator switches to **OVERLAP WARNING**.

### Incomplete-fold (subset) matching
When a free net's face counts don't exactly match any library solid, `PolyDatabase.bestSuperset` searches every solid whose face counts are a superset of the net's. For each candidate, a **bipartite matching** (Kuhn's algorithm) verifies that every net face can be assigned to a distinct solid face of the same type whose neighbour-type counts cover the net face's requirements — an adjacency-aware proxy for "the net is a connected subgraph of the solid." The candidate with the **fewest total faces** wins; its dihedrals are inherited and the builder panel is annotated.

### Proper graph coloring
The **Random Proper Coloring** feature solves a graph-coloring problem on the polyhedron's face-adjacency graph. Two faces are adjacent iff they share an edge. Adjacency is detected by:
- **Library solids**: shared vertex indices in the polyhedron's face arrays (an edge is a pair of vertex indices; two faces sharing the same pair are adjacent).
- **Free-build synthetic polyhedra**: vertices are unique per face (no index sharing), so edges are matched geometrically by endpoint position within `1e-3` tolerance. Two faces with coincident edge endpoints in 3D space are adjacent.

With the adjacency graph built, `applyRandomProperColoring()` runs a greedy proper-coloring algorithm:
1. The face order is randomly shuffled for variety.
2. An 8-color palette (red, amber, yellow, green, cyan, blue, violet, pink) is randomly shuffled each invocation.
3. For each face in order, the algorithm collects colors already used by its colored neighbours, then picks a random colour from the palette that is **not** in that forbidden set.
4. If all eight colours are exhausted (impossible for any planar graph by the four-color theorem), a fallback picks randomly from the palette.

The result is a proper coloring (no two adjacent faces share a colour) that differs each time the button is clicked. Colours are written to `polyhedron.faceColors` for the 3D renderer and mirrored to `freePolygons[i].color` for free-build 2D rendering.

---

## The Library Database

The 120 solids come from the [polyhedra-viewer](https://github.com/ttezee/polyhedra-viewer) dataset, compiled into `js/PolyRegistry.js`. Categories:

| Category | Count | Examples |
|---|---|---|
| Platonic Solids (Regular) | 5 | Tetrahedron, Cube, Octahedron, Dodecahedron, Icosahedron |
| Archimedean Solids (Semi-Regular) | 13 | Truncated Tetrahedron, Cuboctahedron, Icosidodecahedron, … |
| Prisms (Uniform) | 5 | Triangular, Square, Pentagonal, Hexagonal, Octagonal Prism |
| Antiprisms (Uniform) | 5 | Square, Pentagonal, Hexagonal, Heptagonal, Octagonal Antiprism |
| Johnson Solids (J1–J92) | 92 | Pyramid, Bicupola, Hebesphenorotunda (J92), … |

Each entry has:
```js
{
  "name": "Tetrahedron",
  "vertices": [[x,y,z], ...],
  "faces":    [[v0,v1,v2,...], ...]
}
```

---

## Exporters

### SVG Net Pattern
Downloads an `.svg` of the current 2D net. Each face is a `<polygon>` filled with the face color at low opacity and stroked in slate. Hinge (interior connection) edges are drawn as dashed lines in the snap-seam color.

### OBJ Folded Mesh
Downloads a `.obj` of the 3D mesh at the current fold percentage. Traverses the pivot hierarchy, bakes each face's vertices to world space, and emits `v`/`f` records.

---

## Project Structure

```
NetFolderBuilderV2/
├── index.html              # App shell: layout, CDN loads, module script tags
├── index.css               # Premium dark theme, fonts, scrollbars, color context menu
├── js/
│   ├── PolyRegistry.js     # 120 polyhedra dataset + PolyCategories groups
│   ├── GeometryEngine.js   # Normals, windings, 2D projection, spanning tree, SAT
│   ├── PolyDatabase.js     # Face-count lookup, dihedrals, bipartite superset matching
│   ├── Polygon.js          # Regular-polygon primitive (free-build mode)
│   ├── LayoutManager.js    # 2D canvas editor: drag/snap/rotate/scissors/color
│   ├── FoldingRenderer.js  # Three.js 3D viewer: pivot hierarchy + fold animation
│   └── App.js              # AppState: UI wiring, stats, exporters, animation loop
├── screenshots/            # UI screenshots
├── one-shot/               # Original monolithic prototype (for reference)
├── implementation_plan.md  # Original refactoring plan
├── implementation_plan.html
├── task.md                 # Execution checklist
└── walkthrough.md          # Implementation & QA walkthrough
```

---

## Recent Fixes

Three issues addressed in the latest pass:

1. **Color palette broken for library members.** After recoloring a single library face, the `faceColors` array became sparse and the 2D renderer crashed on `undefined.startsWith('#')`, making the palette appear dead. Fixed by falling back to the global Face Color for unset entries. (`LayoutManager.draw`)

2. **Incomplete-fold detection & annotation.** When a free-built net matches no library member exactly, the engine now finds the smallest (fewest-faces) library solid that contains the net as a connected subset — using a proper bipartite matching (Kuhn's algorithm) instead of a fragile greedy walk — folds the net as an incomplete member of that solid (inheriting its dihedrals), and annotates the builder panel with an **Incomplete Fold** banner (`"Folding as an incomplete <name> — N of M faces present"`). (`PolyDatabase.bestSuperset`, `LayoutManager._computeFreeDihedralAngles` / `_updateIncompleteBanner`)

3. **3D viewer followed 2D drags.** The folding area used to rebuild on every mouse-move during a drag, so it tracked the 2D net in real time. Fixed so the 3D mesh stays put during the drag and is rebuilt exactly once on mouse-up. (`LayoutManager.handleMouseMove` / `handleMouseUp`)

4. **Rotate detached faces.** Pressing `R`/`L` on a selected free-build face used to delete its connections and spin it alone. Now the entire connected region rotates as a rigid body around the selected face (the pivot), with no detachment — only the scissors tool splits regions. (`LayoutManager._getFreeComponent` / `rotateFreeComponent`)

5. **Random Proper Coloring.** Added a **Random Proper Coloring** button in the Render Parameters section that assigns every face a random colour such that no two edge-adjacent faces share a colour. The algorithm builds the face-adjacency graph (via shared vertex indices for library solids, geometric edge matching for free-build nets), then runs a greedy proper coloring with a shuffled 8-color palette and random face order — producing a different valid coloring on every click. (`LayoutManager.applyRandomProperColoring` / `_buildFaceAdjacency`)

---

## Limitations & Known Behaviors

- **CDN dependency.** First load requires internet for Three.js, Tailwind, Lucide, and Google Fonts. The geometry dataset itself is bundled.
- **Free-build dihedrals are inherited, not computed.** A free-built net has no 3D target, so its fold angles come from the matched library member (or generic defaults for unknown face-pair types). Folding a net that matches nothing in the database will use right-angle defaults.
- **Subset matching is adjacency-aware, not isomorphic.** The bipartite check verifies that each net face can be hosted by a solid face of the same type with sufficient neighbours — a strong proxy for "connected subgraph" but not a full subgraph-isomorphism guarantee.
- **Scissors only detach single-face leaves.** A seam is only cuttable if cutting it isolates exactly one face, to prevent accidentally shattering a net into many pieces.
- **OBJ export** bakes the current fold state; partially folded meshes are intentionally included.

---

## Credits

- **Polyhedron dataset** — compiled from [polyhedra-viewer](https://github.com/ttezee/polyhedra-viewer) by Phiroze (MIT).
- **3D rendering** — [Three.js](https://threejs.org/) r128 and OrbitControls.
- **Styling** — [Tailwind CSS](https://tailwindcss.com/) (CDN) and custom `index.css`.
- **Icons** — [Lucide](https://lucide.dev/).
- **Fonts** — Plus Jakarta Sans & JetBrains Mono (Google Fonts).

---

*NetFolderBuilder Pro — Universal topological edge snapping & dynamic unfolding.*
