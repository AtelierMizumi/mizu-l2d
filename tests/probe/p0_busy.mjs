// P0-2 acceptance probe (PARITY-PLAN Task 4): clicks during a playing motion
// must be ignored (game-accurate), the running voice must not be stopped, and
// after the motion ends the next click fires normally. AC-2.1/2.2/2.4.
// Cooldown-from-data (AC-2.3) is pinned by engine unit tests (fake clocks) —
// live, the busy window always outlasts sub-second limitTime values.
// Run: node tests/probe/p0_busy.mjs [prefab=gaoxiong_7]
import { withPage } from './_env.mjs';

const prefab = process.argv[2] || 'gaoxiong_7';

const report = await withPage(prefab, async (page) => {
    // let the arrival (login) line finish: replacing it on first tap is
    // game-accurate, so the AC-2.2 assertion only covers interaction voices
    await page.waitFor('!__mizu.dialogue.playing', 25000).catch(() => {});
    // record every interaction action start + audio lifecycle
    await page.evaluate(`(() => {
        window.__busy = { fired: [], audioStarted: 0, audioPauses: 0 };
        const orig = StateManager.playAction.bind(StateManager);
        StateManager.playAction = function (a) {
            window.__busy.fired.push(a);
            return orig(a);
        };
        const p = HTMLAudioElement.prototype;
        const origPlay = p.play, origPause = p.pause;
        p.play = function () { window.__busy.audioStarted++; return origPlay.call(this); };
        // only a pause of an actively-playing clip cuts a voice; replacing a
        // finished login/chatter clip is game-accurate (stopAudio housekeeping)
        p.pause = function () { if (!this.ended && !this.paused) window.__busy.audioPauses++; return origPause.call(this); };
    })()`);
    // zone centers from live bounds (force one bounds pass, P0-1 makes the
    // hit-test itself independent of tips)
    await page.evaluate('window.mizu.tips(true)');
    await page.waitFor('__mizu.hotspots.some(h => h.bounds)', 10000);
    const zones = await page.evaluate(`__mizu.hotspots
        .filter(h => h.bounds && h.index >= 0 && h.action && (!h.zone || [2, 6].includes(h.zone.trigger.type)))
        .filter(h => !h.zone || __mizu.engine.canFire(h.zone)) // game-gated zones stay silent at rest
        .map(h => { const c = new PIXI.Point(h.bounds.x + h.bounds.w / 2, h.bounds.y + h.bounds.h / 2);
            __mizu.model.internalModel.localTransform.apply(c, c);
            __mizu.model.toGlobal(c, c);
            return { action: h.action, part: h.part, x: Math.round(c.x), y: Math.round(c.y),
                     onscreen: c.x >= 0 && c.y >= 0 && c.x < innerWidth && c.y < innerHeight }; })`)
        .then(list => list.filter(z => z.onscreen));
    const head = zones.find(z => z.action === 'touch_head') || zones[0];
    const other = zones.find(z => z.action !== head.action);
    if (!head || !other) throw new Error('need two distinct click-type zones on screen');

    await page.click(head.x, head.y);
    await new Promise(r => setTimeout(r, 200)); // inside the busy window
    const during = await page.evaluate('JSON.stringify(window.__busy)');
    // wait until BOTH the motion ended and the interaction voice window
    // (dialogue.busyUntil, AC-2.5 cap) has expired — the gate is busy while
    // either holds. StateManager is a top-level const in a classic script, so
    // it is NOT reachable as a window property; use mm.groups.idle.
    await page.waitFor(`(() => { const mm = __mizu.model.internalModel.motionManager;
        const idle = mm.state.currentGroup === undefined || mm.state.currentGroup === mm.groups.idle;
        return idle && performance.now() >= (__mizu.dialogue ? (__mizu.dialogue.busyUntil ?? 0) : 0); })()`, 40000);
    // the interaction may have moved the pose: re-measure the second zone
    // before the post-busy click
    const otherNow = await page.evaluate(`(() => {
        const h = __mizu.hotspots.find(h => h.action === '${other.action}' && h.index >= 0);
        if (!h) return null;
        // one lazy bounds pass via the same hit-test path a click would take
        if (!h.bounds) {
            const cm = __mizu.model.internalModel;
            const verts = cm.getDrawableVertices(h.index);
            if (!verts) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < verts.length; i += 2) {
                if (verts[i] < minX) minX = verts[i]; if (verts[i] > maxX) maxX = verts[i];
                if (verts[i + 1] < minY) minY = verts[i + 1]; if (verts[i + 1] > maxY) maxY = verts[i + 1];
            }
            h.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        const c = new PIXI.Point(h.bounds.x + h.bounds.w / 2, h.bounds.y + h.bounds.h / 2);
        __mizu.model.internalModel.localTransform.apply(c, c);
        __mizu.model.toGlobal(c, c);
        return { x: Math.round(c.x), y: Math.round(c.y) };
    })()`);
    if (otherNow) { other.x = otherNow.x; other.y = otherNow.y; }
    await page.click(other.x, other.y);
    await new Promise(r => setTimeout(r, 300));
    const after = await page.evaluate('JSON.stringify(window.__busy)');
    return { during: JSON.parse(during), after: JSON.parse(after), head: head.action, other: other.action };
});

const { during, after } = report;
let pass = true;
const check = (ok, label) => { if (!ok) pass = false; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
check(during.fired.length === 1, `exactly one action started during the busy window (got ${during.fired.length})`);
if (during.audioStarted > 0) check(during.audioPauses === 0, `running voice never paused during the window (got ${during.audioPauses} pauses)`);
else console.log('SKIP voice pause check (no audio started in headless run)');
check(after.fired.includes(report.other), `post-busy click on ${report.other} fired`);
console.log(pass ? `\nPASS busy-gate semantics on ${prefab}` : `\nFAIL busy-gate semantics on ${prefab}`);
process.exit(pass ? 0 : 1);
