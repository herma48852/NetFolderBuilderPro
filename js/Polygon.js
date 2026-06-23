/**
 * Polygon.js — Regular polygon primitives for free-form net building.
 * Ported from NetFolderBuilder (github.com/herma48852/NetFolderBuilder).
 */
class Polygon {
    /**
     * @param {number} id - Unique identifier
     * @param {number} sides - 3=Triangle, 4=Square, 5=Pentagon, 6=Hexagon, 8=Octagon, 10=Decagon
     * @param {{x:number, y:number}} center - World position
     * @param {number} [rotationAngle=0] - Radians
     * @param {string} [color] - CSS color string (name or hex). Falls back to DEFAULT_COLORS.
     */
    constructor(id, sides, center, rotationAngle = 0, color = null) {
        this.id = id;
        this.sides = sides;
        this.center = { x: center.x, y: center.y };
        this.rotationAngle = Polygon.normalizeAngle(rotationAngle);
        this.radius = Polygon.sideLength / (2 * Math.sin(Math.PI / sides));
        this.sideLength = Polygon.sideLength;

        const defaults = Polygon.DEFAULT_COLORS;
        this.color = color || (defaults[sides] || '#6366f1');

        this.vertices = this._calcVertices();
        this.edges = this._calcEdges();
        this.isSelected = false;
    }

    static sideLength = 180;  // 3× grid square (grid=60)
    static POLYGON_NAMES = { 3:'Triangle', 4:'Square', 5:'Pentagon', 6:'Hexagon', 8:'Octagon', 10:'Decagon' };
    static DEFAULT_COLORS = {
        3: 'yellow', 4: 'red', 5: 'blue', 6: 'green', 8: 'pink', 10: 'orange'
    };

    static normalizeAngle(a) {
        const pi2 = 2 * Math.PI;
        a = a % pi2;
        return a < 0 ? a + pi2 : a;
    }

    _calcVertices() {
        const verts = [];
        const step = (2 * Math.PI) / this.sides;
        const start = -Math.PI / 2 - step / 2;
        for (let i = 0; i < this.sides; i++) {
            const a = start + i * step;
            verts.push({ x: this.radius * Math.cos(a), y: this.radius * Math.sin(a) });
        }
        return verts;
    }

    _calcEdges() {
        const edges = [];
        for (let i = 0; i < this.sides; i++) {
            const p1 = this.vertices[i];
            const p2 = this.vertices[(i + 1) % this.sides];
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            edges.push({ p1Index: i, p2Index: (i + 1) % this.sides, length: len });
        }
        return edges;
    }

    getAbsoluteVertices() {
        const cos = Math.cos(this.rotationAngle);
        const sin = Math.sin(this.rotationAngle);
        return this.vertices.map(v => ({
            x: v.x * cos - v.y * sin + this.center.x,
            y: v.x * sin + v.y * cos + this.center.y
        }));
    }

    getEdgeAbsoluteEndpoints(edgeIdx) {
        if (edgeIdx < 0 || edgeIdx >= this.sides) return null;
        const cos = Math.cos(this.rotationAngle);
        const sin = Math.sin(this.rotationAngle);
        const v1 = this.vertices[this.edges[edgeIdx].p1Index];
        const v2 = this.vertices[this.edges[edgeIdx].p2Index];
        return [
            { x: v1.x * cos - v1.y * sin + this.center.x, y: v1.x * sin + v1.y * cos + this.center.y },
            { x: v2.x * cos - v2.y * sin + this.center.x, y: v2.x * sin + v2.y * cos + this.center.y }
        ];
    }

    isPointInside(point) {
        const abs = this.getAbsoluteVertices();
        let inside = false;
        for (let i = 0, j = abs.length - 1; i < abs.length; j = i++) {
            if ((abs[i].y > point.y) !== (abs[j].y > point.y) &&
                point.x < (abs[j].x - abs[i].x) * (point.y - abs[i].y) / (abs[j].y - abs[i].y) + abs[i].x) {
                inside = !inside;
            }
        }
        return inside;
    }

    /** Returns the world-space centroid (same as center for regular polys) */
    get centroid() {
        return { x: this.center.x, y: this.center.y };
    }

    // --- Mutation ---
    move(dx, dy) { this.center.x += dx; this.center.y += dy; }
    rotate(dAngle) { this.rotationAngle = Polygon.normalizeAngle(this.rotationAngle + dAngle); }
    setColor(c) { this.color = c; }

    // --- Serialization ---
    toJSON() {
        return {
            id: this.id, sides: this.sides,
            center: { x: this.center.x, y: this.center.y },
            rotationAngle: this.rotationAngle, color: this.color
        };
    }

    static fromJSON(data) {
        return new Polygon(data.id, data.sides, data.center, data.rotationAngle, data.color);
    }
}

window.Polygon = Polygon;
