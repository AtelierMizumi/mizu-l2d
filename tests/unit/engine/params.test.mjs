// Unit tests for web/engine/params.js (PARITY-PLAN Task 8): parameter drag
// writer, relations 101-104 and listener bands/change. Loads the dual-env
// module with a window stub; fake core (Map-backed) + injectable clock; zones
// are real drags[] entries from fixtures/real-samples.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../../../web/engine/params.js', import.meta.url), 'utf8'));
const { createParamEngine } = globalThis.window.MizuEngine;

const FX = JSON.parse(readFileSync(new URL('./fixtures/real-samples.json', import.meta.url), 'utf8'));

function entryOf(type, i = 0) {
    return JSON.parse(JSON.stringify(FX.by_trigger_type[String(type)][i].entry));
}

function fakeCore(defaults = {}) {
    const values = new Map(Object.entries(defaults));
    const writes = [];
    const opacity = [];
    return {
        writes,
        opacity,
        getParam: (n) => (values.has(n) ? values.get(n) : undefined),
        setParam: (n, v) => { writes.push([n, v]); values.set(n, v); },
        defaultValue: (n) => (Object.prototype.hasOwnProperty.call(defaults, n) ? defaults[n] : undefined),
        setPartOpacity: (n, v) => { opacity.push([n, v]); },
    };
}

function fakeCtx() {
    return {
        t: 0,
        now() { return this.t; },
        idleCalls: [],
        setIdleByIndex(n) { this.idleCalls.push(n); },
        actionStep: -1,
        actionIndex() { return this.actionStep; },
        listenerChanges: [],
        onListenerChange(e) { this.listenerChanges.push(e); },
    };
}

function run(eng, n, dt = 16) {
    for (let i = 0; i < n; i++) eng.tick(dt);
}

// 1. drag to max of range with smooth converges to the clamped max
test('drag to max of range converges to the clamped max (smooth)', () => {
    const zone = entryOf('1', 1); // banerwei_3: param touch_drag1, rangeAbs [0,1], smooth 0.1, dragDirect 1
    const core = fakeCore({ touch_drag1: 0 });
    const ctx = fakeCtx();
    const eng = createParamEngine({ zones: [zone], core, ctx });
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 500, 0, 16);
    assert.equal(eng.activeCount(), 1);
    run(eng, 120);
    assert.ok(Math.abs(core.getParam('touch_drag1') - 1) < 1e-6,
        'converged to max, got ' + core.getParam('touch_drag1'));
});

// 2. release with revert: 0 eases back via revertSmooth; revert: -1 stays;
//    revertSmooth 0 snaps straight to the revert target
test('release with revert 0 eases back via revertSmooth; revert -1 never reverts', () => {
    const rev0 = { ...entryOf('1', 1), revert: 0 }; // banerwei_3 shape, revertSmooth 0.1
    const noRev = entryOf('6', 0); // feiteliedadi_4: revert -1, rangeAbs [0,2]
    const snapRev = entryOf('3', 0); // xinzexi_3: revert 0.15, revertSmooth 0.0

    const core = fakeCore({ touch_drag1: 0, touch_drag40: 0, touch_drag3: 0 });
    const eng0 = createParamEngine({ zones: [rev0], core, ctx: fakeCtx() });
    eng0.onDragStart(rev0, 0, 0);
    eng0.onDragMove(rev0, 500, 0, 16);
    run(eng0, 120);
    eng0.onDragEnd(rev0);
    eng0.tick(16); // one revert step at smooth 0.1: v = 1 - (1-0)*min(1, 0.016/0.1)
    const mid = core.getParam('touch_drag1');
    assert.ok(mid > 0 && mid < 1, 'mid-revert value between 0 and 1, got ' + mid);
    run(eng0, 400);
    assert.ok(Math.abs(core.getParam('touch_drag1')) < 1e-6,
        'eased back to 0, got ' + core.getParam('touch_drag1'));

    const engN = createParamEngine({ zones: [noRev], core, ctx: fakeCtx() });
    engN.onDragStart(noRev, 0, 0);
    engN.onDragMove(noRev, 300, 0, 16);
    run(engN, 120);
    engN.onDragEnd(noRev);
    run(engN, 400);
    assert.ok(Math.abs(core.getParam('touch_drag40') - 2) < 1e-6,
        'revert -1 keeps the dragged value, got ' + core.getParam('touch_drag40'));

    const engS = createParamEngine({ zones: [snapRev], core, ctx: fakeCtx() });
    engS.onDragStart(snapRev, 0, 0);
    engS.onDragMove(snapRev, 500, 0, 16); // non-abs range [0,1]: 500px / span 100 -> clamps to 1
    run(engS, 120);
    engS.onDragEnd(snapRev);
    engS.tick(16); // revertSmooth 0 -> snap to revert target in one tick
    assert.ok(Math.abs(core.getParam('touch_drag3') - 0.15) < 1e-9,
        'revertSmooth 0 snaps to revert target, got ' + core.getParam('touch_drag3'));
});

// 3. rangeAbs absolute units: px delta lands in absolute param units, clamped at range
test('rangeAbs clamps at absolute range values, not normalized ones', () => {
    const zone = entryOf('2', 0); // weizhang_3 TouchDrag1: param touch_drag1, range [0,10] rangeAbs, smooth 0.7
    const core = fakeCore({ touch_drag1: 0 });
    const eng = createParamEngine({ zones: [zone], core, ctx: fakeCtx() });
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 3, 0, 16); // 3 px -> absolute 3 (normalized-with-span would give 0.03)
    run(eng, 800);
    assert.ok(Math.abs(core.getParam('touch_drag1') - 3) < 1e-6,
        'absolute units honored, got ' + core.getParam('touch_drag1'));
    eng.onDragMove(zone, 50, 0, 16); // 50 px -> clamped at absolute 10
    run(eng, 800);
    assert.ok(Math.abs(core.getParam('touch_drag1') - 10) < 1e-6,
        'clamped at absolute max 10, got ' + core.getParam('touch_drag1'));
});

// 4. relation 103 writes values[step] for the current actionList step
test('relation 103 writes values[actionIndex] and the writer syncs to it', () => {
    const zone = entryOf('6', 0); // feiteliedadi_4: relation {name touch_drag40, type 103, values [0,1,2]}
    const core = fakeCore({ touch_drag40: 0 });
    const ctx = fakeCtx();
    const eng = createParamEngine({ zones: [zone], core, ctx });
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 100, 0, 16); // zone engaged (dragging)
    ctx.actionStep = 1;
    eng.applyRelations(ctx.now());
    assert.equal(core.getParam('touch_drag40'), 1);
    ctx.actionStep = 2;
    eng.applyRelations(ctx.now());
    assert.equal(core.getParam('touch_drag40'), 2);
    ctx.actionStep = 5; // past the end of values -> clamp to the last entry
    eng.applyRelations(ctx.now());
    assert.equal(core.getParam('touch_drag40'), 2);
    ctx.actionStep = -1; // no actionList step -> no write
    const before = core.getParam('touch_drag40');
    eng.applyRelations(ctx.now());
    assert.equal(core.getParam('touch_drag40'), before);
    ctx.actionStep = 1; // writer must not ease the param away from the relation value
    eng.applyRelations(ctx.now());
    run(eng, 50);
    assert.equal(core.getParam('touch_drag40'), 1);
});

// 5. listener band [-1,0,8] fires setIdleByIndex(8) exactly once on entering
test('listener band [-1,0,8] calls setIdleByIndex(8) once per crossing', () => {
    const zone = entryOf('15', 0); // suweiaitongmeng_3 a1: range [-1,1], smooth 0.1, revert -1
    zone.listener = { ...zone.listener, apply: { bands: [[-1, 0, 8]] } }; // bands shape from spec/plan contract
    const core = fakeCore({ a1: 0 });
    const ctx = fakeCtx();
    const eng = createParamEngine({ zones: [zone], core, ctx });
    eng.tick(16); // baseline: param 0 already sits inside [-1,0] -> loading must not fire
    assert.deepEqual(ctx.idleCalls, []);
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 500, 0, 16); // non-abs: 500/100 -> target clamps to 1 (outside band)
    run(eng, 400);
    eng.onDragEnd(zone);
    assert.deepEqual(ctx.idleCalls, []);
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, -500, 0, 16); // target -1: eases down through 0 into the band
    run(eng, 400);
    eng.onDragEnd(zone);
    run(eng, 50);
    assert.deepEqual(ctx.idleCalls, [8]); // exactly one crossing call
    assert.deepEqual(ctx.listenerChanges, [zone.listener.change[0]]); // mode-2 change fired once too
});

// 6. unknown param name is a no-op that never throws
test('unknown param name is a no-throw no-op', () => {
    const zone = entryOf('1', 1); // param touch_drag1, but core does not know it
    const core = fakeCore({});
    const ctx = fakeCtx();
    const eng = createParamEngine({ zones: [zone], core, ctx });
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 500, 0, 16);
    eng.onDragEnd(zone);
    run(eng, 50);
    eng.applyRelations(ctx.now());
    assert.deepEqual(core.writes, []);
    assert.equal(eng.activeCount(), 0);
});

// extra pins ---------------------------------------------------------------

test('applyVisibility toggles removeComList part opacity', () => {
    const zone = entryOf('5', 0); // ailunsamuna_3 type 5: removeComList [touch_idle1, touch_idle2]
    const core = fakeCore({});
    const eng = createParamEngine({ zones: [zone], core, ctx: fakeCtx() });
    eng.applyVisibility(zone, true);
    assert.deepEqual(core.opacity, [['touch_idle1', 0], ['touch_idle2', 0]]);
    eng.applyVisibility(zone, false);
    assert.deepEqual(core.opacity.slice(2), [['touch_idle1', 1], ['touch_idle2', 1]]);
    assert.doesNotThrow(() => eng.applyVisibility({ trigger: {} }, true)); // no removeComList -> no-op
});

test('listener change entries: mode 1 fires rising past value, mode 2 falling to value', () => {
    const zone = entryOf('7', 0); // jinshi_2 touch_drag7: change [mode1@1 x2, mode2@0]
    const core = fakeCore({ touch_drag7: 0 });
    const ctx = fakeCtx();
    const eng = createParamEngine({ zones: [zone], core, ctx });
    eng.tick(16);
    assert.deepEqual(ctx.listenerChanges, []);
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 500, 0, 16); // non-abs [0,2]: target clamps to 2
    run(eng, 1000); // smooth 0.8 -> slow rise through 1
    assert.deepEqual(ctx.listenerChanges.map((e) => e.keys), [['touch_idle8'], ['touch_idle9']]);
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, -500, 0, 16); // target clamps to 0
    run(eng, 1000);
    assert.deepEqual(ctx.listenerChanges.map((e) => e.keys),
        [['touch_idle8'], ['touch_idle9'], ['touch_idle22']]);
});

test('revertActionIndex pauses the revert while the action step differs', () => {
    const zone = { ...entryOf('3', 1), revertActionIndex: true, revert: 0.1, revertSmooth: 0.5 };
    const core = fakeCore({ touch_drag1: 0 });
    const ctx = fakeCtx();
    const eng = createParamEngine({ zones: [zone], core, ctx });
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 500, 0, 16);
    run(eng, 400); // settled at 1
    ctx.actionStep = 3;
    eng.onDragEnd(zone); // gate step recorded as 3
    run(eng, 5);
    const mid = core.getParam('touch_drag1');
    assert.ok(mid > 0.1 && mid < 1, 'mid-revert value, got ' + mid);
    ctx.actionStep = -1; // differs from the recorded step -> revert paused
    run(eng, 100);
    assert.equal(core.getParam('touch_drag1'), mid);
    ctx.actionStep = 3; // matches again -> revert resumes
    run(eng, 800);
    assert.ok(Math.abs(core.getParam('touch_drag1') - 0.1) < 1e-5,
        'revert completed, got ' + core.getParam('touch_drag1'));
});

test('snap with snapMode 2 snaps the drag target to the nearest detent', () => {
    const zone = entryOf('8', 0); // wuzang_3: snap [0,0.21,0.41,0.61,0.81,1], snapMode 2, rangeAbs [0,1]
    const core = fakeCore({ touch_drag1: 0 });
    const eng = createParamEngine({ zones: [zone], core, ctx: fakeCtx() });
    eng.onDragStart(zone, 0, 0);
    eng.onDragMove(zone, 0.45, 0, 16); // raw 0.45 -> nearest detent 0.41
    run(eng, 400);
    assert.ok(Math.abs(core.getParam('touch_drag1') - 0.41) < 1e-6,
        'snapped to 0.41, got ' + core.getParam('touch_drag1'));
    eng.onDragMove(zone, 0.55, 0, 16); // raw 0.55 -> nearest detent 0.61
    run(eng, 400);
    assert.ok(Math.abs(core.getParam('touch_drag1') - 0.61) < 1e-6,
        're-snapped to 0.61, got ' + core.getParam('touch_drag1'));
});
