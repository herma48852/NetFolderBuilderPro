// js/App.js

class AppState {
    constructor() {
        this.currentKey = null;
        this.polyhedron = null;
        this.foldPercentage = 0.0;
        this.isPlaying = false;
        this.animationDirection = 1; 

        this.renderParams = {
            wireframe3D: true,
            jointVertices: true,
            faceLabels: true,
            activeSAT: true,
            colorFace: '#6366f1',
            colorSnap: '#ec4899'
        };

        this.initDOMReferences();
        this.populatePolyLibrary();
        
        // Initialize managers
        this.layoutManager = new LayoutManager('canvas-2d', this);
        this.foldingRenderer = new FoldingRenderer('canvas-3d', this);

        this.bindGlobalListeners();
        // Canvas starts empty — user picks a solid or builds from palette
        this.updateFold(0.0);
        this.layoutManager.draw();
        this.startApplicationLoop();
    }

    initDOMReferences() {
        this.shapeSelector = document.getElementById('shape-selector');
        this.foldSlider = document.getElementById('fold-slider');
        this.foldPctLabel = document.getElementById('fold-pct');
        this.btnPlay = document.getElementById('btn-play');
        this.btnReset = document.getElementById('btn-reset');

        this.statName = document.getElementById('stat-name');
        this.statSubset = document.getElementById('stat-subset');
        this.statV = document.getElementById('stat-v');
        this.statE = document.getElementById('stat-e');
        this.statF = document.getElementById('stat-f');
        this.overlapIndicator = document.getElementById('overlap-indicator');

        this.chkWireframe = document.getElementById('chk-wireframe');
        this.chkVertices = document.getElementById('chk-vertices');
        this.chkLabels = document.getElementById('chk-labels');
        this.chkCollision = document.getElementById('chk-collision');
        this.colorFace = document.getElementById('color-face');
        this.colorSnap = document.getElementById('color-snap');

        this.btnExportSvg = document.getElementById('btn-export-svg');
        this.btnExportObj = document.getElementById('btn-export-obj');
    }

    populatePolyLibrary() {
        this.shapeSelector.innerHTML = '';

        // Blank default option
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '— Select a solid —';
        defaultOpt.disabled = true;
        defaultOpt.selected = true;
        this.shapeSelector.appendChild(defaultOpt);

        if (PolyCategories && Array.isArray(PolyCategories)) {
            PolyCategories.forEach(cat => {
                const optGroup = document.createElement('optgroup');
                optGroup.label = cat.label;
                cat.solids.forEach(solid => {
                    if (PolyRegistry[solid.key]) {
                        const opt = document.createElement('option');
                        opt.value = solid.key;
                        opt.textContent = solid.display || PolyRegistry[solid.key].name || solid.key;
                        if (solid.key === this.currentKey) {
                            opt.selected = true;
                        }
                        optGroup.appendChild(opt);
                    }
                });
                if (optGroup.children.length > 0) {
                    this.shapeSelector.appendChild(optGroup);
                }
            });
        }

        // Fallback catch-all if for some reason selector is empty
        if (this.shapeSelector.children.length === 0) {
            const fallbackGroup = document.createElement('optgroup');
            fallbackGroup.label = "All Polyhedra";
            Object.keys(PolyRegistry).forEach(key => {
                if (PolyRegistry[key].name) {
                    const opt = document.createElement('option');
                    opt.value = key;
                    opt.textContent = PolyRegistry[key].name;
                    if (key === this.currentKey) {
                        opt.selected = true;
                    }
                    fallbackGroup.appendChild(opt);
                }
            });
            this.shapeSelector.appendChild(fallbackGroup);
        }
    }

    bindGlobalListeners() {
        this.shapeSelector.addEventListener('change', (e) => this.loadSolid(e.target.value));

        this.foldSlider.addEventListener('input', (e) => {
            this.isPlaying = false;
            this.btnPlay.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i> Auto Fold`;
            if (window.lucide) window.lucide.createIcons();
            this.updateFold(parseFloat(e.target.value));
        });

        this.btnPlay.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            this.btnPlay.className = this.isPlaying 
                ? "flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 transition-colors text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-lg"
                : "flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 transition-colors text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-lg";
            this.btnPlay.innerHTML = this.isPlaying 
                ? `<i data-lucide="pause" class="w-3.5 h-3.5 fill-current"></i> Pause`
                : `<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i> Auto Fold`;
            if (window.lucide) window.lucide.createIcons();
        });

        this.btnReset.addEventListener('click', () => {
            this.isPlaying = false;
            this.animationDirection = 1;
            this.btnPlay.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i> Auto Fold`;
            if (window.lucide) window.lucide.createIcons();
            this.updateFold(0.0);
        });

        const bindCheckbox = (el, key) => {
            el.addEventListener('change', (e) => {
                this.renderParams[key] = e.target.checked;
                this.layoutManager.draw();
                this.update3DViewer();
            });
        };
        bindCheckbox(this.chkWireframe, 'wireframe3D');
        bindCheckbox(this.chkVertices, 'jointVertices');
        bindCheckbox(this.chkLabels, 'faceLabels');
        bindCheckbox(this.chkCollision, 'activeSAT');

        this.colorFace.addEventListener('input', (e) => {
            this.renderParams.colorFace = e.target.value;
            this.layoutManager.draw();
            this.update3DViewer();
        });
        this.colorSnap.addEventListener('input', (e) => {
            this.renderParams.colorSnap = e.target.value;
            this.layoutManager.draw();
            this.update3DViewer();
        });

        this.btnExportSvg.addEventListener('click', () => this.triggerSvgExport());
        this.btnExportObj.addEventListener('click', () => this.triggerObjExport());
    }

    loadSolid(key) {
        if (!PolyRegistry[key]) return;
        this.currentKey = key;

        const rawData = PolyRegistry[key];
        this.polyhedron = {
            name: rawData.name,
            vertices: JSON.parse(JSON.stringify(rawData.vertices)),
            faces: JSON.parse(JSON.stringify(rawData.faces))
        };

        GeometryEngine.validateAndCorrectWindings(this.polyhedron.vertices, this.polyhedron.faces);

        const edgeTracker = new Set();
        this.polyhedron.faces.forEach(face => {
            for (let i = 0; i < face.length; i++) {
                const p1 = face[i];
                const p2 = face[(i + 1) % face.length];
                edgeTracker.add(Math.min(p1, p2) + "_" + Math.max(p1, p2));
            }
        });

        this.statName.textContent = this.polyhedron.name;
        this.statSubset.classList.add('hidden');
        this.statV.textContent = this.polyhedron.vertices.length;
        this.statE.textContent = edgeTracker.size;
        this.statF.textContent = this.polyhedron.faces.length;

        // Loading a complete library member — clear any incomplete-fold annotation
        this.layoutManager._matchedSolidName = null;
        this.layoutManager._matchedSolidTotal = null;
        this.layoutManager._matchedSolidNet = null;
        this.layoutManager._updateIncompleteBanner();

        this.layoutManager.initializeLayout(this.polyhedron);
        this.update3DViewer();
        this.updateFold(0.0);
    }

    updateFold(val) {
        this.foldPercentage = Math.min(Math.max(val, 0.0), 100.0);
        this.foldSlider.value = this.foldPercentage.toFixed(1);
        this.foldPctLabel.textContent = `${this.foldPercentage.toFixed(1)}%`;
        
        if (this.foldingRenderer) {
            this.foldingRenderer.updateFoldingState();
        }
    }

    update3DViewer() {
        if (this.foldingRenderer) {
            this.layoutManager._syncToFolding();
            this.foldingRenderer.rebuildFoldingMesh();
        }
    }

    setOverlapState(isOverlapping) {
        if (isOverlapping) {
            this.overlapIndicator.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-sm transition-all duration-300";
            this.overlapIndicator.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span><span class="tracking-wider uppercase">OVERLAP WARNING</span>`;
        } else {
            this.overlapIndicator.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm transition-all duration-300";
            this.overlapIndicator.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="tracking-wider uppercase">NET VALID</span>`;
        }
    }

    startApplicationLoop() {
        const tick = () => {
            if (this.isPlaying) {
                let currentFold = this.foldPercentage + (0.5 * this.animationDirection);
                if (currentFold >= 100.0) {
                    currentFold = 100.0;
                    this.animationDirection = -1;
                } else if (currentFold <= 0.0) {
                    currentFold = 0.0;
                    this.animationDirection = 1;
                }
                this.updateFold(currentFold);
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    triggerSvgExport() {
        const faces = this.polyhedron.faces;
        const coords = this.layoutManager.faceCoords2D;
        const connections = this.layoutManager.connections;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        coords.forEach(faceCoords => {
            faceCoords.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });
        });

        const padding = 30;
        const w = (maxX - minX) + padding * 2;
        const h = (maxY - minY) + padding * 2;

        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
        svg += `  <rect width="100%" height="100%" fill="#020617"/>\n`;

        // Draw solid polygons
        coords.forEach((faceCoords, idx) => {
            const pts = faceCoords.map(p => `${(p.x - minX + padding).toFixed(2)},${(p.y - minY + padding).toFixed(2)}`).join(' ');
            svg += `  <polygon points="${pts}" fill="${this.renderParams.colorFace}33" stroke="#475569" stroke-width="1.5" />\n`;
        });

        // Draw hinge lines (interior connections) - dashed
        connections.forEach(conn => {
            const parentFace = faces[conn.parent];
            const uIdx = parentFace.indexOf(conn.u);
            const vIdx = parentFace.indexOf(conn.v);
            const pA = coords[conn.parent][uIdx];
            const pB = coords[conn.parent][vIdx];

            const x1 = pA.x - minX + padding;
            const y1 = pA.y - minY + padding;
            const x2 = pB.x - minX + padding;
            const y2 = pB.y - minY + padding;

            svg += `  <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${this.renderParams.colorSnap}" stroke-width="2.5" stroke-dasharray="4,4" />\n`;
        });

        svg += `</svg>`;

        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.polyhedron.name}_net_pattern.svg`;
        link.click();
        URL.revokeObjectURL(url);
    }

    triggerObjExport() {
        if (!this.foldingRenderer || !this.foldingRenderer.pivotGroup) return;

        let obj = `# Wavefront OBJ\n# Shape: ${this.polyhedron.name}\n# Fold: ${this.foldPercentage}%\n\n`;
        const verticesWorld = [];
        const facesData = [];

        this.foldingRenderer.pivotGroup.traverse(child => {
            if (child.isMesh) {
                const geom = child.geometry;
                const pos = geom.attributes.position;
                child.updateMatrixWorld(true);

                const localOffset = verticesWorld.length + 1;
                for (let i = 0; i < pos.count; i++) {
                    const localV = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
                    localV.applyMatrix4(child.matrixWorld);
                    verticesWorld.push(localV);
                    obj += `v ${localV.x.toFixed(6)} ${localV.y.toFixed(6)} ${localV.z.toFixed(6)}\n`;
                }

                const index = geom.index;
                if (index) {
                    for (let i = 0; i < index.count; i += 3) {
                        const i1 = index.array[i] + localOffset;
                        const i2 = index.array[i + 1] + localOffset;
                        const i3 = index.array[i + 2] + localOffset;
                        facesData.push(`f ${i1} ${i2} ${i3}`);
                    }
                } else {
                    for (let i = 0; i < pos.count; i += 3) {
                        facesData.push(`f ${i + localOffset} ${i + 1 + localOffset} ${i + 2 + localOffset}`);
                    }
                }
            }
        });

        obj += "\n" + facesData.join("\n") + "\n";

        const blob = new Blob([obj], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.polyhedron.name}_folded_mesh.obj`;
        link.click();
        URL.revokeObjectURL(url);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.AppState = new AppState();
});
