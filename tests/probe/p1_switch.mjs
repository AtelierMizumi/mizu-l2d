// Model-switch probe (PARITY-PLAN Review Focus 5, Task 10): verifies that
// switching models resets all engine state, leaves no cross-model leaks
// (phantom camera restore, stale snapshot, old zones), and cleanly initializes
// the new model's interaction engine.
// Run: node tests/probe/p1_switch.mjs
import { withPage } from './_env.mjs';

const res = await withPage('gaoxiong_7', async (page) => {
    // 1. Fire an action on gaoxiong_7 to dirty state
    const st0 = JSON.parse(await page.evaluate('window.mizu.status()'));
    const initialZones = st0.engineZones;

    // Click head zone to start a motion and dirty camera/engine
    await page.click(622, 212);
    await new Promise(r => setTimeout(r, 400));

    // 2. Switch model to benningdun_2 midway
    await page.evaluate("window.mizu.model('benningdun_2')");

    // Wait for the new model to load
    await page.waitFor("(() => { try { const s = JSON.parse(window.mizu.status()); return s.prefab === 'benningdun_2' && window.__mizu && window.__mizu.model !== null; } catch { return false; } })()", 40000);

    // 3. Inspect cross-model state on the new model
    const check = await page.evaluate(`(() => {
        const st = JSON.parse(window.mizu.status());
        return {
            prefab: st.prefab,
            engineZones: st.engineZones,
            engineTotal: window.__mizu.engine ? window.__mizu.engine.total : 0,
            state: st.engine ? st.engine.state : null,
            paramSnapshot: window.__mizu.paramSnapshot,
            lastTap: st.lastTap,
        };
    })()`);

    return { initialZones, check };
});

let pass = true;
if (res.check.prefab !== 'benningdun_2') {
    pass = false;
    console.log(`FAIL: expected model benningdun_2, got ${res.check.prefab}`);
}
if (res.check.engineTotal !== 70) {
    pass = false;
    console.log(`FAIL: expected 70 total engine zones for benningdun_2, got ${res.check.engineTotal}`);
}
if (res.check.state !== 0) {
    pass = false;
    console.log(`FAIL: expected state 0, got ${res.check.state}`);
}
if (res.check.paramSnapshot !== null && Object.keys(res.check.paramSnapshot).length > 0) {
    pass = false;
    console.log(`FAIL: expected clean paramSnapshot after switch, got`, res.check.paramSnapshot);
}

if (pass) {
    console.log(`PASS: model switch gaoxiong_7 -> benningdun_2 cleanly resets engine state`);
}
process.exit(pass ? 0 : 1);
