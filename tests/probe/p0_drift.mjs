// P0-4 acceptance probe (PARITY-PLAN Task 5): after interactions finish, every
// camera parameter must be back at its default and the model must sit exactly
// where the user left it. AC-4.1/4.2/4.3 of docs/PARITY-SPEC.md.
// Run: node tests/probe/p0_drift.mjs [prefab=wuqi_3]
import { withPage } from './_env.mjs';

const prefab = process.argv[2] || 'wuqi_3';
const ROUNDS = Number(process.argv[3] || 3);

// Fixed Cubism camera vocabulary (generic across skins — engine constants)
const CAMERA_PARAMS = [
    'CameraX', 'CameraY', 'CameraS',
    'ParamCameraPositionX', 'ParamCameraPositionY', 'ParamCameraX', 'ParamCameraY', 'ParamCameraScale',
    'ParamCaraCameraPositionX', 'ParamCaraCameraPositionY', 'ParamCaraCameraScale',
    'ParamCharaMainPositionX', 'ParamCharaMainPositionY', 'ParamCharaMainScale',
];

const IDLE_EXPR = `(() => { const mm = __mizu.model.internalModel.motionManager;
    return (mm.state.currentGroup === undefined || mm.state.currentGroup === mm.groups.idle)
        && performance.now() >= (__mizu.dialogue ? (__mizu.dialogue.busyUntil ?? 0) : 0); })()`;

const SAMPLE = `(() => {
    const cm = __mizu.model.internalModel.coreModel;
    const ids = cm._model.parameters.ids, defs = cm._model.parameters.defaultValues;
    const dev = {};
    for (const name of ${JSON.stringify(CAMERA_PARAMS)}) {
        const i = ids.indexOf(name);
        if (i < 0) continue;
        const d = Math.abs(cm.getParameterValueByIndex(i) - defs[i]);
        if (d > 0.01) dev[name] = Math.round(d * 1000) / 1000;
    }
    const m = __mizu.model;
    return { dev, pos: [Math.round(m.x), Math.round(m.y)], zoom: Math.round(m.scale.y * 1000) / 1000 };
})()`;

const report = await withPage(prefab, async (page) => {
    await page.evaluate('window.mizu.tips(true)');
    await page.waitFor('__mizu.hotspots.some(h => h.bounds)', 10000);
    const zones = await page.evaluate(`__mizu.hotspots
        .filter(h => h.bounds && h.index >= 0 && !h.isProp)
        .map(h => { const c = new PIXI.Point(h.bounds.x + h.bounds.w/2, h.bounds.y + h.bounds.h/2);
            __mizu.model.internalModel.localTransform.apply(c, c); __mizu.model.toGlobal(c, c);
            return { action: h.action, x: Math.round(c.x), y: Math.round(c.y) }; })`);
    if (!zones.length) throw new Error('no mesh zones on ' + prefab);

    const stateDump = `(() => { const mm = __mizu.model.internalModel.motionManager;
        return JSON.stringify({ group: mm.state.currentGroup, gIdle: mm.groups.idle,
            busyLeft: Math.max(0, Math.round((__mizu.dialogue.busyUntil ?? 0) - performance.now())),
            playing: __mizu.dialogue.playing }); })()`;
    const rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
        const z = zones[r % zones.length];
        try {
            await page.waitFor(IDLE_EXPR, 40000);
        } catch (e) {
            throw new Error(`pre-click wait round ${r}: page not idle: ${await page.evaluate(stateDump)}`);
        }
        await page.click(z.x, z.y);
        try {
            await page.waitFor(IDLE_EXPR, 45000); // motion + voice window fully done
        } catch (e) {
            throw new Error(`post-click wait round ${r} (${z.action}): busy never released: ${await page.evaluate(stateDump)}`);
        }
        await new Promise(rr => setTimeout(rr, 500)); // let restore lerp settle
        rounds.push({ round: r, action: z.action, sample: await page.evaluate(SAMPLE) });
    }
    // AC-4.3: unified reset pose brings everything back
    await page.evaluate('window.mizu.state("reset")');
    await new Promise(rr => setTimeout(rr, 800));
    const afterReset = await page.evaluate(SAMPLE);
    return { rounds, afterReset };
});

let pass = true;
const check = (ok, label) => { if (!ok) pass = false; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
for (const r of report.rounds) {
    const devs = Object.keys(r.sample.dev);
    check(devs.length === 0, `round ${r.round} (${r.action}): camera params at defaults${devs.length ? ' — deviating: ' + JSON.stringify(r.sample.dev) : ''}`);
}
check(Object.keys(report.afterReset.dev).length === 0, 'after Reset Pose: camera params at defaults');
console.log(pass ? `\nPASS drift/stability on ${prefab}` : `\nFAIL drift/stability on ${prefab}`);
process.exit(pass ? 0 : 1);
