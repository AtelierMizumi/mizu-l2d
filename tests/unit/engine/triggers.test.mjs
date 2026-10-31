// Unit tests for web/engine/triggers.js (PARITY-PLAN Task 7): pointer
// recognition + busy/cooldown policy over zones built by web/engine/zones.js.
// Zone fixtures are cloned from real skin samples (fixtures/real-samples.json);
// the clock is injected (mutable nowMs) — the engine itself uses no timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../../../web/engine/zones.js', import.meta.url), 'utf8'));
vm.runInThisContext(readFileSync(new URL('../../../web/engine/triggers.js', import.meta.url), 'utf8'));
const { buildZones, createTriggerEngine } = globalThis.window.MizuEngine;

const FX = JSON.parse(readFileSync(new URL('./fixtures/real-samples.json', import.meta.url), 'utf8'));

const BASE_DRAWABLES = ['TouchHead', 'TouchBody', 'TouchSpecial', 'TouchIdle1', 'TouchDrag1'];

// Build engine zones from real fixture entries: [{ type, sample = 0, patch }].
// patch may re-point part / extend trigger fields; every extension is called
// out in the task report with its fixture evidence.
function zonesFromSamples(specs) {
    const entries = specs.map(({ type, sample = 0, patch }) => {
        const bank = FX.by_trigger_type[String(type)];
        if (!bank || !bank[sample]) throw new Error('no fixture sample for trigger type ' + type);
        const e = JSON.parse(JSON.stringify(bank[sample].entry));
        if (patch) patch(e);
        return e;
    });
    const drawableIds = [...new Set([...BASE_DRAWABLES, ...entries.map(e => e.part).filter(Boolean)])];
    const { zones, paramListeners } = buildZones({ skins: { drags: entries }, drawableIds });
    return zones.concat(paramListeners); // part-less rules (type 12) live in paramListeners
}

function env(zoneSpecs) {
    const state = { nowMs: 0, playing: false, params: {} };
    const fired = [];
    const ctx = {
        paramValue: (n) => (typeof n === 'string' && n in state.params) ? state.params[n] : 0,
        isMotionPlaying: () => state.playing,
        canFire: () => true,
        now: () => state.nowMs,
        fire: (zone, action) => fired.push({
            zoneId: zone.id,
            action: action === undefined ? null : action,
            t: state.nowMs,
        }),
    };
    const zones = zonesFromSamples(zoneSpecs);
    const engine = createTriggerEngine({ zones, ctx });
    return { engine, zones, fired, state };
}

const down = (x, y) => ({ type: 'down', x, y });
const move = (x, y) => ({ type: 'move', x, y });
const up = (x, y) => ({ type: 'up', x, y });

test('type-2 click fires 0.1 s after the down via tick; a 700 ms slow release does not fire', () => {
    // held past the 0.1 s fire delay — fires without waiting for the release
    {
        const { engine, zones, fired, state } = env([{ type: 2, sample: 0 }]); // weizhang_3 TouchDrag1
        const z = zones.find(z => z.trigger.type === 2);
        engine.onEvent(down(100, 100), z); // t = 0
        state.nowMs = 50;
        engine.tick(50);
        assert.equal(fired.length, 0); // not due yet
        state.nowMs = 100;
        engine.tick(100);
        assert.deepEqual(fired, [{ zoneId: z.id, action: 'touch_drag1', t: 100 }]);
    }
    // released after 0.5 s — outside the click window, the pending fire is cancelled
    {
        const { engine, zones, fired, state } = env([{ type: 2, sample: 0 }]);
        const z = zones.find(z => z.trigger.type === 2);
        engine.onEvent(down(100, 100), z); // t = 0
        state.nowMs = 700;
        engine.onEvent(up(100, 100), z); // same spot, but 700 ms > 0.5 s
        state.nowMs = 800;
        engine.tick(800);
        assert.equal(fired.length, 0);
    }
});

test('re-click inside the limitTime cooldown is swallowed; after it elapses the zone fires again', () => {
    const { engine, zones, fired, state } = env([{ type: 2, sample: 0 }]); // weizhang_3: limitTime 1 s
    const z = zones.find(z => z.trigger.type === 2);
    engine.onEvent(down(0, 0), z); // t = 0
    state.nowMs = 100;
    engine.tick(100);
    assert.equal(fired.length, 1);
    state.nowMs = 150;
    engine.onEvent(up(0, 0), z);

    state.nowMs = 300;
    engine.onEvent(down(0, 0), z); // 200 ms after the fire — inside the cooldown
    state.nowMs = 400;
    engine.tick(400);
    assert.equal(fired.length, 1); // swallowed
    state.nowMs = 450;
    engine.onEvent(up(0, 0), z);

    state.nowMs = 1200;
    engine.onEvent(down(5, 0), z); // 1100 ms after the fire — cooldown elapsed
    state.nowMs = 1300;
    engine.tick(1300);
    assert.deepEqual(fired.map(f => f.t), [100, 1300]);
});

test('type-2 is swallowed while a motion plays; type-6 bypasses the busy gate', () => {
    const { engine, zones, fired, state } = env([
        { type: 2, sample: 0 }, // weizhang_3 TouchDrag1
        { type: 6, sample: 0 }, // feiteliedadi_4 TouchDrag40
    ]);
    const z2 = zones.find(z => z.trigger.type === 2);
    const z6 = zones.find(z => z.trigger.type === 6);
    state.playing = true;

    engine.onEvent(down(0, 0), z2); // t = 0
    state.nowMs = 100;
    engine.tick(100);
    state.nowMs = 150;
    engine.onEvent(up(0, 0), z2);
    assert.equal(fired.length, 0); // busy gate holds the click

    state.nowMs = 200;
    engine.onEvent(down(0, 0), z6);
    state.nowMs = 300;
    engine.tick(300);
    // fixture type-6 actionList entries are empty strings — fired as-is
    assert.deepEqual(fired, [{ zoneId: z6.id, action: '', t: 300 }]);
});

test('type-3 long-press steps actionList at its times; early release fires last', () => {
    // xinzexi_3 carries a single {time: 1} step and no `last`; both are test
    // extensions (field names from the module contract) to pin the stepping.
    const patch = (e) => {
        e.trigger.actionList = [
            { action: 'touch_idle1', time: 1 },
            { action: 'touch_idle2', time: 4 },
        ];
        e.trigger.last = 'touch_bye';
    };
    // full hold: every step fires at its time, no last
    {
        const { engine, zones, fired, state } = env([{ type: 3, sample: 0, patch }]);
        const z = zones.find(z => z.trigger.type === 3);
        engine.onEvent(down(0, 0), z); // t = 0
        state.nowMs = 1000;
        engine.tick(1000);
        state.nowMs = 1500;
        engine.tick(1500);
        state.nowMs = 4000;
        engine.tick(4000);
        state.nowMs = 4500;
        engine.onEvent(up(0, 0), z);
        assert.deepEqual(fired.map(f => f.action), ['touch_idle1', 'touch_idle2']);
        assert.deepEqual(fired.map(f => f.t), [1000, 4000]);
    }
    // early release after the first step: last fires instead of the remaining steps
    {
        const { engine, zones, fired, state } = env([{ type: 3, sample: 0, patch }]);
        const z = zones.find(z => z.trigger.type === 3);
        engine.onEvent(down(0, 0), z); // t = 0
        state.nowMs = 1000;
        engine.tick(1000);
        state.nowMs = 2500;
        engine.onEvent(up(0, 0), z);
        assert.deepEqual(fired.map(f => f.action), ['touch_idle1', 'touch_bye']);
        assert.equal(fired[1].t, 2500);
    }
});

test('type-9 click only fires while the watched param is inside [num, num2)', () => {
    // wuzang_3 watches touch_drag1 with num: 0 and no num2; num2 is added with
    // the contract field name to pin both sides of the half-open interval.
    const { engine, zones, fired, state } = env([
        { type: 9, sample: 0, patch: (e) => { e.trigger.num2 = 0.2; } },
    ]);
    const z = zones.find(z => z.trigger.type === 9);
    state.params.touch_drag1 = 0.5; // outside [0, 0.2)
    engine.onEvent(down(0, 0), z); // t = 0
    state.nowMs = 100;
    engine.tick(100);
    state.nowMs = 150;
    engine.onEvent(up(0, 0), z);
    assert.equal(fired.length, 0);

    state.nowMs = 200;
    state.params.touch_drag1 = 0.1; // inside
    engine.onEvent(down(0, 0), z);
    state.nowMs = 300;
    engine.tick(300);
    assert.deepEqual(fired, [{ zoneId: z.id, action: 'touch_drag3', t: 300 }]);
});

test('type-10 animationPlay fires at rate crossing, once per stream, re-armed on loop restart', () => {
    const { engine, fired } = env([{ type: 10, sample: 0 }, { type: 10, sample: 1 }]);
    // sample 0: TouchIdle35 watches idle #17 @ 0.95 -> touch_idle35
    // sample 1: TouchIdle7  watches idle #6  @ 0.95 -> touch_idle2
    engine.setMotionProgress({ group: 'idle', index: 17, normalized: 0.5 });
    assert.equal(fired.length, 0);
    engine.setMotionProgress({ group: 'idle', index: 17, normalized: 0.96 });
    assert.deepEqual(fired.map(f => f.action), ['touch_idle35']);
    engine.setMotionProgress({ group: 'idle', index: 17, normalized: 0.99 });
    assert.equal(fired.length, 1); // once per stream
    engine.setMotionProgress({ group: 'idle', index: 6, normalized: 0.96 }); // new stream
    assert.deepEqual(fired.map(f => f.action), ['touch_idle35', 'touch_idle2']);
    engine.setMotionProgress({ group: 'idle', index: 6, normalized: 0.2 }); // loop restarted
    engine.setMotionProgress({ group: 'idle', index: 6, normalized: 0.96 });
    assert.deepEqual(fired.map(f => f.action), ['touch_idle35', 'touch_idle2', 'touch_idle2']);
});

test('xiaqi: player takes the top row -> win:true action fires and the board resets', () => {
    const { engine, zones, fired, state } = env([
        { type: 15, sample: 0 }, // cell 1 (TouchDrag14, index 1)
        { type: 15, sample: 1 }, // cell 2 (TouchDrag15, index 2)
        // cell 3: cloned from the real index-2 sample (cells 3..9 are not in the fixture bank)
        { type: 15, sample: 1, patch: (e) => { e.trigger.index = 3; e.part = 'TouchDrag16'; } },
        { type: 16, sample: 0 }, // win: true -> touch_idle6
    ]);
    const cell = (i) => zones.find(z => z.trigger.type === 15 && z.trigger.index === i);
    const winZone = zones.find(z => z.trigger.type === 16 && z.trigger.win === true);

    engine.onEvent(down(10, 10), cell(1)); // t = 0
    state.nowMs = 100;
    engine.tick(100);
    state.nowMs = 200;
    engine.onEvent(down(20, 10), cell(2));
    state.nowMs = 300;
    engine.tick(300);
    assert.deepEqual(engine.stats().board.cells, [1, 1, 0, 0, 0, 0, 0, 0, 0]);

    state.nowMs = 400;
    engine.onEvent(down(30, 10), cell(3));
    state.nowMs = 500;
    engine.tick(500);

    const winFire = fired.find(f => f.zoneId === winZone.id);
    assert.ok(winFire, 'win action fired');
    assert.equal(winFire.action, 'touch_idle6');
    assert.equal(winFire.t, 500);
    assert.deepEqual(engine.stats().board.cells, [0, 0, 0, 0, 0, 0, 0, 0, 0]); // reset after the win
    // cell moves were reported even though the fixture cells carry no trigger action
    assert.deepEqual(fired.filter(f => f.action === null && f.t < 500).map(f => f.zoneId),
        [cell(1).id, cell(2).id]);
});

test('xiaqi aiMove: win-if-possible, then block, then centre', () => {
    const { engine, zones, state } = env([
        { type: 15, sample: 0 }, // player cell 1
        { type: 15, sample: 1 }, // player cell 2
        // AI cells: target -1 (contract field name; fixture samples omit target)
        { type: 15, sample: 0, patch: (e) => { e.trigger.index = 4; e.trigger.target = -1; e.part = 'TouchDrag17'; } },
        { type: 15, sample: 0, patch: (e) => { e.trigger.index = 5; e.trigger.target = -1; e.part = 'TouchDrag18'; } },
    ]);
    const cell = (i) => zones.find(z => z.trigger.type === 15 && z.trigger.index === i);
    assert.equal(engine.aiMove(), 5); // empty board -> centre

    engine.onEvent(down(0, 0), cell(1)); // t = 0
    state.nowMs = 100;
    engine.tick(100);
    state.nowMs = 200;
    engine.onEvent(down(0, 0), cell(2));
    state.nowMs = 300;
    engine.tick(300);
    assert.equal(engine.aiMove(), 3); // must block the top row

    state.nowMs = 400;
    engine.onEvent(down(0, 0), cell(4)); // AI takes 4
    state.nowMs = 500;
    engine.tick(500);
    state.nowMs = 600;
    engine.onEvent(down(0, 0), cell(5)); // AI takes 5
    state.nowMs = 700;
    engine.tick(700);
    assert.equal(engine.aiMove(), 6); // AI completes 4-5-6 before blocking
});

test('type-12 extend-rule: isActionAllowed blocks the ignore list while the param is in range', () => {
    const { engine, state } = env([{ type: 12, sample: 1 }]); // jinshi_2: num [0.01, 10] on touch_drag9
    state.params.touch_drag9 = 5;
    assert.equal(engine.isActionAllowed('touch_idle1'), false); // listed in the zone ignore data
    assert.equal(engine.isActionAllowed('touch_idle11'), false);
    assert.equal(engine.isActionAllowed('touch_idle2'), true); // not gated by this rule
    state.params.touch_drag9 = 0; // outside [0.01, 10] — rules off
    assert.equal(engine.isActionAllowed('touch_idle1'), true);
});

test('type-13 param-move reports per-tick drag deltas for the host to write', () => {
    const { engine, zones } = env([{ type: 13, sample: 0 }]); // beilaosenlin_2: TTB <- TTA, rate 0.4
    const z = zones.find(z => z.trigger.type === 13);
    assert.deepEqual(engine.activeParamDrags(), []);

    engine.onEvent(down(100, 100), z); // t = 0
    engine.onEvent(move(110, 90), z); // +10, -10
    engine.onEvent(move(115, 88), z); // +5, -2
    engine.tick(200);
    assert.deepEqual(engine.activeParamDrags(),
        [{ zone: z, dx: 15, dy: -12, dt: 200, rate: 0.4 }]);
    // stable within the frame; the next tick starts a fresh window
    assert.deepEqual(engine.activeParamDrags(),
        [{ zone: z, dx: 15, dy: -12, dt: 200, rate: 0.4 }]);

    engine.onEvent(move(120, 80), z); // +5, -8
    engine.tick(300);
    assert.deepEqual(engine.activeParamDrags(),
        [{ zone: z, dx: 5, dy: -8, dt: 100, rate: 0.4 }]);
});

test('type-8 fires once accumulated hold time reaches delta, across separate presses', () => {
    const { engine, zones, fired, state } = env([{ type: 8, sample: 0 }]); // wuzang_3: delta 5, no action
    const z = zones.find(z => z.trigger.type === 8);
    engine.onEvent(down(0, 0), z); // t = 0
    state.nowMs = 3000;
    engine.tick(3000); // 3 s held — not yet
    engine.onEvent(up(0, 0), z); // banks 3 s

    state.nowMs = 3100;
    engine.onEvent(down(0, 0), z);
    state.nowMs = 4100;
    engine.tick(4100); // 3 s + 1 s — still short of delta
    state.nowMs = 5100;
    engine.tick(5100); // 3 s + 2 s == delta -> fires
    assert.deepEqual(fired, [{ zoneId: z.id, action: null, t: 5100 }]);
});
