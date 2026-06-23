/**
 * PolyDatabase — Builds a face-count → polyhedron lookup from PolyRegistry.
 *
 * For every solid in PolyRegistry we pre-compute:
 *   1. faceCounts   — { 3: nTri, 4: nSq, 5: nPent, … }
 *   2. dihedrals    — Map of "minSides-maxSides" → external dihedral (radians)
 *   3. faceAdj      — per-face neighbour-type counts for adjacency-aware
 *                      superset matching (e.g. T-shape of 7 squares fails
 *                      Octagonal Prism because its squares only have
 *                      degree 2, not 3).
 */

window.PolyDatabase = (function () {
    // ══════════════════════════════════════════════════════════════════
    //  Build phase — runs once when the module loads
    // ══════════════════════════════════════════════════════════════════

    /** { signature → [ { key, name, faceCounts, dihedrals, faceAdj }, … ] } */
    const bySignature = new Map();

    /**
     * Stable string key from a face-counts object, e.g. {3:4, 4:1} → "3:4,4:1".
     */
    function makeSig(counts) {
        const parts = [];
        for (const [sides, n] of Object.entries(counts)) {
            if (n) parts.push(`${sides}:${n}`);
        }
        return parts.sort().join(',');
    }

    /**
     * Compute external dihedral angles (angle between outward normals)
     * for every pair of adjacent faces.  Returns a Map keyed by
     * "minSides-maxSides" → angle (unique per key — takes the first
     * encountered value for each face-type pair).
     */
    function computeDihedrals(vertices, faces) {
        // Ensure outward-facing windings
        GeometryEngine.validateAndCorrectWindings(vertices, faces);

        // Build adjacency via shared edges
        const edgeMap = new Map();
        faces.forEach((face, fi) => {
            for (let i = 0; i < face.length; i++) {
                const u = face[i];
                const v = face[(i + 1) % face.length];
                const key = Math.min(u, v) + '_' + Math.max(u, v);
                if (!edgeMap.has(key)) edgeMap.set(key, []);
                edgeMap.get(key).push({ faceIdx: fi, edgeIdx: i, u, v });
            }
        });

        const dihedrals = new Map();
        for (const [, entries] of edgeMap) {
            if (entries.length < 2) continue;
            // Every polyhedron edge is shared by exactly 2 faces
            for (let a = 0; a < entries.length; a++) {
                for (let b = a + 1; b < entries.length; b++) {
                    const fi = entries[a].faceIdx;
                    const fj = entries[b].faceIdx;
                    const pSides = faces[fi].length;
                    const cSides = faces[fj].length;
                    const pairKey = Math.min(pSides, cSides) + '-' + Math.max(pSides, cSides);
                    if (dihedrals.has(pairKey)) continue;

                    const nA = normal(faces[fi], vertices);
                    const nB = normal(faces[fj], vertices);
                    let dot = nA[0]*nB[0] + nA[1]*nB[1] + nA[2]*nB[2];
                    dot = Math.min(Math.max(dot, -1), 1);
                    dihedrals.set(pairKey, Math.acos(dot));
                }
            }
        }
        return dihedrals;
    }

    /** Newell's-method face normal (unit).  Does NOT modify winding. */
    function normal(face, vertices) {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < face.length; i++) {
            const p1 = vertices[face[i]];
            const p2 = vertices[face[(i + 1) % face.length]];
            nx += (p1[1] - p2[1]) * (p1[2] + p2[2]);
            ny += (p1[2] - p2[2]) * (p1[0] + p2[0]);
            nz += (p1[0] - p2[0]) * (p1[1] + p2[1]);
        }
        const len = Math.hypot(nx, ny, nz);
        return len > 1e-9 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
    }

    /**
     * Compute per-face neighbour-type counts from shared edges.
     * Returns an array (indexed by face) of Maps: sideType → count.
     */
    function computeFaceAdjacency(faces) {
        const edgeMap = new Map();
        faces.forEach((face, fi) => {
            for (let i = 0; i < face.length; i++) {
                const u = face[i];
                const v = face[(i + 1) % face.length];
                const key = Math.min(u, v) + '_' + Math.max(u, v);
                if (!edgeMap.has(key)) edgeMap.set(key, []);
                edgeMap.get(key).push(fi);
            }
        });

        const adj = faces.map(() => new Map());
        for (const [, faceIdxs] of edgeMap) {
            if (faceIdxs.length < 2) continue;
            for (let a = 0; a < faceIdxs.length; a++) {
                for (let b = a + 1; b < faceIdxs.length; b++) {
                    const fi = faceIdxs[a];
                    const fj = faceIdxs[b];
                    const sidesJ = faces[fj].length;
                    adj[fi].set(sidesJ, (adj[fi].get(sidesJ) || 0) + 1);
                    const sidesI = faces[fi].length;
                    adj[fj].set(sidesI, (adj[fj].get(sidesI) || 0) + 1);
                }
            }
        }
        return adj;
    }

    /**
     * Check whether the net's per-face neighbour requirements can be
     * satisfied by the solid's faces.  For each net face, the solid
     * must have a distinct face of the *same type* whose neighbour
     * counts are ≥ the net face's counts for every neighbour type.
     *
     * This is a bipartite matching problem (net faces ↔ solid faces),
     * so we use Kuhn's algorithm instead of a fragile greedy walk —
     * a greedy pass can assign a demanding net face too late and
     * wrongly reject an otherwise valid superset candidate.
     *
     * `netFaceSides[i]` is the number of sides of net face i.
     * `solidFaces` is the solid's faces array (to get side counts).
     */
    function adjacencyCompatible(netFaceAdj, netFaceSides, solidFaceAdj, solidFaces) {
        const netN = netFaceAdj.length;
        const solidN = solidFaceAdj.length;

        // Pre-compute the list of solid face candidates for each net face.
        const candidates = [];
        for (let ni = 0; ni < netN; ni++) {
            const netReq = netFaceAdj[ni];
            const netSides = netFaceSides[ni];
            const list = [];
            for (let si = 0; si < solidN; si++) {
                if (solidFaces[si].length !== netSides) continue;
                const solidNeighbors = solidFaceAdj[si];
                let ok = true;
                for (const [sideType, count] of netReq) {
                    if ((solidNeighbors.get(sideType) || 0) < count) {
                        ok = false;
                        break;
                    }
                }
                if (ok) list.push(si);
            }
            // A net face with no viable solid face => impossible.
            if (list.length === 0) return false;
            candidates.push(list);
        }

        // Kuhn's algorithm for maximum bipartite matching.
        const matchSolid = new Array(solidN).fill(-1);
        const seen = new Array(solidN);

        function tryKuhn(ni) {
            for (const si of candidates[ni]) {
                if (seen[si]) continue;
                seen[si] = true;
                if (matchSolid[si] === -1 || tryKuhn(matchSolid[si])) {
                    matchSolid[si] = ni;
                    return true;
                }
            }
            return false;
        }

        // Process the most constrained net faces first (fewest candidates)
        // — this speeds up matching and reduces backtracking.
        const order = candidates
            .map((_, i) => i)
            .sort((a, b) => candidates[a].length - candidates[b].length);

        let matched = 0;
        for (const ni of order) {
            seen.fill(false);
            if (tryKuhn(ni)) matched++;
            else return false;
        }
        return matched === netN;
    }

    // ── Iterate PolyRegistry ────────────────────────────────────────
    if (window.PolyRegistry) {
        for (const [key, data] of Object.entries(window.PolyRegistry)) {
            if (!data.vertices || !data.faces) continue;
            const faces = JSON.parse(JSON.stringify(data.faces));
            const vertices = JSON.parse(JSON.stringify(data.vertices));

            // Face counts
            const counts = {};
            faces.forEach(f => {
                const n = f.length;
                counts[n] = (counts[n] || 0) + 1;
            });

            // Dihedral angles
            const dihedrals = computeDihedrals(vertices, faces);

            // Face adjacency (for subset matching)
            const faceAdj = computeFaceAdjacency(faces);

            const entry = {
                key: key,
                name: data.name || key,
                faceCounts: counts,
                totalFaces: faces.length,
                dihedrals: dihedrals,  // Map<string, number>
                faceAdj: faceAdj       // Array<Map<neighbourSides, count>>
            };

            const sig = makeSig(counts);
            if (!bySignature.has(sig)) bySignature.set(sig, []);
            bySignature.get(sig).push(entry);
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  Public API
    // ══════════════════════════════════════════════════════════════════

    return {
        /**
         * Return all polyhedra whose face counts exactly match the given
         * counts object, e.g. {3: 8} or {3: 4, 4: 1}.
         *
         * Each result has: key, name, faceCounts, dihedrals (Map).
         */
        findMatches: function (counts) {
            const sig = makeSig(counts);
            return bySignature.get(sig) || [];
        },

        /**
         * For a free-built net, provide a Map of "p-k" → external
         * dihedral angle, using the first matching polyhedron
         * (or null if none match).
         */
        defaultDihedrals: function (counts) {
            const matches = this.findMatches(counts);
            return matches.length > 0 ? matches[0].dihedrals : null;
        },

        /**
         * Find the library solid with the FEWEST total faces that still
         * contains the given net as a connected subset.  `netFaceAdj` is
         * an array (indexed by net face) of Maps: neighbourSideType →
         * count.  Pass null to skip adjacency checks.
         *
         * A candidate only qualifies if:
         *   1. Its face counts are a superset of `counts`.
         *   2. For each face in the net, the solid contains a distinct
         *      face of the same type whose neighbour counts cover the
         *      net face's requirements (adjacency-aware filtering —
         *      approximates a connected subgraph via bipartite matching).
         *
         * Returns { entry, missing, totalFaces, netFaces } for the
         * smallest candidate, or null.
         */
        bestSuperset: function (counts, netFaceAdj, netFaceSides) {
            let best = null;
            let bestTotal = Infinity;
            let bestMissing = Infinity;

            const netFaces = Object.values(counts).reduce((s, n) => s + n, 0);

            for (const [, entries] of bySignature) {
                for (const e of entries) {
                    // ── 1. Face-count superset check ────────────
                    let valid = true;
                    let missing = 0;
                    for (const [side, needed] of Object.entries(counts)) {
                        const have = e.faceCounts[side] || 0;
                        if (have < needed) { valid = false; break; }
                        missing += have - needed;
                    }
                    if (!valid) continue;
                    for (const [side, have] of Object.entries(e.faceCounts)) {
                        if (!(side in counts)) missing += have;
                    }

                    // ── 2. Adjacency compatibility check ────────
                    if (netFaceAdj && netFaceSides) {
                        const solidData = window.PolyRegistry[e.key];
                        const solidFaces = solidData ? solidData.faces : null;
                        if (!solidFaces || !adjacencyCompatible(netFaceAdj, netFaceSides, e.faceAdj, solidFaces)) continue;
                    }

                    // ── 3. Pick smallest by total face count ────
                    const total = e.totalFaces;
                    if (total < bestTotal ||
                        (total === bestTotal && missing < bestMissing)) {
                        bestTotal = total;
                        bestMissing = missing;
                        best = e;
                    }
                }
            }
            return best
                ? { entry: best, missing: bestMissing, totalFaces: bestTotal, netFaces: netFaces }
                : null;
        },

        /** Return the raw signature map for debugging. */
        getSignatureMap: function () {
            return bySignature;
        },

        /** Number of unique face-count signatures in the database. */
        signatureCount: function () {
            return bySignature.size;
        }
    };
})();
