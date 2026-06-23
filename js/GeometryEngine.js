class GeometryEngine {
    /**
     * Computes the 3D normal vector of a face using Newell's method.
     */
    static computeNormal(face, vertices) {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < face.length; i++) {
            const p1 = vertices[face[i]];
            const p2 = vertices[face[(i + 1) % face.length]];
            nx += (p1[1] - p2[1]) * (p1[2] + p2[2]);
            ny += (p1[2] - p2[2]) * (p1[0] + p2[0]);
            nz += (p1[0] - p2[0]) * (p1[1] + p2[1]);
        }
        const len = Math.hypot(nx, ny, nz);
        return len > 1e-6 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
    }

    /**
     * Determines whether face windings are outward or inward by checking total signed volume.
     * Fixes winding order in place if needed.
     */
    static validateAndCorrectWindings(vertices, faces) {
        let volume3D = 0;
        for (const face of faces) {
            const n = this.computeNormal(face, vertices);
            const p = vertices[face[0]];
            volume3D += (p[0] * n[0] + p[1] * n[1] + p[2] * n[2]);
        }
        if (volume3D < 0) {
            for (let i = 0; i < faces.length; i++) {
                faces[i].reverse();
            }
        }
    }

    /**
     * Generates an orthonormal 2D coordinate window system local to a specific 3D face.
     */
    static intrinsic2D(face, vertices) {
        const p0 = vertices[face[0]];
        const p1 = vertices[face[1]];
        const normal = this.computeNormal(face, vertices);

        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const uLen = Math.hypot(ux, uy, uz);
        const u = [ux / uLen, uy / uLen, uz / uLen];

        const v = [
            normal[1] * u[2] - normal[2] * u[1],
            normal[2] * u[0] - normal[0] * u[2],
            normal[0] * u[1] - normal[1] * u[0]
        ];

        return face.map(idx => {
            const p = vertices[idx];
            const dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
            return {
                x: dx * u[0] + dy * u[1] + dz * u[2],
                y: dx * v[0] + dy * v[1] + dz * v[2]
            };
        });
    }

    /**
     * Maps all edge structural adjacencies across faces.
     */
    static buildAdjacencyTree(faces) {
        const edgeMap = new Map();
        faces.forEach((face, faceIdx) => {
            for (let i = 0; i < face.length; i++) {
                const u = face[i];
                const v = face[(i + 1) % face.length];
                const key = Math.min(u, v) + "_" + Math.max(u, v);
                if (!edgeMap.has(key)) edgeMap.set(key, []);
                edgeMap.get(key).push({ faceIdx, edgeIdx: i, u, v });
            }
        });
        return edgeMap;
    }

    /**
     * Traverses adjacency via a BFS Spanning Tree to unlock flat layout deployment.
     */
    static generateSpanningTree(faces, startFace = 0) {
        const edgeMap = this.buildAdjacencyTree(faces);
        const visited = new Set([startFace]);
        const queue = [startFace];
        const connections = [];

        while (queue.length > 0) {
            const current = queue.shift();
            const face = faces[current];

            for (let i = 0; i < face.length; i++) {
                const u = face[i];
                const v = face[(i + 1) % face.length];
                const key = Math.min(u, v) + "_" + Math.max(u, v);
                const shared = edgeMap.get(key) || [];

                for (const connection of shared) {
                    if (!visited.has(connection.faceIdx)) {
                        visited.add(connection.faceIdx);
                        connections.push({
                            parent: current,
                            child: connection.faceIdx,
                            parentEdgeIdx: i,
                            childEdgeIdx: connection.edgeIdx,
                            u: connection.u,
                            v: connection.v
                        });
                        queue.push(connection.faceIdx);
                    }
                }
            }
        }
        return connections;
    }

    /**
     * Shrinks a polygon by a factor relative to its centroid.
     * Works on polygons defined as arrays of {x, y} objects.
     */
    static shrinkPolygon(poly, factor) {
        let cx = 0, cy = 0;
        poly.forEach(p => { cx += p.x; cy += p.y; });
        cx /= poly.length;
        cy /= poly.length;
        return poly.map(p => ({
            x: cx + (p.x - cx) * factor,
            y: cy + (p.y - cy) * factor
        }));
    }

    /**
     * Separating Axis Theorem (SAT) collision framework checker.
     * Evaluates if two independent polygonal 2D loops overlap.
     */
    static checkSATCollision(polyA, polyB) {
        const polygons = [polyA, polyB];
        for (let p = 0; p < polygons.length; p++) {
            const polygon = polygons[p];
            for (let i = 0; i < polygon.length; i++) {
                const next = (i + 1) % polygon.length;
                const va = polygon[i];
                const vb = polygon[next];

                const axis = { x: -(vb.y - va.y), y: vb.x - va.x };
                const len = Math.hypot(axis.x, axis.y);
                if (len === 0) continue;
                axis.x /= len;
                axis.y /= len;

                let minA = Infinity, maxA = -Infinity;
                for (let k = 0; k < polyA.length; k++) {
                    const proj = polyA[k].x * axis.x + polyA[k].y * axis.y;
                    if (proj < minA) minA = proj;
                    if (proj > maxA) maxA = proj;
                }

                let minB = Infinity, maxB = -Infinity;
                for (let k = 0; k < polyB.length; k++) {
                    const proj = polyB[k].x * axis.x + polyB[k].y * axis.y;
                    if (proj < minB) minB = proj;
                    if (proj > maxB) maxB = proj;
                }

                if (maxA < minB || maxB < minA) {
                    return false; // Found a separating axis (no overlap)
                }
            }
        }
        return true; // Overlaps on all axes
    }
}

window.GeometryEngine = GeometryEngine;