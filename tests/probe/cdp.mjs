// Zero-dependency CDP client for interaction probes (PARITY-PLAN Task 1).
// Drives a Chromium-family browser in headless mode over the DevTools
// websocket (Node >= 22 stable WebSocket). Used by tests/probe/run-all.mjs.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

export async function launch({ url, width = 1280, height = 800 } = {}) {
    const bin = findBrowser();
    const profile = mkdtempSync(join(tmpdir(), 'mizu-cdp-'));
    const proc = spawn(bin, [
        '--headless=new',
        '--remote-debugging-port=0',
        '--no-first-run', '--no-default-browser-check',
        '--disable-crash-reporter', '--disable-brave-update',
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
    const sessions = new Map(); // targetId -> sessionId
    let pageSession = null;
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

    async function attachTo(targetId) {
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        sessions.set(targetId, sessionId);
        return sessionId;
    }

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    pageSession = await attachTo(targetId);
    await send('Page.enable', {}, pageSession);
    await send('Runtime.enable', {}, pageSession);
    await send('Page.navigate', { url }, pageSession);
    await new Promise(r => setTimeout(r, 300));

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
        // Synthetic press-drag-release through `path` (viewport px).
        async drag(path, durationMs = 700) {
            const [sx, sy] = path[0];
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, pointerType: 'mouse' }, pageSession);
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1, pointerType: 'mouse' }, pageSession);
            const steps = Math.max(2, path.length - 1);
            for (let i = 1; i < path.length; i++) {
                await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: path[i][0], y: path[i][1], button: 'left', pointerType: 'mouse' }, pageSession);
                await sleep(durationMs / steps);
            }
            const [ex, ey] = path[path.length - 1];
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1, pointerType: 'mouse' }, pageSession);
        },
        async screenshot(path) {
            const { data } = await send('Page.captureScreenshot', { format: 'png' }, pageSession);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, Buffer.from(data, 'base64'));
            return path;
        },
        consoleLogs: () => [...consoleLogs],
        async close() {
            try { await send('Browser.close'); } catch { /* socket may drop first */ }
            ws.close();
            proc.kill('SIGKILL');
        },
    };
    return page;
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// tiny dirname shim (avoid importing node:path twice in call sites)
function dirname(p) { return p.slice(0, Math.max(p.lastIndexOf('/'), 0)) || '.'; }
