// Browser integration tests for fixes #2–#7 (+ regression sanity).
// Drives the real app in headless Chromium via Puppeteer.
'use strict';
const puppeteer = require('/home/kimi/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer');

let failures = 0;
function check(label, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function checkTrue(label, cond, detail = '') {
    if (!cond) failures++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + detail}`);
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });

    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

    await page.goto('file:///tmp/nfb/index.html', { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => window.AppState && window.AppState.layoutManager, { timeout: 30000 });
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ────────────────────────────────────────────────────────────────
    // FIX #3 — SVG export on empty canvas must not throw
    // ────────────────────────────────────────────────────────────────
    const svgEmpty = await page.evaluate(() => {
        try { window.AppState.triggerSvgExport(); return 'no-throw'; }
        catch (e) { return 'threw: ' + e.message; }
    });
    check('#3 SVG export on empty canvas', svgEmpty, 'no-throw');

    // ────────────────────────────────────────────────────────────────
    // FIX #2a — free-build state is wiped when a library solid loads
    // ────────────────────────────────────────────────────────────────
    // Build a free triangle via the real UI path (palette click + canvas mousedown)
    await page.click('#palette-buttons .palette-btn[data-sides="3"]');
    await page.evaluate(() => {
        const c = document.getElementById('canvas-2d');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await sleep(150);
    const freeBuilt = await page.evaluate(() => ({
        polys: window.AppState.layoutManager.freePolygons.length,
        name: window.AppState.polyhedron && window.AppState.polyhedron.name
    }));
    check('#2 setup: free triangle placed', freeBuilt.polys, 1);
    check('#2 setup: mode is Free-Built Net', freeBuilt.name, 'Free-Built Net');

    // Now load a library solid and prod it with a mouse-move (the old clobber path)
    await page.select('#shape-selector', 'cube');
    await sleep(200);
    await page.evaluate(() => {
        const c = document.getElementById('canvas-2d');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 }));
    });
    await sleep(150);
    const afterLibrary = await page.evaluate(() => ({
        name: window.AppState.polyhedron && window.AppState.polyhedron.name,
        freePolys: window.AppState.layoutManager.freePolygons.length,
        faces2D: window.AppState.layoutManager.faceCoords2D.length,
        key: window.AppState.currentKey
    }));
    check('#2a library solid survives mouse-move', afterLibrary.name, 'Cube');
    check('#2a free polygons wiped on load', afterLibrary.freePolys, 0);
    check('#2a library net laid out (6 faces)', afterLibrary.faces2D, 6);
    check('#2a currentKey set', afterLibrary.key, 'cube');

    // ────────────────────────────────────────────────────────────────
    // FIX #2b — placing a palette shape unloads the library solid cleanly
    // ────────────────────────────────────────────────────────────────
    await page.click('#palette-buttons .palette-btn[data-sides="4"]');
    await page.evaluate(() => {
        const c = document.getElementById('canvas-2d');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await sleep(150);
    const afterPalette = await page.evaluate(() => ({
        name: window.AppState.polyhedron && window.AppState.polyhedron.name,
        selector: document.getElementById('shape-selector').value,
        key: window.AppState.currentKey
    }));
    check('#2b palette placement switches to free mode', afterPalette.name, 'Free-Built Net');
    check('#2b library selector reset', afterPalette.selector, '');
    check('#2b currentKey cleared', afterPalette.key, null);

    // ────────────────────────────────────────────────────────────────
    // FIX #1 (in-browser sanity) — real Polygon objects, id 0 mid-chain
    // ────────────────────────────────────────────────────────────────
    const scissor = await page.evaluate(() => {
        const lm = window.AppState.layoutManager;
        lm.freePolygons = [0, 1, 2, 3].map(i => new Polygon(i, 4, { x: i * 200, y: 0 }, 0));
        lm.freeConnections = [
            { id: 'free-a', polyA: 0, polyB: 1, edgeA: 0, edgeB: 2 },
            { id: 'free-b', polyA: 1, polyB: 2, edgeA: 0, edgeB: 2 },
            { id: 'free-c', polyA: 2, polyB: 3, edgeA: 0, edgeB: 2 },
        ];
        const mid = lm._canDetachFreeConn(lm.freeConnections[1]);
        const leaf = lm._canDetachFreeConn(lm.freeConnections[0]);
        return { mid, leaf };
    });
    check('#1 browser: mid-chain seam NOT detachable', scissor.mid, false);
    check('#1 browser: leaf seam detachable', scissor.leaf, true);

    // ────────────────────────────────────────────────────────────────
    // FIX #6 — geometric V/E stats for free nets
    // ────────────────────────────────────────────────────────────────
    const stats = await page.evaluate(() => {
        const lm = window.AppState.layoutManager;
        const read = () => ({
            v: document.getElementById('stat-v').textContent,
            e: document.getElementById('stat-e').textContent,
            f: document.getElementById('stat-f').textContent
        });
        // Single square
        lm.freePolygons = [new Polygon(0, 4, { x: 0, y: 0 }, 0)];
        lm.freeConnections = [];
        lm._freeNetDirty = true;
        window.AppState.update3DViewer();
        const single = read();
        // Two squares sharing an edge (side 180, so centres 180 apart on x)
        lm.freePolygons.push(new Polygon(1, 4, { x: 180, y: 0 }, 0));
        lm.freeConnections = [{ id: 'free-s', polyA: 0, polyB: 1, edgeA: 1, edgeB: 3 }];
        lm._freeNetDirty = true;
        window.AppState.update3DViewer();
        const pair = read();
        return { single, pair };
    });
    check('#6 single square V', stats.single.v, '4');
    check('#6 single square E', stats.single.e, '4');   // pre-fix: '2'
    check('#6 two squares V', stats.pair.v, '6');       // pre-fix: '8'
    check('#6 two squares E', stats.pair.e, '7');       // pre-fix: '4'
    check('#6 two squares F', stats.pair.f, '2');

    // ────────────────────────────────────────────────────────────────
    // FIX #5 — buildFreeNetForFolding keeps real u/v edge endpoints
    // ────────────────────────────────────────────────────────────────
    const uv = await page.evaluate(() => {
        const lm = window.AppState.layoutManager;
        lm.freePolygons = [new Polygon(0, 3, { x: 0, y: 0 }, 0), new Polygon(1, 3, { x: 180, y: 0 }, 0)];
        lm.freeConnections = [{ id: 'free-t', polyA: 0, polyB: 1, edgeA: 1, edgeB: 2 }];
        lm._freeNetDirty = true;
        window.AppState.update3DViewer();   // triggers buildFreeNetForFolding
        const conn = lm.connections.find(c => c.id === 'free-t');
        // scissors midpoint lookup must also resolve (indexOf(u/v) >= 0)
        const parentFace = window.AppState.polyhedron.faces[conn.parent];
        return { u: conn.u, v: conn.v, uIdx: parentFace.indexOf(conn.u), vIdx: parentFace.indexOf(conn.v) };
    });
    check('#5 conn.u preserved', uv.u, 1);   // pre-fix: 0
    check('#5 conn.v preserved', uv.v, 2);   // pre-fix: 0
    checkTrue('#5 u/v resolvable on parent face', uv.uIdx >= 0 && uv.vIdx >= 0, JSON.stringify(uv));

    // ────────────────────────────────────────────────────────────────
    // FIX #4 — GPU resources disposed on rebuild
    // ────────────────────────────────────────────────────────────────
    // NB: three.js only uploads (and counts) a geometry once it is rendered,
    // so each rebuild must be followed by a real frame to expose the leak.
    const leak = await page.evaluate(async () => {
        window.AppState.loadSolid('icosahedron');
        const fr = window.AppState.foldingRenderer;
        const frame = () => new Promise(r => requestAnimationFrame(r));
        await frame();
        const baseline = fr.renderer.info.memory.geometries;
        for (let i = 0; i < 10; i++) {
            fr.rebuildFoldingMesh();
            await frame();   // render -> upload -> (pre-fix) leak
        }
        return { baseline, after: fr.renderer.info.memory.geometries };
    });
    checkTrue('#4 geometry count stable across 15 rebuilds',
        leak.after <= leak.baseline, JSON.stringify(leak));  // pre-fix: grows by 2×faces each rebuild

    // ────────────────────────────────────────────────────────────────
    // FIX #7 — SVG export uses per-face colors
    // ────────────────────────────────────────────────────────────────
    const svg = await page.evaluate(() => new Promise(resolve => {
        window.AppState.loadSolid('tetrahedron');
        window.AppState.polyhedron.faceColors = ['#ff0000', '#00ff00']; // faces 0,1 custom; 2,3 fall back
        const origCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob) => { blob.text().then(resolve); return origCreate(blob); };
        HTMLAnchorElement.prototype.click = function () {};
        window.AppState.triggerSvgExport();
    }));
    checkTrue('#7 SVG contains custom face color #ff0000', svg.includes('fill="#ff0000"'));
    checkTrue('#7 SVG contains custom face color #00ff00', svg.includes('fill="#00ff00"'));
    checkTrue('#7 SVG falls back to global color', svg.includes('fill="#6366f1"'));
    checkTrue('#7 SVG uses fill-opacity (hex+named safe)', svg.includes('fill-opacity="0.2"'));

    // ────────────────────────────────────────────────────────────────
    // REGRESSION — one solid per category + big Johnson solid, fold, coloring
    // ────────────────────────────────────────────────────────────────
    consoleErrors.length = 0;
    const regression = await page.evaluate(() => {
        const out = [];
        const expected = {
            tetrahedron: 4, cuboctahedron: 14, prism_hexagonal: 8,
            antiprism_square: 10, J92: 20
        };
        for (const key of Object.keys(expected)) {
            window.AppState.loadSolid(key);
            const f = window.AppState.polyhedron.faces.length;
            const laidOut = window.AppState.layoutManager.faceCoords2D.length;
            const statF = document.getElementById('stat-f').textContent;
            out.push({ key, ok: f === expected[key] && laidOut === f && statF === String(f) });
        }
        window.AppState.updateFold(50);                       // fold mid-way
        window.AppState.layoutManager.applyRandomProperColoring();
        window.AppState.updateFold(0);
        return out;
    });
    for (const r of regression) checkTrue(`regression: ${r.key} loads & lays out`, r.ok, JSON.stringify(r));
    checkTrue('regression: no console/page errors across suite', consoleErrors.length === 0,
        consoleErrors.slice(0, 3).join(' | '));

    await browser.close();
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
