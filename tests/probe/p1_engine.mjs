// P1-5 acceptance probe (PARITY-PLAN Task 10): the drags engine registers a
// zone per skins.json entry, the Azuchi elevator panel is clickable in-world,
// and pose switches follow the game. AC-5.1/5.2/5.3/5.7/5.8.
// Run: node tests/probe/p1_engine.mjs [case=all|antu2|counts|fallback|grep]
import { withPage } from './_env.mjs';

const IDLE_EXPR = `(() => { const mm = __mizu.model.internalModel.motionManager;
    return (mm.state.currentGroup === undefined || mm.state.currentGroup === mm.groups.idle)
        && performance.now() >= (__mizu.dialogue ? (__mizu.dialogue.busyUntil ?? 0) : 0); })()`;

function case_(name, fn) { return { name, fn }; }

const CASES = [
    case_('antu2-elevator (AC-5.1)', async () => {
        const r = await withPage('antu_2', async (page) => {
            await page.waitFor('!!window.__mizu.engine', 20000);
            const count = await page.evaluate('__mizu.engine.zones.length');
            await page.evaluate('window.mizu.tips(true)');
            await page.waitFor('__mizu.hotspots.some(h => h.bounds)', 10000);
            await page.evaluate('window.mizu.tips(false)');
            // floor-panel zone: part TouchIdle1 per nagami ground truth
            const zoneInfo = await page.evaluate(`(() => {
                const z = __mizu.engine.zones.find(z => z.part === 'TouchIdle1');
                if (!z) return null;
                const h = __mizu.hotspots.find(h => h.zone === z);
                if (!h || !h.bounds) return null;
                const c = new PIXI.Point(h.bounds.x + h.bounds.w/2, h.bounds.y + h.bounds.h/2);
                __mizu.model.internalModel.localTransform.apply(c, c);
                __mizu.model.toGlobal(c, c);
                return { x: Math.round(c.x), y: Math.round(c.y), action: z.action, idle: z.idle };
            })()`);
            if (!zoneInfo) return { count, error: 'TouchIdle1 zone not registered or not hittable' };
            await page.click(zoneInfo.x, zoneInfo.y);
            await new Promise(rr => setTimeout(rr, 400));
            const during = await page.evaluate('__mizu.engine.lastAction');
            await page.waitFor(IDLE_EXPR, 45000);
            const stateAfter = await page.evaluate('__mizu.engine.state()');
            return { count, zoneInfo, during, stateAfter };
        });
        const ok = r.count === 65 && r.zoneInfo && r.during === 'touch_idle1'
            && (r.zoneInfo.idle == null || r.stateAfter.state === r.zoneInfo.idle);
        return { ok, detail: r };
    }),
    case_('zone counts (AC-5.2/5.3)', async () => {
        // nagami parity: M (their counter) = drags.length — hit zones plus
        // param-only entries (one `part: ""` entry per such skin)
        const counts = {};
        for (const [prefab, expected] of [['benningdun_2', 70], ['wuqi_3', 33]]) {
            counts[prefab] = await withPage(prefab, async (page) => {
                await page.waitFor('!!window.__mizu.engine', 20000);
                return page.evaluate(`(() => ({
                    zones: __mizu.engine.zones.length,
                    paramOnly: __mizu.engine.paramOnly,
                    total: __mizu.engine.total,
                }))()`);
            });
        }
        const ok = counts.benningdun_2.zones + counts.benningdun_2.paramOnly === 70
            && counts.wuqi_3.zones + counts.wuqi_3.paramOnly === 33
            && counts.benningdun_2.total === 70 && counts.wuqi_3.total === 33;
        return { ok, detail: counts };
    }),
    case_('no-drag fallback (AC-5.7)', async () => {
        const detail = await withPage('lisailiu_3', async (page) => {
            await page.waitFor('!!window.__mizu.engine', 20000);
            return page.evaluate(`(() => ({
                zones: __mizu.engine.zones.length,
                fallback: __mizu.engine.fallbackUsed,
                hotspotZones: __mizu.hotspots.filter(h => h.index >= 0).length,
                actions: __mizu.hotspots.filter(h => h.index >= 0).map(h => h.action),
            }))()`);
        });
        const ok = detail.fallback === true && detail.hotspotZones >= 1;
        return { ok, detail };
    }),
];

const which = process.argv[2] || 'all';
let pass = true;
for (const c of CASES) {
    if (which !== 'all' && !c.name.startsWith(which)) continue;
    try {
        const { ok, detail } = await c.fn();
        if (!ok) pass = false;
        console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: ${JSON.stringify(detail).slice(0, 400)}`);
    } catch (e) {
        pass = false;
        console.log(`FAIL ${c.name}: ${e.message}`);
    }
}
if (which === 'all' || which === 'grep') {
    const { execSync } = await import('node:child_process');
    let grepOk = true;
    try {
        const hits = execSync(
            `grep -nE 'gaoxiong_7|manjuu|179\\b|Touch_drag(19|20|21)\\b|Param60' web/main.js || true`,
            { cwd: process.cwd() }).toString().trim();
        // comments describing history and URL fallback are fine; engine paths must not branch on them
        const codeHits = hits.split('\n').filter((l) => l && !/^\s*\d+:\s*\/\//.test(l) && !/\* /.test(l) && !/get\('model'\)/.test(l));
        grepOk = codeHits.length === 0;
        console.log(`${grepOk ? 'PASS' : 'FAIL'} hardcode grep gate (AC-5.8)${grepOk ? '' : ':\n' + codeHits.join('\n')}`);
    } catch (e) { grepOk = false; console.log('FAIL grep gate: ' + e.message); }
    pass = pass && grepOk;
}
console.log(pass ? '\nPASS p1_engine' : '\nFAIL p1_engine');
process.exit(pass ? 0 : 1);
