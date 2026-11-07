// XFCE click parity probe (tips off), Bot Desktop.
// Plan 2026-11-07-mizu-l2d-xfce-bot-harness Task 2. Drives <prefab> (default
// gaoxiong_7) in a headed Chromium window on the isolated Bot Desktop
// (DISPLAY :20) and proves tips-OFF clicks fire the same zones as tips-ON
// (PARITY-SPEC AC-1.1 / AC-1.2 / AC-1.3). Output JSON lines
// {prefab, action, x, y, expectedAction, lastTap, tips, pass} match
// tests/probe/p0_tips_off.mjs outcome shape.
//
// RED  (guard must fail): DISPLAY=:0 node tests/xfce/xfce_click_probe.mjs gaoxiong_7
// GREEN (isolated):       DISPLAY=:20 XDG_CONFIG_HOME=$HOME/.hermes/bot-desktop/xdg node tests/xfce/xfce_click_probe.mjs gaoxiong_7
//
// The browser is headed (not --headless) so clicks land in a real XFCE window
// on :20 via CDP Input dispatched to that window's viewport. The busy-gate
// wait, live bounds re-measurement, and model-null contract are copied from
// tests/probe/p0_tips_off.mjs (Review Focus 1); the Bot Desktop guard
// (Review Focus 2) runs before any server/browser is started.
//
// launchHeaded() is forked from tests/probe/cdp.mjs launch() with the
// '--headless=new' flag removed: cdp.mjs hardcodes headless, but XFCE parity
// needs a real window on :20.
import { assertIsolated } from './isolation_guard.mjs';
import { createEvidenceDir } from './evidence.mjs';
import { startServer } from '../probe/_env.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname as pathDirname, join } from 'node:path';

const prefab = process.argv[2] || 'gaoxiong_7';

// 1. Isolation guard at the top: throw before starting any server/browser.
try {
    assertIsolated(process.env);
} catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
}

// Brave on :20 needs the Bot Desktop Xauthority when the caller's
// XAUTHORITY points at another display; default to the bot file.
const botXauthority = join(homedir(), '.hermes/bot-desktop/Xauthority');
if (!process.env.XAUTHORITY && existsSync(botXauthority)) {
    process.env.XAUTHORITY = botXauthority;
}

// ---- headed CDP launch (forked from tests/probe/cdp.mjs, headless removed) ----
const BROWSER_CANDIDATES = ['brave', 'chromium', 'google-chrome-stable', 'google-chrome', 'microsoft-edge'];

function findBrowser() {
    for (const name of BROWSER_CANDIDATES) {
        try {
            execFileSync('which', [name], { stdio: 'pipe' });
            return name;
        } catch { /* try next */ }
    }
    throw new Error('no chromium-family browser found (tried: ' + BROWSER_CANDIDATES.join(', ') + ')');
}

async function launchHeaded({ url, width = 1280, height = 800 } = {}) {
    const bin = findBrowser();
    const profile = mkdtempSync(join(tmpdir(), 'mizu-xfce-cdp-'));
    const proc = spawn(bin, [
        '--remote-debugging-port=0',
        '--no-first-run', '--no-default-browser-check',
        '--disable-crash-reporter', '--disable-brave-update',
        // Xvnc (:20) has no 3D hardware: headed Chromium needs software
        // WebGL or Pixi fails with "WebGL unsupported in this browser".
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const wsUrl = await new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error('browser did not expose a DevTools endpoint')), 15000);
        proc.stderr.on('data', (d) => {
            buf += d.toString();
            const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
            if (m) { clearTimeout(timer); resolve(m[1]); }
        });
        proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`browser exited early (${code}): ${buf.slice(-400)}`)); });
    });

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let msgId = 0;
    const pending = new Map();
    const consoleLogs = [];
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type !== 'debug') {
            const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
            consoleLogs.push(`[${msg.params.type}] ${text}`);
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            consoleLogs.push(`[exception] ${d.text} ${d.exception?.description ?? ''}`);
        }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: pageSession } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, pageSession);
    await send('Runtime.enable', {}, pageSession);
    await send('Page.navigate', { url }, pageSession);
    await new Promise(r => setTimeout(r, 300));

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const page = {
        targetId,
        async evaluate(expression) {
            const r = await send('Runtime.evaluate', {
                expression, returnByValue: true, awaitPromise: true, userGesture: true,
            }, pageSession);
            if (r.exceptionDetails) {
                throw new Error('page eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
            }
            return r.result?.value;
        },
        async waitFor(expression, timeoutMs = 30000, intervalMs = 250) {
            const t0 = Date.now();
            for (;;) {
                let ok = false;
                try { ok = await page.evaluate(expression); } catch { /* page busy */ }
                if (ok) return true;
                if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor timeout: ${expression}`);
                await sleep(intervalMs);
            }
        },
        async click(x, y) {
            for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
                await send('Input.dispatchMouseEvent', {
                    type, x, y,
                    button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1,
                    pointerType: 'mouse',
                }, pageSession);
                await sleep(40);
            }
        },
        async screenshot(path) {
            const { data } = await send('Page.captureScreenshot', { format: 'png' }, pageSession);
            mkdirSync(pathDirname(path), { recursive: true });
            writeFileSync(path, Buffer.from(data, 'base64'));
            return path;
        },
        consoleLogs: () => [...consoleLogs],
        async close() {
            try { await send('Browser.close'); } catch { /* socket may drop first */ }
            ws.close();
            proc.kill('SIGKILL');
            try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
        },
    };
    return page;
}

// Runs `fn(page)` against a headed model page on :8787; always tears down.
async function withHeadedPage(prefab, fn) {
    const server = await startServer(8787);
    let page = null;
    try {
        page = await launchHeaded({ url: `http://127.0.0.1:8787/?model=${prefab}` });
        try {
            await page.waitFor('window.__mizu && window.__mizu.model !== null', 60000);
        } catch {
            throw new Error('model not ready');
        }
        if (!(await page.evaluate('window.__mizu && window.__mizu.model !== null'))) {
            throw new Error('model not ready');
        }
        return await fn(page);
    } finally {
        if (page) await page.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise(r => {
            if (server.exitCode !== null) return r();
            server.once('exit', () => r());
            setTimeout(r, 1000);
        });
    }
}

async function main() {
    // 2. measure zone centers in canvas px with tips ON (forces bounds).
    const targets = await withHeadedPage(prefab, async (page) => {
        await page.evaluate('window.mizu && window.mizu.tips(true)');
        await page.waitFor('__mizu.hotspots.some(h => h.bounds)', 10000);
        const zones = await page.evaluate(`(() => {
            const m = __mizu.model;
            const out = [];
            for (const h of __mizu.hotspots) {
                // click-type zones only (2/6 + synthesized touch zones): pure
                // param-drag zones do not fire on a plain click by design
                const isClickType = !h.zone || (h.zone.trigger && [2, 6].includes(h.zone.trigger.type));
                if (!h.bounds || h.index < 0 || !h.action || !isClickType) continue;
                // zones the game itself refuses in the current state (drags
                // ignore/reactCondition) must not be expected to fire
                if (h.zone && !__mizu.engine.canFire(h.zone)) continue;
                const b = h.bounds;
                const c = new PIXI.Point((b.x + b.x + b.w) / 2, (b.y + b.y + b.h) / 2);
                m.internalModel.localTransform.apply(c, c);
                m.toGlobal(c, c);
                out.push({ action: h.action, x: Math.round(c.x), y: Math.round(c.y),
                           onscreen: c.x >= 0 && c.y >= 0 && c.x < innerWidth && c.y < innerHeight });
            }
            return out;
        })()`);
        await page.evaluate('window.mizu.tips(false)');
        return zones.filter(z => z.onscreen);
    });
    if (!targets.length) { console.error('FAIL: no on-screen click zones measured for ' + prefab); process.exit(1); }

    // 3. fresh load, tips off -> click every recorded pixel. Busy-gate wait
    //    (P0-2: a playing animation+voice correctly swallows triggers) and
    //    live bounds re-measurement before each click (Review Focus 1).
    const runDir = createEvidenceDir(new Date().toISOString().slice(0, 10));
    const shotPath = join(runDir, 'probe', 'xfce_click_probe.png');

    const results = await withHeadedPage(prefab, async (page) => {
        await page.waitFor('!__mizu.dialogue.playing', 25000).catch(() => {});
        const out = [];
        const idleExpr = `(() => { const mm = __mizu.model.internalModel.motionManager;
            return (mm.state.currentGroup === undefined || mm.state.currentGroup === mm.groups.idle)
                && performance.now() >= (__mizu.dialogue ? (__mizu.dialogue.busyUntil ?? 0) : 0); })()`;
        for (const z of targets) {
            await page.waitFor(idleExpr, 40000).catch(() => {});
            const didReset = await page.evaluate(`(() => {
                if (StateManager.currentState !== 0) {
                    StateManager.reset();
                    return true;
                }
                return false;
            })()`);
            if (didReset) {
                await new Promise(r => setTimeout(r, 600));
                await page.waitFor(idleExpr, 40000).catch(() => {});
            }
            if (!(await page.evaluate('window.__mizu && window.__mizu.model !== null'))) {
                throw new Error('model not ready');
            }
            // Re-measure zone position from live mesh bounds so animated pose shifts
            // don't leave the click targeting a stale pixel (identical to p0_busy.mjs)
            await page.waitFor(`(() => {
                const h = __mizu.hotspots.find(h => h.action === '${z.action}' && (h.index >= 0 || h.meshIndices));
                if (!h) return false;
                const b = computeHotspotBounds(h);
                if (!b) return false;
                const c = new PIXI.Point(b.x + b.w / 2, b.y + b.h / 2);
                __mizu.model.internalModel.localTransform.apply(c, c);
                __mizu.model.toGlobal(c, c);
                return c.y >= 0 && c.y < innerHeight;
            })()`, 5000).catch(() => {});
            const pt = await page.evaluate(`(() => {
                const h = __mizu.hotspots.find(h => h.action === '${z.action}' && (h.index >= 0 || h.meshIndices));
                if (!h) return null;
                const b = computeHotspotBounds(h);
                if (b) h.bounds = b;
                if (!h.bounds) return null;
                const c = new PIXI.Point(h.bounds.x + h.bounds.w / 2, h.bounds.y + h.bounds.h / 2);
                __mizu.model.internalModel.localTransform.apply(c, c);
                __mizu.model.toGlobal(c, c);
                return { x: Math.round(c.x), y: Math.round(c.y) };
            })()`);
            const clickX = pt?.x ?? z.x;
            const clickY = pt?.y ?? z.y;
            const expectedAction = await page.evaluate(`findHotspotAtPoint({ x: ${clickX}, y: ${clickY} })?.action`);
            await page.click(clickX, clickY);
            await new Promise(r => setTimeout(r, 300)); // 0.1 s fire delay + status refresh
            const st = await page.evaluate('window.mizu.status()');
            const parsed = JSON.parse(st);
            // Identity assertion (AC-1.1): sparse skins (gaoxiong_7) must match
            // the zone action exactly; dense skins allow legal coverage by a
            // winning overlapping zone (identical to p0_tips_off.mjs).
            const ok = (prefab === 'gaoxiong_7')
                ? (parsed.lastTap === z.action)
                : (parsed.lastTap === z.action || (parsed.lastTap != null && parsed.lastTap === expectedAction));
            out.push({ prefab, action: z.action, x: clickX, y: clickY, expectedAction, lastTap: parsed.lastTap, tips: parsed.tips, pass: ok });
        }
        await page.screenshot(shotPath).catch((e) => console.error('WARN: screenshot failed:', e.message));
        return out;
    });

    // 4. evidence: JSON lines + screenshot in the run's probe/ subdir.
    const resultPath = join(runDir, 'probe', 'result.json');
    writeFileSync(resultPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');
    for (const r of results) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'} zone ${r.action} @(${r.x},${r.y}) tips=${r.tips} lastTap=${r.lastTap}`);
    }
    const passCount = results.filter(r => r.pass).length;
    const pass = passCount === results.length;
    console.log(`\nEvidence: ${resultPath} ${shotPath}`);
    console.log(pass ? `PASS: ${passCount}/${results.length} zones fire with tips OFF (${prefab})`
                     : `FAIL: ${results.length - passCount} zone(s) dead with tips OFF (${prefab})`);
    process.exit(pass ? 0 : 1);
}

main().catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
