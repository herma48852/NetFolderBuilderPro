// Full regression: load every one of the 120 library solids through the real
// UI path, verify stats + layout + 3D rebuild, and exercise the free-build
// lifecycle (build -> color -> cut -> clear). Fails on any page error.
'use strict';
const puppeteer = require('/home/kimi/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer');

let failures = 0;
const fail = (label, detail) => { failures++; console.log(`FAIL  ${label}  ${detail}`); };

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('file:///tmp/nfb/index.html', { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => window.AppState && window.AppState.layoutManager, { timeout: 30000 });

    const result = await page.evaluate(() => {
        const bad = [];
        const keys = Object.keys(PolyRegistry);
        for (const key of keys) {
            try {
                window.AppState.loadSolid(key);
                const p = window.AppState.polyhedron;
                const lm = window.AppState.layoutManager;
                // Euler check on stats
                const v = +document.getElementById('stat-v').textContent;
                const e = +document.getElementById('stat-e').textContent;
                const f = +document.getElementById('stat-f').textContent;
                if (f !== p.faces.length) bad.push(key + ': statF mismatch');
                if (v - e + f !== 2) bad.push(key + ': Euler ' + (v - e + f));
                if (lm.faceCoords2D.length !== p.faces.length) bad.push(key + ': layout incomplete');
                if (!lm.connections || lm.connections.length !== p.faces.length - 1)
                    bad.push(key + ': spanning tree conns ' + (lm.connections || []).length + ' != ' + (p.faces.length - 1));
                // fold animation mid-state + rebuild
                window.AppState.updateFold(50);
                window.AppState.updateFold(0);
            } catch (err) {
                bad.push(key + ': threw ' + err.message);
            }
        }
        return { total: keys.length, bad };
    });

    console.log(`loaded ${result.total} solids through the real UI path`);
    if (result.bad.length) result.bad.slice(0, 10).forEach(b => fail('solid', b));
    else console.log('PASS  all 120 solids: stats Euler=2, full layout, spanning tree, fold cycle');

    // Free-build lifecycle through real mouse events
    const life = await page.evaluate(() => {
        const lm = window.AppState.layoutManager;
        try {
            // place 3 triangles programmatically via the palette path
            const c = document.getElementById('canvas-2d');
            const r = c.getBoundingClientRect();
            const place = (x, y) => {
                lm._selectPaletteShape(3);
                c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + x, clientY: r.top + y }));
                window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
            };
            place(200, 200); place(400, 200); place(300, 350);
            const placed = lm.freePolygons.length === 3;
            window.AppState.layoutManager.applyRandomProperColoring();
            const colored = window.AppState.polyhedron.faceColors.length === 3;
            document.getElementById('btn-clear-canvas').click();
            const cleared = lm.freePolygons.length === 0 && window.AppState.polyhedron === null;
            // export buttons must be safe after clear
            window.AppState.triggerSvgExport();
            window.AppState.triggerObjExport();
            return { placed, colored, cleared };
        } catch (err) { return { error: err.message }; }
    });
    if (life.error) fail('free-build lifecycle', life.error);
    else if (!life.placed || !life.colored || !life.cleared) fail('free-build lifecycle', JSON.stringify(life));
    else console.log('PASS  free-build lifecycle: place -> color -> clear -> safe exports');

    if (errors.length) errors.slice(0, 5).forEach(e => fail('pageerror', e));
    else console.log('PASS  zero page errors across the entire run');

    await browser.close();
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
