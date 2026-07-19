class LayoutManager {
    constructor(canvasId, appState) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.app = appState;

        this.pan = { x: 0, y: 0 };
        this.zoom = 1.0;

        this.draggedComponent = null; 
        this.dragStart = { x: 0, y: 0 };
        this.mousePos = { x: 0, y: 0 };
        this.hoveredJunction = null;    // connection hovered for ✂️ scissors

        this.faceCoords2D = []; 
        this.connections = []; 
        this.connectedComponents = [];
        this.baseEdges = [];            // all edges + lengths (like one-shot baseEdges)

        // Snap guidance (like one-shot)
        this.pendingSnap = null;        // best candidate snap — finalized on mouseup
        this.snapGuides = [];           // visual guide lines during drag

        // --- Free Build Palette (ported from NetFolderBuilder) ---
        this.freePolygons = [];         // array of Polygon instances
        this.freeConnections = [];      // connections between free polys (like library connections)
        this.nextPolygonId = 0;
        this._freeNetDirty = false;     // flag to rebuild 3D data when free net changes
        this.currentPaletteSides = null; // sides of shape selected from palette (null = idle)
        this.selectedPolygonId = null;   // id of selected free polygon for R/L/Delete
        this.contextMenuPolygonId = null; // id of polygon being color-changed
        this.customColorsHistory = [];   // recent custom colors
        this._contextFaceIdx = null;       // library face index for color menu
        this.hoveredFaceIdx = null;        // face under mouse cursor
        this.isPanning = false;
        this.lastMouseWorld = null;
        // Matched library member when a free-built net folds as an incomplete subset
        this._matchedSolidName = null;
        this._matchedSolidTotal = null;
        this._matchedSolidNet = null;
        this._setupPalette();

        this.setupEvents();
        this.resize();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.draw();
    }

    // --- Free Build Palette Setup ---
    _setupPalette() {
        // Palette button clicks
        const btns = document.querySelectorAll('#palette-buttons .palette-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sides = parseInt(btn.dataset.sides, 10);
                this._selectPaletteShape(sides);
            });
        });

        // Clear canvas button — wipes everything
        const clearBtn = document.getElementById('btn-clear-canvas');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.freePolygons = [];
                this.freeConnections = [];
                this.selectedPolygonId = null;
                this.currentPaletteSides = null;
                this.faceCoords2D = [];
                this.connections = [];
                this.connectedComponents = [];
                this.baseEdges = [];
                this.hoveredJunction = null;
                this.pendingSnap = null;
                this.snapGuides = [];
                this.nextPolygonId = 0;
                this._freeNetDirty = true;
                this.canvas.style.cursor = 'grab';
                this.hideColorMenu();
                this.app.polyhedron = null;
                this.app.updateFold(0.0);
                this.app.isPlaying = false;
                this.app.btnPlay.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i> Auto Fold`;
                if (window.lucide) window.lucide.createIcons();
                this.app.update3DViewer();
                this.app.statName.textContent = '-';
                this.app.statV.textContent = '0';
                this.app.statE.textContent = '0';
                this.app.statF.textContent = '0';
                this.app.shapeSelector.value = '';  // reset dropdown
                this.app.currentKey = null;
                this.app.statSubset.classList.add('hidden');
                this._matchedSolidName = null;
                this._matchedSolidTotal = null;
                this._matchedSolidNet = null;
                this._updateIncompleteBanner();
                this.draw();
            });
        }

        // Hide context menu on any click outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('colorContextMenu');
            if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) {
                this._hideColorMenu();
            }
        });

        // Right-click on canvas for color context menu
        this.canvas.addEventListener('contextmenu', (e) => this._handleContextMenu(e));
    }

    _selectPaletteShape(sides) {
        this.currentPaletteSides = sides;
        this.selectedPolygonId = null;
        this.canvas.style.cursor = 'copy';
        this.hideColorMenu();
        this.draw();
    }

    /**
     * Reset all free-build state.  Called when switching into library mode
     * (App.loadSolid) so stale free polygons can neither render on top of
     * the library net nor clobber the loaded solid via _syncFreeToLibrary.
     */
    clearFreeBuild() {
        this.freePolygons = [];
        this.freeConnections = [];
        this.selectedPolygonId = null;
        this.contextMenuPolygonId = null;
        this.currentPaletteSides = null;
        this.nextPolygonId = 0;
        this._freeNetDirty = false;
        this.canvas.style.cursor = 'grab';
    }

    _getFreePolyById(id) {
        return this.freePolygons.find(p => p.id === id);
    }

    // --- Coordinate helpers ---
    toScreen(x, y) {
        return { x: x * this.zoom + this.pan.x, y: y * this.zoom + this.pan.y };
    }
    screenToWorld(x, y) {
        return { x: (x - this.pan.x) / this.zoom, y: (y - this.pan.y) / this.zoom };
    }

    // --- Layout Init ---
    initializeLayout(polyhedron) {
        const faces = polyhedron.faces;
        const vertices = polyhedron.vertices;

        this.connections = GeometryEngine.generateSpanningTree(faces);
        this.connections.forEach((conn, idx) => {
            conn.id = `base-${conn.parent}-${conn.child}-${idx}`;
        });

        // Build baseEdges — all edges with their lengths (like one-shot)
        this.baseEdges = [];
        faces.forEach((face, faceIdx) => {
            for (let i = 0; i < face.length; i++) {
                const u = face[i];
                const v = face[(i + 1) % face.length];
                const local = GeometryEngine.intrinsic2D(face, vertices);
                const p1 = local[i];
                const p2 = local[(i + 1) % face.length];
                const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) * 120;
                this.baseEdges.push({ face: faceIdx, edgeIdx: i, u, v, len });
            }
        });

        const localCoords = faces.map(face => GeometryEngine.intrinsic2D(face, vertices));
        const globalCoords = new Array(faces.length);
        globalCoords[0] = localCoords[0].map(p => ({ x: p.x * 120, y: p.y * 120 }));

        const visited = new Set([0]);
        const queue = [0];

        const childMap = new Map();
        this.connections.forEach(conn => {
            if (!childMap.has(conn.parent)) childMap.set(conn.parent, []);
            childMap.get(conn.parent).push(conn);
        });

        while (queue.length > 0) {
            const parentIdx = queue.shift();
            const parentGlobal = globalCoords[parentIdx];
            const children = childMap.get(parentIdx) || [];

            for (const conn of children) {
                const childIdx = conn.child;
                if (visited.has(childIdx)) continue;

                const childLocal = localCoords[childIdx].map(p => ({ x: p.x * 120, y: p.y * 120 }));

                const pEdgeIdx = conn.parentEdgeIdx;
                const cEdgeIdx = conn.childEdgeIdx;
                const pFace = faces[parentIdx];
                const cFace = faces[childIdx];

                const pU = pFace[pEdgeIdx];
                const pV = pFace[(pEdgeIdx + 1) % pFace.length];
                const cU = cFace[cEdgeIdx];
                const cV = cFace[(cEdgeIdx + 1) % cFace.length];
                const alignReversed = (pU === cV && pV === cU);

                const p1 = parentGlobal[pEdgeIdx];
                const p2 = parentGlobal[(pEdgeIdx + 1) % pFace.length];
                const c1 = childLocal[cEdgeIdx];
                const c2 = childLocal[(cEdgeIdx + 1) % cFace.length];

                const mapA = alignReversed ? p2 : p1;
                const mapB = alignReversed ? p1 : p2;

                const angleP = Math.atan2(mapB.y - mapA.y, mapB.x - mapA.x);
                const angleC = Math.atan2(c2.y - c1.y, c2.x - c1.x);
                const dAngle = angleP - angleC;

                const cosA = Math.cos(dAngle), sinA = Math.sin(dAngle);
                const rotatedC = childLocal.map(p => ({
                    x: p.x * cosA - p.y * sinA,
                    y: p.x * sinA + p.y * cosA
                }));

                const rC1 = rotatedC[cEdgeIdx];
                const tx = mapA.x - rC1.x;
                const ty = mapA.y - rC1.y;

                globalCoords[childIdx] = rotatedC.map(p => ({
                    x: p.x + tx,
                    y: p.y + ty
                }));

                visited.add(childIdx);
                queue.push(childIdx);
            }
        }

        this.faceCoords2D = globalCoords;
        this._dihedralDefaults = null;   // clear free-net angles — use library 3D normals
        this.rebuildComponents();
        this.centerLayout();
    }

    centerLayout() {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        this.faceCoords2D.forEach(face => {
            face.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });
        });
        if (!isFinite(minX)) return;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.pan.x = this.canvas.width / 2 - centerX;
        this.pan.y = this.canvas.height / 2 - centerY;
        this.zoom = Math.min(1.2, Math.min(this.canvas.width / (maxX - minX + 150), this.canvas.height / (maxY - minY + 150)));
        this.draw();
    }

    rebuildComponents() {
        const numFaces = this.faceCoords2D.length;
        const adj = Array.from({ length: numFaces }, () => []);
        this.connections.forEach(conn => {
            adj[conn.parent].push(conn.child);
            adj[conn.child].push(conn.parent);
        });
        const visited = new Set();
        this.connectedComponents = [];
        for (let i = 0; i < numFaces; i++) {
            if (!visited.has(i)) {
                const comp = [], q = [i];
                visited.add(i);
                while (q.length > 0) {
                    const curr = q.shift();
                    comp.push(curr);
                    for (const n of adj[curr]) {
                        if (!visited.has(n)) { visited.add(n); q.push(n); }
                    }
                }
                this.connectedComponents.push(comp);
            }
        }
    }

    // --- Events ---
    setupEvents() {
        window.addEventListener('resize', () => this.resize());
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        window.addEventListener('keydown', (e) => {
            // Determine target: selected free polygon > dragged component > hovered face
            let targetComponent = this.draggedComponent;
            let targetFreePoly = null;

            // Selected free polygon takes priority (persistent selection like old impl)
            if (this.selectedPolygonId !== null) {
                targetFreePoly = this._getFreePolyById(this.selectedPolygonId);
            }
            // Fall back to hovered face's component
            if (!targetFreePoly && !targetComponent && this.hoveredFaceIdx !== null) {
                targetComponent = this.connectedComponents.find(comp => comp.includes(this.hoveredFaceIdx));
            }

            // R / L rotation
            if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'l') {
                e.preventDefault();
                const angle = e.key.toLowerCase() === 'r' ? 0.087 : -0.087;

                if (targetComponent) {
                    const center = this.getComponentCentroid(targetComponent);
                    this.rotateComponent(targetComponent, angle, center);
                } else if (targetFreePoly) {
                    // Rotate the ENTIRE connected region around the selected face.
                    // No detachment occurs — only the scissors tool may split a region.
                    const compIds = this._getFreeComponent(targetFreePoly.id);
                    this.rotateFreeComponent(compIds, angle, targetFreePoly.center);
                    this._freeNetDirty = true;
                    this.app.update3DViewer();
                    this.draw();
                }
            }

            // Delete / Backspace to remove selected free polygon
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedPolygonId !== null) {
                e.preventDefault();
                const pid = this.selectedPolygonId;
                this.freePolygons = this.freePolygons.filter(p => p.id !== pid);
                this.freeConnections = this.freeConnections.filter(c => c.polyA !== pid && c.polyB !== pid);
                this.selectedPolygonId = null;
                this._freeNetDirty = true;
                this.app.update3DViewer();
                this.draw();
            }
        });
    }

    handleMouseDown(e) {
        if (e.button !== 0) return; // only left-click
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const m = this.screenToWorld(mx, my);
        this.dragStart = { x: e.clientX, y: e.clientY };

        this.hideColorMenu();

        // --- Palette mode: place new free polygon ---
        if (this.currentPaletteSides !== null && !this.hoveredJunction) {
            // Switching from library mode to free-build: unload the solid
            // first, otherwise the next mouse-move would sync the new free
            // polygon over it and silently destroy it (mode-mixing bug).
            if (this.app.polyhedron && this.app.polyhedron.name !== 'Free-Built Net') {
                this.app.polyhedron = null;
                this.app.currentKey = null;
                this.app.shapeSelector.value = '';
                this.app.statSubset.classList.add('hidden');
            }
            const poly = new Polygon(
                this.nextPolygonId++, this.currentPaletteSides, m, 0
            );
            this.freePolygons.push(poly);
            this.selectedPolygonId = poly.id;
            this.currentPaletteSides = null;
            this._freeNetDirty = true;
            this.canvas.style.cursor = 'grab';
            // Refresh the 3D viewer so the new face appears immediately —
            // works even for a single polygon with no connections yet.
            this.app.update3DViewer();
            this.draw();
            return;
        }

        // --- Sync free polygons → library format for unified handling ---
        const usingFreeNet = this._syncFreeToLibrary();

        // --- Click empty space deselects free polygon ---
        if (!this.hoveredJunction) {
            let hitAny = false;
            for (let i = 0; i < this.faceCoords2D.length; i++) {
                if (this.isPointInPolygon(m, this.faceCoords2D[i])) { hitAny = true; break; }
            }
            if (!hitAny) this.selectedPolygonId = null;
        }

        // 1. Scissor click — detach the connection (only if it isolates one face)
        if (this.hoveredJunction) {
            // Determine if it's a free connection by checking if id starts with 'free-'
            if (this.hoveredJunction.id && this.hoveredJunction.id.startsWith('free-')) {
                if (!this._canDetachFreeConn(this.hoveredJunction)) {
                    this.hoveredJunction = null;
                    return;
                }
                // Auto-select the isolated polygon for immediate R/L rotation
                const isolated = this._getIsolatedFreePoly(this.hoveredJunction);
                if (isolated) this.selectedPolygonId = isolated;
                this.freeConnections = this.freeConnections.filter(c => c.id !== this.hoveredJunction.id);
                this._freeNetDirty = true;
                // Re-sync after detach
                this._syncFreeToLibrary();
            } else {
                if (!this._canDetachLibraryConn(this.hoveredJunction)) {
                    this.hoveredJunction = null;
                    return;
                }
                this.connections = this.connections.filter(c => c.id !== this.hoveredJunction.id);
            }
            this.hoveredJunction = null;
            this.rebuildComponents();
            this.app.update3DViewer();
            // Refocus workspace for R/L key handling
            document.getElementById('workspace-container')?.focus();
            this.draw();
            return;
        }

        // 2. Face click — start dragging (works for both library and synced free faces)
        for (let i = 0; i < this.faceCoords2D.length; i++) {
            if (this.isPointInPolygon(m, this.faceCoords2D[i])) {
                this.draggedComponent = this.connectedComponents.find(comp => comp.includes(i));
                this.lastMouseWorld = m;
                // Persistent selection for free polygons (like old impl)
                if (this.freePolygons[i]) {
                    this.selectedPolygonId = this.freePolygons[i].id;
                }
                return;
            }
        }

        // 3. Otherwise — pan canvas
        this.isPanning = true;
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const m = this.screenToWorld(mx, my);
        this.mousePos = m;

        // Sync free→library at start of drag (ensures unified drag/snap/guides)
        if (!this.draggedComponent) this._syncFreeToLibrary();

        if (this.draggedComponent) {
            const dx = m.x - this.lastMouseWorld.x;
            const dy = m.y - this.lastMouseWorld.y;
            this.draggedComponent.forEach(faceIdx => {
                this.faceCoords2D[faceIdx].forEach(p => { p.x += dx; p.y += dy; });
                // Keep free-build polygons in sync so the net renders at the
                // dragged position immediately.  Free-build faces are drawn from
                // each polygon's own center/rotation (not faceCoords2D), so
                // without this the net would lag behind the mouse until mouse-up.
                const fp = this.freePolygons[faceIdx];
                if (fp) { fp.center.x += dx; fp.center.y += dy; }
            });
            this.lastMouseWorld = m;
            this.calculateSnaps();
            // NOTE: deliberately do NOT rebuild the 3D folding viewer here —
            // the folding area must stay put while a 2D net is being dragged.
            // The 3D mesh is refreshed once on mouse-up (handleMouseUp).
        } else if (this.isPanning) {
            this.pan.x += e.clientX - this.dragStart.x;
            this.pan.y += e.clientY - this.dragStart.y;
            this.dragStart = { x: e.clientX, y: e.clientY };
        } else {
            this.hoveredJunction = this.getScissorsAt(mx, my);
            this.hoveredFaceIdx = this.getFaceAt(m.x, m.y);
        }

        this.draw();
    }

    handleMouseUp() {
        // Finalize snap on mouseup — align faces then add connection
        if (this.draggedComponent && this.pendingSnap) {
            const snap = this.pendingSnap;

            // Compute exact alignment transformation to close the gap
            const faces = this.app.polyhedron.faces;
            const pLen = faces[snap.parent].length;
            const cLen = faces[snap.child].length;

            const p1 = this.faceCoords2D[snap.parent][snap.parentEdgeIdx];
            const p2 = this.faceCoords2D[snap.parent][(snap.parentEdgeIdx + 1) % pLen];

            const c1 = this.faceCoords2D[snap.child][snap.childEdgeIdx];
            const c2 = this.faceCoords2D[snap.child][(snap.childEdgeIdx + 1) % cLen];

            // Determine best vertex mapping (straight vs reversed)
            const dStraight = Math.hypot(c1.x - p1.x, c1.y - p1.y) + Math.hypot(c2.x - p2.x, c2.y - p2.y);
            const dReversed = Math.hypot(c1.x - p2.x, c1.y - p2.y) + Math.hypot(c2.x - p1.x, c2.y - p1.y);
            const reversed = dReversed < dStraight;

            // Compute transformation BEFORE mutating any vertices
            // (c1/c2 are references into faceCoords2D — must snapshot)
            const mapA = reversed ? p2 : p1;
            const mapB = reversed ? p1 : p2;
            const thetaP = Math.atan2(mapB.y - mapA.y, mapB.x - mapA.x);
            const thetaC = Math.atan2(c2.y - c1.y, c2.x - c1.x);
            const dTheta = thetaP - thetaC;
            const cosT = Math.cos(dTheta);
            const sinT = Math.sin(dTheta);
            const anchorCX = c1.x;
            const anchorCY = c1.y;
            const anchorPX = mapA.x;
            const anchorPY = mapA.y;

            // Apply rigid transform to all faces in dragged component
            this.draggedComponent.forEach(faceIdx => {
                this.faceCoords2D[faceIdx].forEach(v => {
                    const tx = v.x - anchorCX;
                    const ty = v.y - anchorCY;
                    v.x = anchorPX + tx * cosT - ty * sinT;
                    v.y = anchorPY + tx * sinT + ty * cosT;
                });
            });

            this.connections.push({
                id: `custom-${Date.now()}-${Math.random()}`,
                parent: snap.parent, child: snap.child,
                parentEdgeIdx: snap.parentEdgeIdx, childEdgeIdx: snap.childEdgeIdx,
                u: snap.u, v: snap.v
            });

            // If free-net mode, also create corresponding freeConnection
            if (this.freePolygons.length > 0 && snap.parent < this.freePolygons.length && snap.child < this.freePolygons.length) {
                this.freeConnections.push({
                    id: `free-snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    polyA: this.freePolygons[snap.parent].id,
                    polyB: this.freePolygons[snap.child].id,
                    edgeA: snap.parentEdgeIdx,
                    edgeB: snap.childEdgeIdx
                });
                this._freeNetDirty = true;
            }

            this.rebuildComponents();

            // Sync aligned positions back to free polygons BEFORE 3D rebuild
            if (!this.app.polyhedron || this.app.polyhedron.name === 'Free-Built Net') {
                this._syncLibraryToFree();
            }
        }
        // Backup sync (for non-snap drags)
        if (!this.app.polyhedron || this.app.polyhedron.name === 'Free-Built Net') {
            this._syncLibraryToFree();
        }

        const didDrag = this.draggedComponent !== null;

        this.pendingSnap = null;
        this.snapGuides = [];
        this.draggedComponent = null;
        this.isPanning = false;

        // Refresh the 3D folding viewer exactly once after a drag completes
        // (kept static during the drag so it doesn't follow the 2D movement).
        if (didDrag) {
            this.app.update3DViewer();
        }
        this.draw();
    }

    handleWheel(e) {
        e.preventDefault();
        const zoomFactor = 1.1;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const mBefore = this.screenToWorld(mouseX, mouseY);
        if (e.deltaY < 0) this.zoom *= zoomFactor;
        else this.zoom /= zoomFactor;
        this.zoom = Math.min(Math.max(this.zoom, 0.1), 10);
        this.pan.x = mouseX - mBefore.x * this.zoom;
        this.pan.y = mouseY - mBefore.y * this.zoom;
        this.draw();
    }

    // --- Scissor detection (faithful one-shot port: screen-space midpoint) ---
    getScissorsAt(mx, my) {
        if (!this.app.polyhedron) return null;
        const threshold = 14;
        for (const conn of this.connections) {
            const coords = this.faceCoords2D[conn.parent];
            if (!coords) continue;
            const faces = this.app.polyhedron.faces;
            const parentFace = faces[conn.parent];
            const uIdx = parentFace.indexOf(conn.u);
            const vIdx = parentFace.indexOf(conn.v);
            if (uIdx < 0 || vIdx < 0) continue;
            const p1 = coords[uIdx];
            const p2 = coords[vIdx];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const s = this.toScreen(midX, midY);
            if (Math.hypot(mx - s.x, my - s.y) < threshold) return conn;
        }
        return null;
    }

    // --- Snap guidance (faithful one-shot port) ---
    calculateSnaps() {
        this.pendingSnap = null;
        this.snapGuides = [];
        if (!this.draggedComponent) return;

        const dragSet = new Set(this.draggedComponent);
        const staticSet = new Set();
        for (let i = 0; i < this.faceCoords2D.length; i++) {
            if (!dragSet.has(i)) staticSet.add(i);
        }
        if (staticSet.size === 0) return;

        // Find "open" edges — edges NOT currently connected
        const isOpen = (e) => {
            return !this.connections.some(c =>
                (c.parent === e.face && c.parentEdgeIdx === e.edgeIdx) ||
                (c.child === e.face && c.childEdgeIdx === e.edgeIdx)
            );
        };

        const openDrag = this.baseEdges.filter(e => dragSet.has(e.face) && isOpen(e));
        const openStatic = this.baseEdges.filter(e => staticSet.has(e.face) && isOpen(e));

        const snapThreshold = 30; // world units (≈30 px at zoom=1)
        let bestDist = snapThreshold;

        for (const eD of openDrag) {
            const cCoords = this.faceCoords2D[eD.face];
            const c1 = cCoords[eD.edgeIdx];
            const c2 = cCoords[(eD.edgeIdx + 1) % cCoords.length];

            for (const eS of openStatic) {
                if (Math.abs(eD.len - eS.len) > 0.5) continue;

                const pCoords = this.faceCoords2D[eS.face];
                const p1 = pCoords[eS.edgeIdx];
                const p2 = pCoords[(eS.edgeIdx + 1) % pCoords.length];

                // Store guide lines (world coords — draw() uses world transform)
                this.snapGuides.push({ p1, p2, c1, c2 });

                // Check both straight and reversed alignments (in world coords)
                const distStraight = Math.hypot(c1.x - p1.x, c1.y - p1.y) + Math.hypot(c2.x - p2.x, c2.y - p2.y);
                const distReversed = Math.hypot(c1.x - p2.x, c1.y - p2.y) + Math.hypot(c2.x - p1.x, c2.y - p1.y);

                if (distStraight < bestDist) {
                    bestDist = distStraight;
                    this.pendingSnap = {
                        parent: eS.face, child: eD.face,
                        parentEdgeIdx: eS.edgeIdx, childEdgeIdx: eD.edgeIdx,
                        u: eS.u, v: eS.v
                    };
                }
                if (distReversed < bestDist) {
                    bestDist = distReversed;
                    this.pendingSnap = {
                        parent: eS.face, child: eD.face,
                        parentEdgeIdx: eS.edgeIdx, childEdgeIdx: eD.edgeIdx,
                        u: eS.u, v: eS.v
                    };
                }
            }
        }
    }

    // --- Rotation ---
    rotateComponent(component, angle, center) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        component.forEach(faceIdx => {
            this.faceCoords2D[faceIdx].forEach(p => {
                const dx = p.x - center.x;
                const dy = p.y - center.y;
                p.x = center.x + dx * cos - dy * sin;
                p.y = center.y + dx * sin + dy * cos;
            });
            // Keep free-build polygons in sync (same class of bug as dragging):
            // free-build faces are drawn from each polygon's own data, so the
            // rotation must be mirrored to the Polygon objects too.
            const fp = this.freePolygons[faceIdx];
            if (fp) {
                const dx = fp.center.x - center.x;
                const dy = fp.center.y - center.y;
                fp.center.x = center.x + dx * cos - dy * sin;
                fp.center.y = center.y + dx * sin + dy * cos;
                fp.rotationAngle = Polygon.normalizeAngle(fp.rotationAngle + angle);
            }
        });
        this.app.update3DViewer();
        this.draw();
    }

    getComponentCentroid(component) {
        let sx = 0, sy = 0, count = 0;
        component.forEach(faceIdx => {
            this.faceCoords2D[faceIdx].forEach(p => { sx += p.x; sy += p.y; count++; });
        });
        return { x: sx / count, y: sy / count };
    }

    isPointInPolygon(p, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y))
                && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    getFaceAt(x, y) {
        const p = { x, y };
        for (let i = this.faceCoords2D.length - 1; i >= 0; i--) {
            if (this.faceCoords2D[i] && this.isPointInPolygon(p, this.faceCoords2D[i])) {
                return i;
            }
        }
        return null;
    }

    // --- Color Context Menu (shared between free-build and library nets) ---
    _handleContextMenu(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        const m = this.screenToWorld(rawX, rawY);

        // Try free polygons first
        let hitPoly = null;
        for (let i = this.freePolygons.length - 1; i >= 0; i--) {
            if (this.freePolygons[i].isPointInside(m)) {
                hitPoly = this.freePolygons[i];
                break;
            }
        }

        if (hitPoly) {
            this.contextMenuPolygonId = hitPoly.id;
            this._contextFaceIdx = null;
            this._populateColorMenu(hitPoly.color);
            this._showColorMenu(rawX, rawY);
            return;
        }

        // Try library faces
        if (this.app.polyhedron && this.app.polyhedron.name !== 'Free-Built Net') {
            const faceIdx = this.getFaceAt(m.x, m.y);
            if (faceIdx !== null) {
                this._contextFaceIdx = faceIdx;
                this.contextMenuPolygonId = null;
                const currentColor = (this.app.polyhedron.faceColors && this.app.polyhedron.faceColors[faceIdx]) || this.app.renderParams.colorFace;
                this._populateColorMenu(currentColor);
                this._showColorMenu(rawX, rawY);
                return;
            }
        }

        this._hideColorMenu();
    }

    _showColorMenu(x, y) {
        const menu = document.getElementById('colorContextMenu');
        if (!menu) return;
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    }

    _hideColorMenu() {
        const menu = document.getElementById('colorContextMenu');
        if (menu) menu.style.display = 'none';
        this.contextMenuPolygonId = null;
        this._contextFaceIdx = null;
    }

    hideColorMenu() { this._hideColorMenu(); }

    _populateColorMenu(currentColor) {
        const list = document.getElementById('colorMenuList');
        if (!list || currentColor === undefined) return;
        list.innerHTML = '';

        const defaultColors = Polygon.DEFAULT_COLORS;
        const defaultKeys = Object.keys(defaultColors);
        const names = Polygon.POLYGON_NAMES || {3:'Triangle',4:'Square',5:'Pentagon',6:'Hexagon',8:'Octagon',10:'Decagon'};

        defaultKeys.forEach(sides => {
            const colorName = defaultColors[sides];
            const label = (names[sides] || sides + '-gon') + ' Default';
            this._addColorItem(list, colorName, label, colorName === currentColor);
        });

        this._addMenuSeparator(list);
        this._addColorItem(list, '__palette__', 'Palette Choice...');

        if (this.customColorsHistory.length > 0) {
            this._addMenuSeparator(list);
            const hdr = document.createElement('li');
            hdr.textContent = 'Recent Custom:';
            hdr.style.fontWeight = 'bold';
            hdr.style.cursor = 'default';
            list.appendChild(hdr);
            this.customColorsHistory.forEach(c => {
                this._addColorItem(list, c, c, c === currentColor);
            });
        }
    }

    _addColorItem(list, value, text, isCurrent = false) {
        if (!list) return null;
        const li = document.createElement('li');
        li.dataset.colorValue = value;
        li.textContent = text;

        const colorBox = document.createElement('span');
        colorBox.classList.add('color-box');
        colorBox.style.backgroundColor = value;
        li.insertBefore(colorBox, li.firstChild);

        if (isCurrent) li.style.fontWeight = 'bold';

        li.addEventListener('click', (e) => this._handleColorMenuClick(e));
        list.appendChild(li);
        return li;
    }

    _addMenuSeparator(list) {
        if (!list) return;
        const li = document.createElement('li');
        li.classList.add('separator');
        list.appendChild(li);
    }

    _handleColorMenuClick(event) {
        const clickedItem = event.target.closest('li');
        if (!clickedItem) return;

        const colorValue = clickedItem.dataset.colorValue;

        // Library face color change
        if (this._contextFaceIdx !== null) {
            const faceIdx = this._contextFaceIdx;
            this._hideColorMenu();
            if (colorValue === '__palette__') {
                const input = document.createElement('input');
                input.type = 'color';
                input.style.position = 'fixed';
                input.style.top = '-100px';
                input.style.left = '-100px';
                const current = (this.app.polyhedron.faceColors && this.app.polyhedron.faceColors[faceIdx]) || this.app.renderParams.colorFace;
                input.value = current.startsWith('#') ? current : '#6366f1';
                document.body.appendChild(input);
                input.addEventListener('change', (ev) => {
                    if (!this.app.polyhedron.faceColors) this.app.polyhedron.faceColors = [];
                    this.app.polyhedron.faceColors[faceIdx] = ev.target.value;
                    this.customColorsHistory = [ev.target.value, ...this.customColorsHistory.filter(c => c !== ev.target.value)].slice(0, 8);
                    document.body.removeChild(input);
                    this.draw();
                    this.app.update3DViewer();
                });
                input.click();
            } else {
                if (!this.app.polyhedron.faceColors) this.app.polyhedron.faceColors = [];
                this.app.polyhedron.faceColors[faceIdx] = colorValue;
                if (!Object.values(Polygon.DEFAULT_COLORS).includes(colorValue)) {
                    this.customColorsHistory = [colorValue, ...this.customColorsHistory.filter(c => c !== colorValue)].slice(0, 8);
                }
                this.draw();
                this.app.update3DViewer();
            }
            return;
        }

        const poly = this._getFreePolyById(this.contextMenuPolygonId);

        this._hideColorMenu();

        if (!poly) return;

        if (colorValue === '__palette__') {
            const input = document.createElement('input');
            input.type = 'color';
            input.style.position = 'fixed';
            input.style.top = '-100px';
            input.style.left = '-100px';
            input.value = poly.color.startsWith('#') ? poly.color : '#6366f1';
            document.body.appendChild(input);
            input.addEventListener('change', (ev) => {
                poly.setColor(ev.target.value);
                this.customColorsHistory = [ev.target.value, ...this.customColorsHistory.filter(c => c !== ev.target.value)].slice(0, 8);
                document.body.removeChild(input);
                // Refresh the 3D viewer so the new color shows immediately
                // (buildFreeNetForFolding rebuilds faceColors from poly colors).
                this._freeNetDirty = true;
                this.app.update3DViewer();
                this.draw();
            });
            input.click();
        } else {
            poly.setColor(colorValue);
            if (!Object.values(Polygon.DEFAULT_COLORS).includes(colorValue)) {
                this.customColorsHistory = [colorValue, ...this.customColorsHistory.filter(c => c !== colorValue)].slice(0, 8);
            }
            // Refresh the 3D viewer so the new color shows immediately.
            this._freeNetDirty = true;
            this.app.update3DViewer();
            this.draw();
        }
    }

    // --- Random Proper Coloring (graph coloring of face-adjacency) ---

    /**
     * Palette of distinct colors used for random proper coloring.  Eight
     * colors is more than enough for any convex polyhedron's face graph
     * (the four-color theorem guarantees four suffice for planar graphs).
     */
    static PROPER_COLOR_PALETTE = [
        '#ef4444', // red
        '#f59e0b', // amber
        '#eab308', // yellow
        '#22c55e', // green
        '#06b6d4', // cyan
        '#3b82f6', // blue
        '#8b5cf6', // violet
        '#ec4899'  // pink
    ];

    /**
     * Build the face-adjacency graph of the current polyhedron (two faces
     * are adjacent iff they share an edge).  Works for both library solids
     * (shared vertex indices) and free-build synthetic polyhedra (unique
     * vertices per face → geometric edge matching by endpoint position).
     */
    _buildFaceAdjacency() {
        const poly = this.app.polyhedron;
        if (!poly || !poly.faces || poly.faces.length === 0) return [];
        const n = poly.faces.length;
        const adj = Array.from({ length: n }, () => new Set());
        const verts = poly.vertices || [];

        // Try index-based adjacency first (library solids share vertices).
        const edgeMap = new Map();
        poly.faces.forEach((face, fi) => {
            for (let i = 0; i < face.length; i++) {
                const u = face[i], v = face[(i + 1) % face.length];
                const key = Math.min(u, v) + '_' + Math.max(u, v);
                if (!edgeMap.has(key)) edgeMap.set(key, []);
                edgeMap.get(key).push(fi);
            }
        });
        let indexShared = false;
        for (const [, fis] of edgeMap) {
            if (fis.length >= 2) { indexShared = true; break; }
        }

        let map = edgeMap;
        if (!indexShared && verts.length > 0) {
            // Free-build synthetic polyhedron: vertices are unique per face,
            // so match edges geometrically by endpoint position.
            const keyOf = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
            const geoMap = new Map();
            poly.faces.forEach((face, fi) => {
                for (let i = 0; i < face.length; i++) {
                    const pa = verts[face[i]], pb = verts[face[(i + 1) % face.length]];
                    if (!pa || !pb) continue;
                    const ka = keyOf(pa), kb = keyOf(pb);
                    const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
                    if (!geoMap.has(ek)) geoMap.set(ek, []);
                    geoMap.get(ek).push(fi);
                }
            });
            map = geoMap;
        }

        for (const [, fis] of map) {
            if (fis.length < 2) continue;
            for (let a = 0; a < fis.length; a++) {
                for (let b = a + 1; b < fis.length; b++) {
                    adj[fis[a]].add(fis[b]);
                    adj[fis[b]].add(fis[a]);
                }
            }
        }
        return adj;
    }

    /**
     * Randomly color every face of the current solid so that no two
     * edge-adjacent faces share a color (proper graph coloring).  Uses a
     * greedy algorithm over a shuffled face order with a shuffled palette.
     * Applies to both the 2D net and the 3D folded viewer immediately.
     */
    applyRandomProperColoring() {
        const poly = this.app.polyhedron;
        if (!poly || !poly.faces || poly.faces.length === 0) return;

        const n = poly.faces.length;
        const adj = this._buildFaceAdjacency();

        const palette = LayoutManager.PROPER_COLOR_PALETTE.slice();
        const shuffle = (arr) => {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        };

        const order = shuffle([...Array(n).keys()]);
        const colors = new Array(n).fill(null);

        for (const fi of order) {
            const used = new Set();
            for (const nb of adj[fi]) {
                if (colors[nb] !== null) used.add(colors[nb]);
            }
            // Pick a random available color from the (shuffled) palette.
            const avail = palette.filter(c => !used.has(c));
            colors[fi] = avail.length > 0
                ? avail[Math.floor(Math.random() * avail.length)]
                : palette[Math.floor(Math.random() * palette.length)];
        }

        // Apply to the polyhedron's per-face colors
        if (!poly.faceColors || poly.faceColors.length < n) poly.faceColors = new Array(n);
        for (let i = 0; i < n; i++) poly.faceColors[i] = colors[i];

        // Mirror to free-build polygons (so free-build stays in sync)
        if (this.freePolygons.length === n) {
            this.freePolygons.forEach((p, i) => p.setColor(colors[i]));
        }

        this._freeNetDirty = true;
        this.app.update3DViewer();
        this.draw();
    }

    // --- Free Polygon Snapping ---

    /**
     * Only allow detach if cutting this connection isolates exactly one polygon.
     */
    /**
     * Returns the set of free-polygon ids in the connected region containing
     * `polyId` (BFS over freeConnections).  Used so rotate/drag operate on the
     * whole region, never detaching faces.
     */
    _getFreeComponent(polyId) {
        const visited = new Set([polyId]);
        const q = [polyId];
        while (q.length > 0) {
            const cur = q.shift();
            for (const c of this.freeConnections) {
                const other = c.polyA === cur ? c.polyB : (c.polyB === cur ? c.polyA : null);
                if (other !== null && !visited.has(other)) {
                    visited.add(other);
                    q.push(other);
                }
            }
        }
        return [...visited];
    }

    /**
     * Rigidly rotate a set of free polygons by `angle` radians about `pivot`.
     * Each polygon's center is orbited around the pivot and its orientation
     * is incremented by `angle`.  The selected face (at the pivot) stays in
     * place and spins in situ; the rest of the region swings around it.
     * Connections are preserved — no detachment.
     */
    rotateFreeComponent(polyIds, angle, pivot) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        polyIds.forEach(pid => {
            const poly = this._getFreePolyById(pid);
            if (!poly) return;
            const dx = poly.center.x - pivot.x;
            const dy = poly.center.y - pivot.y;
            poly.center.x = pivot.x + dx * cos - dy * sin;
            poly.center.y = pivot.y + dx * sin + dy * cos;
            poly.rotationAngle = Polygon.normalizeAngle(poly.rotationAngle + angle);
        });
    }

    _getIsolatedFreePoly(conn) {
        const remaining = this.freeConnections.filter(c => c.id !== conn.id);
        const bfs = (start) => {
            const visited = new Set();
            const q = [start];
            visited.add(start);
            while (q.length > 0) {
                const pid = q.shift();
                for (const c of remaining) {
                    const other = c.polyA === pid ? c.polyB : (c.polyB === pid ? c.polyA : null);
                    // NB: polygon ids start at 0 — must test `!== null`, not truthiness,
                    // or id 0 becomes unreachable and mid-net seams look detachable.
                    if (other !== null && !visited.has(other)) { visited.add(other); q.push(other); }
                }
            }
            return visited;
        };
        const sideA = bfs(conn.polyA);
        const sideB = bfs(conn.polyB);
        if (sideA.size === 1) return conn.polyA;
        if (sideB.size === 1) return conn.polyB;
        return null;
    }

    _canDetachFreeConn(conn) {
        const remaining = this.freeConnections.filter(c => c.id !== conn.id);
        const bfs = (start) => {
            const visited = new Set();
            const q = [start];
            visited.add(start);
            while (q.length > 0) {
                const pid = q.shift();
                for (const c of remaining) {
                    const other = c.polyA === pid ? c.polyB : (c.polyB === pid ? c.polyA : null);
                    // NB: polygon ids start at 0 — must test `!== null`, not truthiness.
                    if (other !== null && !visited.has(other)) { visited.add(other); q.push(other); }
                }
            }
            return visited.size;
        };
        const sideA = bfs(conn.polyA);
        const sideB = bfs(conn.polyB);
        return sideA === 1 || sideB === 1;
    }

    _canDetachLibraryConn(conn) {
        const remaining = this.connections.filter(c => c.id !== conn.id);
        const n = this.faceCoords2D.length;
        const adj = Array.from({ length: n }, () => []);
        remaining.forEach(c => {
            adj[c.parent].push(c.child);
            adj[c.child].push(c.parent);
        });
        // BFS from conn.parent
        const visited = new Set();
        const q = [conn.parent];
        visited.add(conn.parent);
        while (q.length > 0) {
            const curr = q.shift();
            for (const nb of adj[curr]) {
                if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
            }
        }
        const sideA = visited.size;
        // BFS from conn.child
        const visited2 = new Set();
        const q2 = [conn.child];
        visited2.add(conn.child);
        while (q2.length > 0) {
            const curr = q2.shift();
            for (const nb of adj[curr]) {
                if (!visited2.has(nb)) { visited2.add(nb); q2.push(nb); }
            }
        }
        const sideB = visited2.size;
        return sideA === 1 || sideB === 1;
    }

    // --- Drawing ---

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.translate(this.pan.x, this.pan.y);
        this.ctx.scale(this.zoom, this.zoom);

        this.drawGrid();

        if (!this.app) {
            this.ctx.restore();
            return;
        }

        // SAT overlap detection (only if polyhedron loaded)
        if (this.app.polyhedron) {
        let overlapFaceIndices = new Set();
        if (this.app.renderParams.activeSAT) {
            for (let i = 0; i < this.faceCoords2D.length; i++) {
                for (let j = i + 1; j < this.faceCoords2D.length; j++) {
                    if (this.faceCoords2D[i] && this.faceCoords2D[j]) {
                        const p1 = GeometryEngine.shrinkPolygon(this.faceCoords2D[i], 0.96);
                        const p2 = GeometryEngine.shrinkPolygon(this.faceCoords2D[j], 0.96);
                        if (GeometryEngine.checkSATCollision(p1, p2)) {
                            overlapFaceIndices.add(i);
                            overlapFaceIndices.add(j);
                        }
                    }
                }
            }
            this.app.setOverlapState(overlapFaceIndices.size > 0);
        }

        // Draw snap guidance lines (during drag — like one-shot)
        if (this.draggedComponent && this.snapGuides.length > 0) {
            this.ctx.strokeStyle = 'rgba(236, 72, 153, 0.25)';
            this.ctx.lineWidth = 2.0;
            this.ctx.setLineDash([4, 4]);
            this.snapGuides.forEach(g => {
                this.ctx.beginPath();
                this.ctx.moveTo(g.p1.x, g.p1.y);
                this.ctx.lineTo(g.c1.x, g.c1.y);
                this.ctx.moveTo(g.p2.x, g.p2.y);
                this.ctx.lineTo(g.c2.x, g.c2.y);
                this.ctx.stroke();
            });
            this.ctx.setLineDash([]);
        }

        // Draw library faces (skip for free-built nets — drawn separately above)
        if (this.app.polyhedron?.name !== 'Free-Built Net') {
        this.faceCoords2D.forEach((coords, idx) => {
            if (!coords) return;
            this.ctx.beginPath();
            this.ctx.moveTo(coords[0].x, coords[0].y);
            for (let i = 1; i < coords.length; i++) {
                this.ctx.lineTo(coords[i].x, coords[i].y);
            }
            this.ctx.closePath();

            const isOverlap = overlapFaceIndices.has(idx);
            // Per-face color (if set) overrides the global Face Color picker.
            // Guard against sparse faceColors arrays (only some faces recolored).
            const faceColor = (this.app.polyhedron.faceColors && this.app.polyhedron.faceColors[idx])
                || this.app.renderParams.colorFace;
            if (faceColor.startsWith('#')) {
                this.ctx.fillStyle = isOverlap ? '#ef444433' : faceColor + '2a';
            } else {
                this.ctx.globalAlpha = 0.16;
                this.ctx.fillStyle = isOverlap ? '#ef4444' : faceColor;
            }
            this.ctx.strokeStyle = isOverlap ? '#ef4444' : '#475569';
            this.ctx.lineWidth = isOverlap ? 2 : 1.5;
            this.ctx.fill();
            this.ctx.globalAlpha = 1.0;
            this.ctx.stroke();

            if (this.app.renderParams.faceLabels) {
                const center = this.getPolygonCentroid(coords);
                this.ctx.fillStyle = '#94a3b8';
                this.ctx.font = '10px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(idx, center.x, center.y);
            }
        });
        } // end if not free-net

        // Draw pending snap highlight (best candidate, thicker)
        if (this.pendingSnap && this.draggedComponent) {
            const snap = this.pendingSnap;
            const pCoords = this.faceCoords2D[snap.parent];
            const cCoords = this.faceCoords2D[snap.child];
            if (pCoords && cCoords) {
                const p1 = pCoords[snap.parentEdgeIdx];
                const p2 = pCoords[(snap.parentEdgeIdx + 1) % pCoords.length];
                const c1 = cCoords[snap.childEdgeIdx];
                const c2 = cCoords[(snap.childEdgeIdx + 1) % cCoords.length];

                // Determine best vertex mapping
                const dStraight = Math.hypot(c1.x - p1.x, c1.y - p1.y) + Math.hypot(c2.x - p2.x, c2.y - p2.y);
                const dReversed = Math.hypot(c1.x - p2.x, c1.y - p2.y) + Math.hypot(c2.x - p1.x, c2.y - p1.y);
                const reversed = dReversed < dStraight;

                const map1 = reversed ? p2 : p1;
                const map2 = reversed ? p1 : p2;
                const mc1 = reversed ? c2 : c1;
                const mc2 = reversed ? c1 : c2;

                this.ctx.strokeStyle = this.app.renderParams.colorSnap;
                this.ctx.lineWidth = 3.5;
                this.ctx.setLineDash([5, 4]);
                this.ctx.beginPath();
                this.ctx.moveTo(map1.x, map1.y);
                this.ctx.lineTo(mc1.x, mc1.y);
                this.ctx.moveTo(map2.x, map2.y);
                this.ctx.lineTo(mc2.x, mc2.y);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
        }

        // Draw scissors only for detachable connections
        this.connections.forEach(conn => {
            // Skip if detaching would split off more than one face
            const isFree = conn.id && conn.id.startsWith('free');
            const detachable = isFree ? this._canDetachFreeConn(conn) : this._canDetachLibraryConn(conn);
            if (!detachable) return;

            const coords = this.faceCoords2D[conn.parent];
            if (!coords) return;
            const faces = this.app.polyhedron.faces;
            const parentFace = faces[conn.parent];
            const uIdx = parentFace.indexOf(conn.u);
            const vIdx = parentFace.indexOf(conn.v);
            if (uIdx < 0 || vIdx < 0) return;
            const p1 = coords[uIdx];
            const p2 = coords[vIdx];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;

            const isHovered = this.hoveredJunction && this.hoveredJunction.id === conn.id;

            this.ctx.fillStyle = isHovered ? '#f43f5e' : '#1e293b';
            this.ctx.strokeStyle = isHovered ? '#fda4af' : '#475569';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, isHovered ? 13 : 9, 0, 2 * Math.PI);
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle = isHovered ? '#ffffff' : '#94a3b8';
            this.ctx.font = '11px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('✂️', midX, midY + 1);
        });

        } // end if (this.app.polyhedron)

        // Draw free polygons (always from own data, preserves per-polygon colors)
        this.freePolygons.forEach(poly => {
            const abs = poly.getAbsoluteVertices();
            if (!abs.length) return;

            this.ctx.beginPath();
            this.ctx.moveTo(abs[0].x, abs[0].y);
            for (let i = 1; i < abs.length; i++) this.ctx.lineTo(abs[i].x, abs[i].y);
            this.ctx.closePath();

            const isSelected = poly.id === this.selectedPolygonId;
            if (poly.color.startsWith('#')) {
                this.ctx.fillStyle = poly.color + '2a';
            } else {
                this.ctx.globalAlpha = 0.16;
                this.ctx.fillStyle = poly.color;
            }
            this.ctx.fill();
            this.ctx.globalAlpha = 1.0;
            this.ctx.strokeStyle = isSelected ? '#818cf8' : '#475569';
            this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
            this.ctx.stroke();
        });

        this.ctx.restore();
    }

    drawGrid() {
        const size = 60, w = 4000, h = 4000;
        this.ctx.strokeStyle = '#1e293b';
        this.ctx.lineWidth = 0.5;
        for (let x = -w; x < w; x += size) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, -h);
            this.ctx.lineTo(x, h);
            this.ctx.stroke();
        }
        for (let y = -h; y < h; y += size) {
            this.ctx.beginPath();
            this.ctx.moveTo(-w, y);
            this.ctx.lineTo(w, y);
            this.ctx.stroke();
        }
    }

    getPolygonCentroid(pts) {
        let sx = 0, sy = 0;
        pts.forEach(p => { sx += p.x; sy += p.y; });
        return { x: sx / pts.length, y: sy / pts.length };
    }

    /**
     * Checks if free net needs syncing to 3D data and does so if needed.
     */
    _syncToFolding() {
        if (this.app.polyhedron && this.app.polyhedron.name !== 'Free-Built Net') return;
        // A net with faces but no connections (e.g. a single just-placed
        // polygon, or several disconnected pieces) is still foldable — each
        // face renders as a flat disconnected piece.  Don't bail on it.
        if (this.freePolygons.length === 0) return;
        if (!this._freeNetDirty) return;
        this._syncFreeToLibrary();
        this.buildFreeNetForFolding();
    }

    /**
     * Bidirectional sync: converts free polygon net to library format so all
     * existing drag/snap/detach/guide code works for both systems.
     * Called before any interaction that needs the library data.
     */
    _syncFreeToLibrary() {
        if (this.freePolygons.length === 0) return false;

        // Build faceCoords2D from polygon absolute vertices
        this.faceCoords2D = this.freePolygons.map(poly =>
            poly.getAbsoluteVertices().map(v => ({ x: v.x, y: v.y }))
        );

        // Build polyId → face index map
        const polyToIdx = {};
        this.freePolygons.forEach((p, i) => { polyToIdx[p.id] = i; });

        // Build connections in library format (with proper u/v vertex indices)
        this.connections = this.freeConnections.map(fc => {
            const parentFaceLen = this.faceCoords2D[polyToIdx[fc.polyA]].length;
            return {
                id: fc.id,
                parent: polyToIdx[fc.polyA],
                child: polyToIdx[fc.polyB],
                parentEdgeIdx: fc.edgeA,
                childEdgeIdx: fc.edgeB,
                u: fc.edgeA,  // vertex index at edge start
                v: (fc.edgeA + 1) % parentFaceLen  // vertex index at edge end
            };
        });

        // Build minimal polyhedron (faces as simple vertex index sequences)
        this.app.polyhedron = {
            name: 'Free-Built Net',
            vertices: [],
            faces: this.faceCoords2D.map(coords => coords.map((_, i) => i)),
            faceColors: this.freePolygons.map(p => p.color)  // per-face colors
        };

        // Build baseEdges
        this.baseEdges = [];
        this.freePolygons.forEach((poly, fi) => {
            poly.edges.forEach((edge, ei) => {
                this.baseEdges.push({
                    face: fi, edgeIdx: ei,
                    u: ei, v: (ei + 1) % poly.sides,
                    len: poly.sideLength
                });
            });
        });

        this.rebuildComponents();
        this._freeNetDirty = false;
        return true;
    }

    /** Sync library-format mutations back to free polygon positions AND rotation */
    _syncLibraryToFree() {
        if (!this.faceCoords2D || this.faceCoords2D.length === 0) return;
        this.freePolygons.forEach((poly, i) => {
            if (!this.faceCoords2D[i]) return;
            const pts = this.faceCoords2D[i];
            // Compute centroid
            let cx = 0, cy = 0;
            pts.forEach(v => { cx += v.x; cy += v.y; });
            poly.center.x = cx / pts.length;
            poly.center.y = cy / pts.length;
            // Compute rotation from first edge direction
            const edgeDir = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
            const localDir = Math.atan2(poly.vertices[1].y - poly.vertices[0].y, poly.vertices[1].x - poly.vertices[0].x);
            poly.rotationAngle = Polygon.normalizeAngle(edgeDir - localDir);
        });
    }

    /**
     * Show / hide the builder-panel banner that annotates an incomplete
     * fold (free-built net that is a connected subset of a library solid).
     */
    _updateIncompleteBanner() {
        const banner = document.getElementById('incomplete-member-banner');
        const text = document.getElementById('incomplete-member-text');
        if (!banner || !text) return;
        if (this._matchedSolidName) {
            const netN = this._matchedSolidNet;
            const totN = this._matchedSolidTotal;
            const detail = (netN && totN)
                ? ` Folding as an incomplete <strong class="text-amber-300">${this._matchedSolidName}</strong> — ${netN} of ${totN} faces present.`
                : ` Folding as an incomplete <strong class="text-amber-300">${this._matchedSolidName}</strong>.`;
            text.innerHTML = 'This net matches no library solid exactly.' + detail +
                ' Dihedral angles are inherited from the smallest containing member.';
            banner.classList.remove('hidden');
            if (window.lucide) window.lucide.createIcons();
        } else {
            banner.classList.add('hidden');
        }
    }

    /**
     * Converts free-form polygon net into data structures the FoldingRenderer expects.
     * Called before folding a manually-built net.
     */
    buildFreeNetForFolding() {
        if (this.freePolygons.length === 0) return false;

        // 1. Build synthetic polyhedron: assign unique 3D vertex index to every polygon vertex
        const vertices = [];     // [[x,y,z], ...]
        const faces = [];        // [[v0,v1,v2,...], ...]
        const faceCoords2D = []; // [[{x,y},...], ...]
        const polyToFaceIdx = {}; // free polygon id → face index

        this.freePolygons.forEach((poly, fi) => {
            polyToFaceIdx[poly.id] = fi;
            const abs = poly.getAbsoluteVertices();
            const faceVerts = [];
            const coords2D = [];
            abs.forEach(v => {
                faceVerts.push(vertices.length);
                vertices.push([v.x / 100, v.y / 100, 0]);
                coords2D.push({ x: v.x, y: v.y });
            });
            faces.push(faceVerts);
            faceCoords2D.push(coords2D);
        });

        // 2. Build connections from freeConnections
        //    u/v ARE used downstream (scissors midpoint lookup in getScissorsAt
        //    and hinge lines in the SVG exporter both run indexOf(conn.u/v) on
        //    the parent face), so keep the real edge endpoint indices — faces
        //    are identity index sequences here, so edgeA / edgeA+1 are valid.
        const connections = [];
        this.freeConnections.forEach(fc => {
            const parent = polyToFaceIdx[fc.polyA];
            const child = polyToFaceIdx[fc.polyB];
            if (parent === undefined || child === undefined) return;
            const pLen = faces[parent].length;
            connections.push({
                id: fc.id,
                parent: parent,
                child: child,
                parentEdgeIdx: fc.edgeA,
                childEdgeIdx: fc.edgeB,
                u: fc.edgeA,
                v: (fc.edgeA + 1) % pLen
            });
        });

        // 3. Compute connected components
        const n = faces.length;
        const adj = Array.from({ length: n }, () => []);
        connections.forEach(conn => {
            adj[conn.parent].push(conn.child);
            adj[conn.child].push(conn.parent);
        });
        const visited = new Set();
        const connectedComponents = [];
        for (let i = 0; i < n; i++) {
            if (!visited.has(i)) {
                const comp = [], q = [i];
                visited.add(i);
                while (q.length > 0) {
                    const curr = q.shift();
                    comp.push(curr);
                    for (const nb of adj[curr]) {
                        if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
                    }
                }
                connectedComponents.push(comp);
            }
        }

        // 4. Build synthetic polyhedron (carry per-polygon colors for the 3D renderer)
        this.app.polyhedron = {
            name: 'Free-Built Net',
            vertices: vertices,
            faces: faces,
            faceColors: this.freePolygons.map(p => p.color)
        };

        // 5. Override layout data
        this.faceCoords2D = faceCoords2D;
        this.connections = connections;
        this.connectedComponents = connectedComponents;
        this.baseEdges = [];

        // 6. Compute default dihedral angles by polygon type pairs
        //    These are stored directly on connections for FoldingRenderer
        this._dihedralDefaults = this._computeFreeDihedralAngles();

        this.app.statName.textContent = 'Free-Built Net';
        if (this._matchedSolidName) {
            this.app.statSubset.textContent = 'subset of ' + this._matchedSolidName;
            this.app.statSubset.classList.remove('hidden');
        } else {
            this.app.statSubset.classList.add('hidden');
        }
        this._updateIncompleteBanner();
        // V/E counted geometrically: the synthetic polyhedron duplicates
        // vertices per face, so raw array lengths would over-report V and
        // report E = total/2 (e.g. a lone square would show E:2).
        const vKeys = new Set();
        vertices.forEach(p => vKeys.add(p[0].toFixed(4) + ',' + p[1].toFixed(4)));
        const eKeys = new Set();
        faces.forEach(f => {
            for (let i = 0; i < f.length; i++) {
                const a = vertices[f[i]], b = vertices[f[(i + 1) % f.length]];
                const ka = a[0].toFixed(4) + ',' + a[1].toFixed(4);
                const kb = b[0].toFixed(4) + ',' + b[1].toFixed(4);
                eKeys.add(ka < kb ? ka + '|' + kb : kb + '|' + ka);
            }
        });
        this.app.statV.textContent = vKeys.size;
        this.app.statE.textContent = eKeys.size;
        this.app.statF.textContent = faces.length;

        return true;
    }

    /** Compute dihedral angles for a free-built net by matching
     *  its face counts against the PolyDatabase (120 solids from
     *  PolyRegistry — Platonic, Archimedean, prisms, antiprisms,
     *  and all 92 Johnson solids).  The first match supplies
     *  per-hinge dihedral angles; unmatched face-pair types fall
     *  back to generic defaults. */
    _computeFreeDihedralAngles() {
        // ── Count faces ─────────────────────────────────────────
        const counts = {};
        this.app.polyhedron.faces.forEach(f => {
            const n = f.length;
            counts[n] = (counts[n] || 0) + 1;
        });

        // ── Build net face adjacency (for subset matching) ─────
        const netFaceAdj = [];
        this.faceCoords2D.forEach(() => netFaceAdj.push(new Map()));
        this.connections.forEach(conn => {
            const pSides = this.app.polyhedron.faces[conn.parent].length;
            const cSides = this.app.polyhedron.faces[conn.child].length;
            netFaceAdj[conn.parent].set(cSides, (netFaceAdj[conn.parent].get(cSides) || 0) + 1);
            netFaceAdj[conn.child].set(pSides, (netFaceAdj[conn.child].get(pSides) || 0) + 1);
        });

        // ── Query database ──────────────────────────────────────
        let dihedralMap = null;
        this._matchedSolidName = null;
        if (window.PolyDatabase) {
            // 1. Exact face-count match
            let candidates = window.PolyDatabase.findMatches(counts);

            // 2. If no exact match, find the smallest adjacency-compatible superset
            if (candidates.length === 0) {
                const netFaceSides = this.app.polyhedron.faces.map(f => f.length);
                const best = window.PolyDatabase.bestSuperset(counts, netFaceAdj, netFaceSides);
                if (best) {
                    candidates = [best.entry];
                    this._matchedSolidName = best.entry.name;
                    this._matchedSolidTotal = best.totalFaces;
                    this._matchedSolidNet = best.netFaces;
                } else {
                    this._matchedSolidName = null;
                    this._matchedSolidTotal = null;
                    this._matchedSolidNet = null;
                }
            } else {
                // Exact match — this is a complete library member, not an incomplete fold.
                this._matchedSolidName = null;
                this._matchedSolidTotal = null;
                this._matchedSolidNet = null;
            }

            // 3. Filter by connection types actually present in the net
            if (candidates.length > 1) {
                const netKeys = new Set();
                this.connections.forEach(conn => {
                    const p = this.app.polyhedron.faces[conn.parent].length;
                    const c = this.app.polyhedron.faces[conn.child].length;
                    netKeys.add(Math.min(p, c) + '-' + Math.max(p, c));
                });
                candidates = candidates.filter(c => {
                    for (const k of netKeys) {
                        const has = c.dihedrals.get ? c.dihedrals.get(k) : c.dihedrals[k];
                        if (has === undefined) return false;
                    }
                    return true;
                });
            }

            if (candidates.length > 0) dihedralMap = candidates[0].dihedrals;
        }

        // ── Fallback defaults (used when DB has no match) ───────
        const A = Math.acos;
        const DEFAULTS = {
            '4-4': Math.PI / 2,
            '5-5': A(Math.sqrt(5) / 5),
            '3-4': A(1 / 3),
            '3-5': A(Math.sqrt(5) / 3),
            '3-6': A(-1 / 3),
            '4-6': Math.PI / 2,
            '4-8': A(Math.sqrt(3) / 3),
            '3-8': A(Math.sqrt(3) / 3),
            '5-6': A(Math.sqrt(5) / 5),
            '6-6': A(-1 / 3),
            '8-8': Math.PI / 2,
            '10-10': A(Math.sqrt(5) / 5)
        };

        // ── Build per-connection angles ─────────────────────────
        const angles = {};
        const perConnAngles = new Map();

        this.connections.forEach((conn, connIdx) => {
            const pSides = this.app.polyhedron.faces[conn.parent].length;
            const cSides = this.app.polyhedron.faces[conn.child].length;
            const key = Math.min(pSides, cSides) + '-' + Math.max(pSides, cSides);

            if (dihedralMap) {
                const angle = dihedralMap.get ? dihedralMap.get(key) : dihedralMap[key];
                if (angle !== undefined) {
                    perConnAngles.set(connIdx, angle);
                    if (angles[key] === undefined) angles[key] = angle;
                    return;
                }
            }

            if (angles[key] !== undefined) return;
            angles[key] = DEFAULTS[key] || Math.PI / 2;
        });

        this._perConnDihedralAngles = perConnAngles;
        return angles;
    }
}

window.LayoutManager = LayoutManager;