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
            // mesh zones only; the isProp zone is a Gaoxiong-hardcoded menu
            // affordance (removed by Task 10), reachable via its badge today
            if (!h.bounds || h.index < 0 || h.isProp) continue;
            const b = h.bounds;
            const c = new PIXI.Point((b.x + b.x + b.w) / 2, (b.y + b.y + b.h) / 2);
            m.internalModel.localTransform.apply(c, c);
            m.toGlobal(c, c);
            out.push({ action: h.action, x: Math.round(c.x), y: Math.round(c.y) });
        }
        return out;
    })()`);
    await page.evaluate('window.mizu.tips(false)');
    return zones;
});
if (!targets.length) { console.error('FAIL: no mesh zones measured for ' + prefab); process.exit(1); }

// 2. fresh load, tips off (default state) -> click every recorded pixel
const results = await withPage(prefab, async (page) => {
    const out = [];
    for (const z of targets) {
        await page.click(z.x, z.y);
        await new Promise(r => setTimeout(r, 300)); // 0.1 s fire delay + status refresh
        const st = await page.evaluate('window.mizu.status()');
        const parsed = JSON.parse(st);
        out.push({ action: z.action, clicked: { x: z.x, y: z.y }, lastTap: parsed.lastTap, tips: parsed.tips });
    }
    return out;
});

let pass = true;
for (const r of results) {
    const ok = r.lastTap === r.action;
    if (!ok) pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'} zone ${r.action} @(${r.clicked.x},${r.clicked.y}) tips=${r.tips} lastTap=${r.lastTap}`);
}
console.log(pass ? `\nPASS: ${results.length}/${results.length} zones fire with tips OFF (${prefab})`
                 : `\nFAIL: tips-OFF clicks dead on ${prefab}`);
process.exit(pass ? 0 : 1);
