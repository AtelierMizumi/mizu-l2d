// P0-1 acceptance probe (PARITY-PLAN Task 2): with the tips overlay OFF,
// clicking the same pixels that hit a zone with tips ON must fire the zone's
// action. AC-1.1 / AC-1.2 / AC-1.3 of docs/PARITY-SPEC.md.
// Run: node tests/probe/p0_tips_off.mjs [prefab=gaoxiong_7]
import { withPage } from './_env.mjs';

const prefab = process.argv[2] || 'gaoxiong_7';

// 1. measure zone centers in canvas px (tips ON forces bounds computation),
//    then switch tips back off and reload so clicks land with tips OFF.
const targets = await withPage(prefab, async (page) => {
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

// 2. fresh load, tips off (default state) -> click every recorded pixel.
//    Between clicks, wait for the busy gate to release (P0-2: a playing
//    animation+voice correctly swallows further triggers).
const results = await withPage(prefab, async (page) => {
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
        out.push({ action: z.action, expectedAction, clicked: { x: clickX, y: clickY }, lastTap: parsed.lastTap, tips: parsed.tips });
    }
    return out;
});

let pass = true;
for (const r of results) {
    // Identity assertion (AC-1.1): sparse skins (gaoxiong_7) must match the zone
    // action exactly; dense skins allow legal coverage by a winning overlapping zone
    const ok = (prefab === 'gaoxiong_7')
        ? (r.lastTap === r.action)
        : (r.lastTap === r.action || (r.lastTap != null && r.lastTap === r.expectedAction));
    if (!ok) pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'} zone ${r.action} @(${r.clicked.x},${r.clicked.y}) tips=${r.tips} lastTap=${r.lastTap}`);
}
console.log(pass ? `\nPASS: ${results.length}/${results.length} zones fire with tips OFF (${prefab})`
                 : `\nFAIL: tips-OFF clicks dead on ${prefab}`);
process.exit(pass ? 0 : 1);
