class FoldingRenderer {
    constructor(containerId, appState) {
        this.container = document.getElementById(containerId);
        this.app = appState;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pivotGroup = null;

        this.faceMeshes = {};
        this.pivotGroups = {};
        this.foldAngles = {};

        this.initThree();
        this.setupLights();
        this.animate();

        window.addEventListener('resize', () => this.resize());
    }

    initThree() {
        const rect = this.container.getBoundingClientRect();

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x020617);

        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 100);
        this.camera.position.set(6, 6, 9);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(rect.width, rect.height);
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight.position.set(8, 14, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 40;
        dirLight.shadow.camera.left = -10;
        dirLight.shadow.camera.right = 10;
        dirLight.shadow.camera.top = 10;
        dirLight.shadow.camera.bottom = -10;
        dirLight.shadow.bias = -0.0005;
        this.scene.add(dirLight);

        const pointLight = new THREE.PointLight(0x6366f1, 0.6, 35);
        pointLight.position.set(-5, -3, -5);
        this.scene.add(pointLight);

        const grid = new THREE.GridHelper(22, 22, 0x1e293b, 0x0f172a);
        grid.position.y = -2;
        this.scene.add(grid);
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(rect.width, rect.height);
    }

    createPolygonGeometry(coords, centroid) {
        const geom = new THREE.BufferGeometry();
        const verts = [], indices = [];
        coords.forEach(p => verts.push((p.x - centroid.x) / 100, (p.y - centroid.y) / 100, 0));
        for (let i = 1; i < coords.length - 1; i++) indices.push(0, i, i + 1);
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();
        return geom;
    }

    createFaceMesh(faceIdx, geom) {
        const poly = this.app.polyhedron;
        const faceColor = (poly && poly.faceColors && poly.faceColors[faceIdx])
            ? poly.faceColors[faceIdx]
            : this.app.renderParams.colorFace;
        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(faceColor),
            roughness: 0.15,
            metalness: 0.15,
            side: THREE.DoubleSide,
            shadowSide: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geom, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { faceIdx };

        if (this.app.renderParams.wireframe3D) {
            const edges = new THREE.EdgesGeometry(geom);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1e1b4b, linewidth: 2 }));
            mesh.add(line);
        }
        return mesh;
    }

    /** Release GPU resources held by a pivot subtree (geometries + materials). */
    _disposeGroup(group) {
        group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    }

    rebuildFoldingMesh() {
        // Always remove old geometry — and dispose it, otherwise every
        // rebuild (drag end, color change, checkbox toggle) leaks GPU
        // buffers/programs that JS garbage collection cannot reclaim.
        if (this.pivotGroup) {
            this._disposeGroup(this.pivotGroup);
            this.scene.remove(this.pivotGroup);
            this.pivotGroup = null;
        }
        this.faceMeshes = {};
        this.pivotGroups = {};
        this.foldAngles = {};

        if (!this.app.polyhedron || !this.app.layoutManager) return;

        this.pivotGroup = new THREE.Group();
        this.scene.add(this.pivotGroup);

        const faces = this.app.polyhedron.faces;
        const vertices = this.app.polyhedron.vertices;
        const faceCoords2D = this.app.layoutManager.faceCoords2D;
        const connections = this.app.layoutManager.connections;
        const components = this.app.layoutManager.connectedComponents || [[0]];

        const n = faces.length;
        if (n === 0) return;

        // Build adjacency list for current active connections
        const adj = Array.from({ length: n }, () => []);
        connections.forEach(conn => {
            adj[conn.parent].push({ neighbor: conn.child, conn: conn });
            adj[conn.child].push({ neighbor: conn.parent, conn: conn });
        });

        // Compute dihedral angles
        const dihedralAngles = connections.map((conn, idx) => {
            // For free-built nets, use the default angles computed by LayoutManager
            if (this.app.layoutManager._dihedralDefaults) {
                // Per-connection override takes priority (for 3-3 deltahedron detection)
                if (this.app.layoutManager._perConnDihedralAngles &&
                    this.app.layoutManager._perConnDihedralAngles.has(idx)) {
                    return this.app.layoutManager._perConnDihedralAngles.get(idx);
                }
                const pSides = faces[conn.parent].length;
                const cSides = faces[conn.child].length;
                const key = Math.min(pSides, cSides) + '-' + Math.max(pSides, cSides);
                return this.app.layoutManager._dihedralDefaults[key] || Math.PI / 2;
            }
            // For library polyhedra, compute from 3D normals
            const nParent = GeometryEngine.computeNormal(faces[conn.parent], vertices);
            const nChild = GeometryEngine.computeNormal(faces[conn.child], vertices);
            const dot = nParent[0]*nChild[0] + nParent[1]*nChild[1] + nParent[2]*nChild[2];
            return Math.acos(Math.min(Math.max(dot, -1.0), 1.0));
        });

        // Map connection to its dihedral angle
        const connAngles = new Map();
        connections.forEach((conn, idx) => {
            connAngles.set(conn, dihedralAngles[idx]);
        });

        this.faceMeshes = {};
        this.pivotGroups = {};
        this.foldAngles = {};

        const visited = new Set();
        components.forEach(comp => {
            const root = comp[0];
            const queue = [root];
            const tree = Array.from({ length: n }, () => []);
            visited.add(root);

            while (queue.length > 0) {
                const curr = queue.shift();
                for (const link of adj[curr]) {
                    if (!visited.has(link.neighbor)) {
                        visited.add(link.neighbor);
                        tree[curr].push({ faceIdx: link.neighbor, conn: link.conn });
                        queue.push(link.neighbor);
                    }
                }
            }

            const compGroup = new THREE.Group();
            this.pivotGroup.add(compGroup);
            this.assembleNode(root, null, compGroup, null, tree, connAngles);
        });

        this.updateFoldingState();
    }

    assembleNode(curr, parent, parentPivot, conn, tree, connAngles) {
        const coords = this.app.layoutManager.faceCoords2D[curr];
        if (!coords) return;

        // Calculate centroid
        let cx = 0, cy = 0;
        coords.forEach(p => { cx += p.x; cy += p.y; });
        const centroid = { x: cx / coords.length, y: cy / coords.length };

        const geom = this.createPolygonGeometry(coords, centroid);
        const mesh = this.createFaceMesh(curr, geom);
        this.faceMeshes[curr] = mesh;

        const pivot = new THREE.Group();
        this.pivotGroups[curr] = pivot;
        let localSpaceContainer = pivot;

        if (parent === null) {
            pivot.position.set(centroid.x / 100, centroid.y / 100, 0);
            pivot.add(mesh);
            parentPivot.add(pivot);
        } else {
            const isParent = conn.parent === parent;
            const parentFace = this.app.polyhedron.faces[parent];

            // In parent face, we want the edge vertices
            const pEdgeIdx = isParent ? conn.parentEdgeIdx : conn.childEdgeIdx;
            const cEdgeIdx = isParent ? conn.childEdgeIdx : conn.parentEdgeIdx;

            const pCoords = this.app.layoutManager.faceCoords2D[parent];
            const p1 = pCoords[pEdgeIdx];
            const p2 = pCoords[(pEdgeIdx + 1) % pCoords.length];
            let pCentroidX = 0, pCentroidY = 0;
            pCoords.forEach(p => { pCentroidX += p.x; pCentroidY += p.y; });
            const pCentroid = { x: pCentroidX / pCoords.length, y: pCentroidY / pCoords.length };

            pivot.position.set((p1.x - pCentroid.x) / 100, (p1.y - pCentroid.y) / 100, 0);
            pivot.rotation.order = 'ZXY';
            pivot.rotation.z = Math.atan2(p2.y - p1.y, p2.x - p1.x);

            const cCoords = this.app.layoutManager.faceCoords2D[curr];
            
            // Let's determine vertex mapping. In 2D, the shared edge has the same endpoints.
            // Check if vertex order matches or is reversed
            const c1 = cCoords[cEdgeIdx];
            const c2 = cCoords[(cEdgeIdx + 1) % cCoords.length];

            // Compare p1 with c1/c2 to check direction
            const distP1C1 = Math.hypot(p1.x - c1.x, p1.y - c1.y);
            const distP1C2 = Math.hypot(p1.x - c2.x, p1.y - c2.y);
            const alignReversed = distP1C1 > distP1C2;

            const mapToP1 = alignReversed ? cCoords[(cEdgeIdx + 1) % cCoords.length] : cCoords[cEdgeIdx];
            const mapToP2 = alignReversed ? cCoords[cEdgeIdx] : cCoords[(cEdgeIdx + 1) % cCoords.length];

            const sub = new THREE.Group();
            sub.rotation.z = -Math.atan2(mapToP2.y - mapToP1.y, mapToP2.x - mapToP1.x);

            const tr = new THREE.Group();
            tr.position.set(-(mapToP1.x - centroid.x) / 100, -(mapToP1.y - centroid.y) / 100, 0);

            tr.add(mesh);
            sub.add(tr);
            pivot.add(sub);
            parentPivot.add(pivot);
            localSpaceContainer = tr;

            // Robust 2D cross product for inward folding test
            const det = (mapToP2.x - mapToP1.x) * (centroid.y - mapToP1.y) - (mapToP2.y - mapToP1.y) * (centroid.x - mapToP1.x);
            const angle = connAngles.get(conn) || 0;
            this.foldAngles[curr] = det > 0 ? -angle : angle;
        }

        (tree[curr] || []).forEach(child => {
            this.assembleNode(child.faceIdx, curr, localSpaceContainer, child.conn, tree, connAngles);
        });
    }

    updateFoldingState() {
        if (!this.pivotGroups || !this.foldAngles) return;
        const t = this.app.foldPercentage / 100.0;
        for (const fIdx in this.pivotGroups) {
            if (this.foldAngles[fIdx] !== undefined) {
                this.pivotGroups[fIdx].rotation.x = this.foldAngles[fIdx] * t;
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        if (this.renderer) this.renderer.render(this.scene, this.camera);
    }
}

window.FoldingRenderer = FoldingRenderer;