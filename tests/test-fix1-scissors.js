// Test Fix #1 — scissors detach must respect polygon id 0 (falsy-id bug).
// _canDetachFreeConn / _getIsolatedFreePoly only touch `this.freeConnections`,
// so we can drive the real prototype methods with a bare stub.
'use strict';
global.window = global;
require('../js/LayoutManager.js');

const LM = global.LayoutManager;
let failures = 0;
function check(label, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${actual}, want ${expected})`);
}

// Chain of 4 free polygons: 0 — 1 — 2 — 3  (ids start at 0, like nextPolygonId)
const conns = [
    { id: 'free-a', polyA: 0, polyB: 1 },
    { id: 'free-b', polyA: 1, polyB: 2 },
    { id: 'free-c', polyA: 2, polyB: 3 },
];
const stub = { freeConnections: conns };

const canDetach = LM.prototype._canDetachFreeConn.bind(stub);
const getIsolated = LM.prototype._getIsolatedFreePoly.bind(stub);

// Leaf seams isolate exactly one polygon -> detachable
check('leaf seam 0-1 detachable', canDetach(conns[0]), true);
check('leaf seam 2-3 detachable', canDetach(conns[2]), true);
check('isolated poly for seam 0-1', getIsolated(conns[0]), 0);
check('isolated poly for seam 2-3', getIsolated(conns[2]), 3);

// Middle seam splits into {0,1} and {2,3} -> must NOT be detachable.
// Pre-fix this returned true because BFS from poly 1 could never reach id 0.
check('middle seam 1-2 NOT detachable', canDetach(conns[1]), false);
check('no isolated poly for middle seam', getIsolated(conns[1]), null);

// Triangle chain ending at id 0: 2 — 1 — 0, cutting 1-0 isolates poly 0 itself
const conns2 = [
    { id: 'free-x', polyA: 2, polyB: 1 },
    { id: 'free-y', polyA: 1, polyB: 0 },
];
const stub2 = { freeConnections: conns2 };
check('seam 1-0 detachable (isolates id 0)',
    LM.prototype._canDetachFreeConn.call(stub2, conns2[1]), true);
check('isolated poly is id 0',
    LM.prototype._getIsolatedFreePoly.call(stub2, conns2[1]), 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
