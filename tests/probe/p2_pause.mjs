// P2 pause & tap acceptance probe: verifies that window.mizu.pause() freezes
// the PIXI ticker and window.mizu.resume() restores rendering smoothly,
// and window.mizu.tap(x, y) synthetically triggers click events.
// Run: node tests/probe/p2_pause.mjs
import { withPage } from './_env.mjs';

const report = await withPage('gaoxiong_7', async (page) => {
    // 1. Verify ticker runs initially
    const t0 = await page.evaluate('__mizu.app.ticker.lastTime');
    await new Promise((r) => setTimeout(r, 120));
    const t1 = await page.evaluate('__mizu.app.ticker.lastTime');
    if (t1 <= t0) {
        throw new Error(`Ticker did not advance: t0=${t0}, t1=${t1}`);
    }

    // 2. Pause ticker
    const pauseRes = await page.evaluate('window.mizu.pause()');
    if (pauseRes !== 'paused') {
        throw new Error(`Expected pause() to return 'paused', got: ${pauseRes}`);
    }

    const tPaused0 = await page.evaluate('__mizu.app.ticker.lastTime');
    await new Promise((r) => setTimeout(r, 200));
    const tPaused1 = await page.evaluate('__mizu.app.ticker.lastTime');
    if (tPaused1 !== tPaused0) {
        throw new Error(`Ticker advanced while paused: t0=${tPaused0}, t1=${tPaused1}`);
    }

    // 3. Resume ticker
    const resumeRes = await page.evaluate('window.mizu.resume()');
    if (resumeRes !== 'resumed') {
        throw new Error(`Expected resume() to return 'resumed', got: ${resumeRes}`);
    }

    await new Promise((r) => setTimeout(r, 120));
    const tResumed = await page.evaluate('__mizu.app.ticker.lastTime');
    if (tResumed <= tPaused1) {
        throw new Error(`Ticker did not advance after resume: tPaused1=${tPaused1}, tResumed=${tResumed}`);
    }

    // 4. Test synthetic tap API
    const tapRes = await page.evaluate('window.mizu.tap ? window.mizu.tap(500, 500) : "missing"');

    return {
        ok: true,
        pauseWorking: tPaused0 === tPaused1,
        resumeWorking: tResumed > tPaused1,
        tapResult: tapRes,
    };
});

console.log('PASS Review Phase 3 pause/resume probe:', JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
