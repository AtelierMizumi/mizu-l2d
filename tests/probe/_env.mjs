// Probe environment helpers (PARITY-PLAN Task 1): starts scripts/serve.py on
// :8787, opens ?model=<prefab> in headless CDP, waits for the model, runs the
// probe, always tears down. CLI mode: node tests/probe/_env.mjs <prefab> <expr>
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch as launchCdp } from './cdp.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer(port = 8787) {
    const proc = spawn('python3', ['scripts/serve.py', String(port)], { cwd: REPO, stdio: 'ignore' });
    const t0 = Date.now();
    for (;;) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/index.html`);
            if (r.ok) return proc;
        } catch { /* not up yet */ }
        if (Date.now() - t0 > 10000) throw new Error('serve.py did not come up on :' + port);
        await new Promise(r => setTimeout(r, 200));
    }
}

// Runs `fn(page)` against a loaded model page and guarantees teardown.
export async function withPage(prefab, fn, { port = 8787 } = {}) {
    const server = await startServer(port);
    let page = null;
    try {
        page = await launchCdp({ url: `http://127.0.0.1:${port}/?model=${prefab}` });
        // model load can take a while on first fetch of many textures
        await page.waitFor('window.__mizu && window.__mizu.model !== null', 60000);
        return await fn(page);
    } finally {
        if (page) await page.close().catch(() => {});
        server.kill('SIGTERM');
    }
}

// CLI smoke mode: `node tests/probe/_env.mjs <prefab> <js-expression>`
if (import.meta.url === `file://${process.argv[1]}`) {
    const [prefab, expr = 'window.__mizu.model !== null'] = process.argv.slice(2);
    const result = await withPage(prefab, (page) => page.evaluate(expr));
    console.log(JSON.stringify(result));
    process.exit(0);
}
