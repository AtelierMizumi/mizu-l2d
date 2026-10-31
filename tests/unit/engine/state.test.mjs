// Unit tests for web/engine/state.js — idle-pose state machine + pose lifecycle
// (PARITY-PLAN Task 9 / spec P1-5). state.js is a dual-env classic script; load it
// with a stub window. Fixture drags[] entries come from real skins via
// fixtures/real-samples.json, normalized to the zone fields state.js consumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const stubWindow = { MizuEngine: null };
globalThis.window = stubWindow;

vm.runInThisContext(readFileSync(new URL('../../../web/engine/state.js', import.meta.url), 'utf8'));
const createStateEngine = stubWindow.MizuEngine.createStateEngine;

const fixtures = JSON.parse(
    readFileSync(new URL('./fixtures/real-samples.json', import.meta.url), 'utf8'));

// Minimal normalization of a raw drags entry to the zone fields state.js reads
// (the relevant subset of MizuEngine.buildZones output). Overrides win for
// isolating single gates on top of real data.
function toZone(entry, overrides = {}) {
    return {
        id: entry.id,
        action: (entry.trigger && entry.trigger.action) || null,
        idle: entry.idle,
        revertIdle: entry.revertIdle,
        reactCondition: entry.reactCondition,
        ignore: entry.ignore,
        enable: entry.enable,
        ignoreAction: entry.ignoreAction,
        ignoreReact: entry.ignoreReact,
        offsetX: entry.offsetX,
        offsetY: entry.offsetY,
        trigger: entry.trigger,
        ...overrides,
    };
}

// Fake host runtime: records playMotion/setIdleGroup calls, playingGroup is a
// settable variable (undefined = nothing but the resting idle is playing).
function makeCtx({ playing } = {}) {
    const calls = { playMotion: [], setIdleGroup: [] };
    let current = playing;
    return {
        calls,
        play(g) { current = g; },
        playMotion(g) { calls.playMotion.push(g); },
        setIdleGroup(g) { calls.setIdleGroup.push(g); },
        playingGroup: () => current,
        now: () => 1000,
    };
}

function makeIdleMotions(spec) {
    return new Map(Object.entries(spec).map(([k, v]) => [Number(k), v]));
}

// weizhang_3 click entries: touch_idle9 (idle 1), touch_idle2 (idle 2), touch_idle3 (idle 3)
const clickIdleZones = fixtures.click_with_idle.map(e => toZone(e.entry));
const IDLE_MOTIONS = makeIdleMotions({ 0: 'idle', 1: 'idle1', 2: 'touch_idle2' });
const zoneByAction = (zones, action) => zones.find(z => z.action === action);

test('firing a fixture zone with idle: 2 switches state and idle group; zone offsets attach', () => {
    const ctx = makeCtx();
    const eng = createStateEngine({ zones: clickIdleZones, idleMotions: IDLE_MOTIONS, ctx });

    assert.equal(eng.onActionFired('touch_idle2'), true);
    assert.equal(eng.current(), 2);
    assert.equal(eng.idleGroup(), 'touch_idle2'); // idleMotions.get(2), host synthesis wins
    assert.deepEqual(eng.sequenceOffset(), { x: 0, y: 0 });
    assert.deepEqual(ctx.calls.setIdleGroup, ['touch_idle2']);

    const d = eng.describe();
    assert.equal(d.state, 2);
    assert.equal(d.idleGroup, 'touch_idle2');
    assert.equal(d.sequence.prefix, 'touch_idle');
    assert.equal(d.sequence.step, 2);
    assert.equal(d.sequence.nextAction, 'touch_idle3'); // chain 2 -> 3 -> 9 from fixture zones

    // real zhenzhuhao_2 entry: idle 8 with offsetX 50 / offsetY -50
    const zh = fixtures.by_trigger_type['4'].map(e => toZone(e.entry));
    const ctx2 = makeCtx();
    const eng2 = createStateEngine({
        zones: zh,
        idleMotions: makeIdleMotions({ 0: 'idle', 8: 'touch_idle8' }),
        ctx: ctx2,
    });
    assert.equal(eng2.onActionFired('touch_idle8'), true);
    assert.equal(eng2.current(), 8);
    assert.equal(eng2.idleGroup(), 'touch_idle8');
    assert.deepEqual(eng2.sequenceOffset(), { x: 50, y: -50 });
});

test('motion end while holding a pose keeps the pose group and schedules no revert', () => {
    const ctx = makeCtx();
    const eng = createStateEngine({ zones: clickIdleZones, idleMotions: IDLE_MOTIONS, ctx });
    eng.onActionFired('touch_idle2');
    ctx.play('touch_idle2');

    eng.onMotionEnded('touch_idle2');
    assert.equal(eng.current(), 2);
    assert.equal(eng.idleGroup(), 'touch_idle2');
    assert.equal(eng.pendingRevert(), null);

    // a transient zone (no idle) firing and ending must not kill the held pose either
    const zones = clickIdleZones.concat([toZone({ trigger: { type: 2, action: 'touch_head' } })]);
    const eng2 = createStateEngine({ zones, idleMotions: IDLE_MOTIONS, ctx: makeCtx() });
    eng2.onActionFired('touch_idle2');
    eng2.onActionFired('touch_head');
    assert.equal(eng2.current(), 2);
    eng2.onMotionEnded('touch_head');
    assert.equal(eng2.current(), 2);
    assert.equal(eng2.idleGroup(), 'touch_idle2');
});

test('revertIdle: 0 schedules a return to base idle after the pose motion ends', () => {
    const withRevert = clickIdleZones.map(z =>
        z.action === 'touch_idle2' ? { ...z, revertIdle: 0 } : z);
    const ctx = makeCtx();
    const eng = createStateEngine({ zones: withRevert, idleMotions: IDLE_MOTIONS, ctx });
    eng.onActionFired('touch_idle2');
    assert.equal(eng.current(), 2);
    ctx.play('touch_idle2');

    eng.onMotionEnded('touch_idle2');
    assert.deepEqual(eng.pendingRevert(), { state: 0, group: 'idle' });
    assert.equal(eng.current(), 0); // bookkeeping already returned to base
    assert.equal(eng.idleGroup(), 'idle');
    assert.deepEqual(eng.sequenceOffset(), { x: 0, y: 0 });
    assert.equal(eng.describe().sequence, null); // pose lifecycle ended

    // host applies the revert (reset-like) -> pending cleared
    eng.reset();
    assert.equal(eng.pendingRevert(), null);

    // real-data shape: wuzang_3 carries revertIdle as an array ([0])
    const arrForm = clickIdleZones.map(z =>
        z.action === 'touch_idle2' ? { ...z, revertIdle: [0] } : z);
    const eng2 = createStateEngine({ zones: arrForm, idleMotions: IDLE_MOTIONS, ctx: makeCtx() });
    eng2.onActionFired('touch_idle2');
    eng2.onMotionEnded('touch_idle2');
    assert.deepEqual(eng2.pendingRevert(), { state: 0, group: 'idle' });
});

test('reactCondition.idleOn gates canFire by the current state', () => {
    const gated = clickIdleZones.map(z =>
        z.action === 'touch_idle2'
            ? { ...z, reactCondition: { idleOn: [1] }, enable: [], ignoreAction: false, ignore: [] }
            : z);
    const eng = createStateEngine({ zones: gated, idleMotions: IDLE_MOTIONS, ctx: makeCtx() });
    const zone = zoneByAction(gated, 'touch_idle2');

    assert.equal(eng.canFire(zone), false); // state 0 not in idleOn [1]
    assert.equal(eng.setState(1), true);
    assert.equal(eng.canFire(zone), true); // state 1

    // real weizhang_3 entry: idleOn [0] / idleOff [1..9]
    const real = toZone(fixtures.by_trigger_type['2'][0].entry);
    const eng2 = createStateEngine({
        zones: [real],
        idleMotions: makeIdleMotions({ 0: 'idle', 1: 'idle1' }),
        ctx: makeCtx(),
    });
    assert.equal(eng2.canFire(real), true); // state 0 is in idleOn
    eng2.setState(1);
    assert.equal(eng2.canFire(real), false); // state 1 is in idleOff
});

test('zone ignore blocks firing while the listed group plays', () => {
    const zones = clickIdleZones.map(z =>
        z.action === 'touch_idle2'
            ? { ...z, ignore: ['touch_drag1'], enable: [], ignoreAction: false }
            : z);
    const ctx = makeCtx({ playing: 'touch_drag1' });
    const eng = createStateEngine({ zones, idleMotions: IDLE_MOTIONS, ctx });
    const zone = zoneByAction(zones, 'touch_idle2');

    assert.equal(eng.canFire(zone), false); // playingGroup() is ignored-listed
    ctx.play('idle');
    assert.equal(eng.canFire(zone), true);
    ctx.play(undefined);
    assert.equal(eng.canFire(zone), true); // nothing playing -> ignore cannot hit

    // real zhenzhuhao_2 entry ignores the base 'idle' group
    const real = toZone(fixtures.by_trigger_type['4'][0].entry);
    const eng2 = createStateEngine({
        zones: [real],
        idleMotions: makeIdleMotions({ 0: 'idle', 8: 'touch_idle8' }),
        ctx: makeCtx({ playing: 'idle' }),
    });
    assert.equal(eng2.canFire(real), false);
});

test('zone enable restricts firing to the listed playing groups; ignoreAction gates reactions', () => {
    const zones = clickIdleZones.map(z =>
        z.action === 'touch_idle2'
            ? { ...z, enable: ['idle'], ignore: [], ignoreAction: false }
            : z);
    const ctx = makeCtx({ playing: 'touch_head' });
    const eng = createStateEngine({ zones, idleMotions: IDLE_MOTIONS, ctx });
    const zone = zoneByAction(zones, 'touch_idle2');

    assert.equal(eng.canFire(zone), false); // 'touch_head' not in enable ['idle']
    ctx.play('idle');
    assert.equal(eng.canFire(zone), true);

    // real banerwei_3 entry: ignoreAction true (param-drag zone)
    const real = toZone(fixtures.by_trigger_type['1'][1].entry);
    const eng2 = createStateEngine({
        zones: [real],
        idleMotions: makeIdleMotions({ 0: 'idle' }),
        ctx: makeCtx({ playing: 'touch_head' }),
    });
    assert.equal(eng2.canFire(real), false); // non-idle motion playing
    const idleCtx = makeCtx({ playing: 'idle' });
    const eng3 = createStateEngine({
        zones: [real],
        idleMotions: makeIdleMotions({ 0: 'idle' }),
        ctx: idleCtx,
    });
    assert.equal(eng3.canFire(real), true); // playingGroup == engine idle group
    assert.equal(eng3.canFire(real), true); // and with nothing playing (fresh ctx below)
    const eng4 = createStateEngine({
        zones: [real],
        idleMotions: makeIdleMotions({ 0: 'idle' }),
        ctx: makeCtx(),
    });
    assert.equal(eng4.canFire(real), true);
});

test('reset() restores base idle, zeroes the offset and clears sequence + revert', () => {
    const ctx = makeCtx();
    const eng = createStateEngine({ zones: clickIdleZones, idleMotions: IDLE_MOTIONS, ctx });
    eng.onActionFired('touch_idle2');
    assert.equal(eng.current(), 2);

    eng.reset();
    assert.equal(eng.current(), 0);
    assert.equal(eng.idleGroup(), 'idle'); // idleMotions.get(0)
    assert.deepEqual(eng.sequenceOffset(), { x: 0, y: 0 });
    assert.deepEqual(ctx.calls.setIdleGroup, ['touch_idle2', 'idle']);
    const d = eng.describe();
    assert.equal(d.sequence, null);
    assert.equal(d.pendingRevert, null);
});

test('setState drives a direct pose set and rejects unknown states without throwing', () => {
    const ctx = makeCtx();
    const eng = createStateEngine({
        zones: clickIdleZones,
        idleMotions: makeIdleMotions({ 0: 'idle', 1: 'idle1', 2: 'touch_idle2', 3: 'idle3' }),
        ctx,
    });
    assert.equal(eng.setState(3), true);
    assert.equal(eng.current(), 3);
    assert.equal(eng.idleGroup(), 'idle3');
    assert.deepEqual(ctx.calls.playMotion, ['idle3']); // ctl pose set actually plays
    assert.equal(eng.describe().sequence, null); // no zone behind a direct set
    assert.deepEqual(eng.sequenceOffset(), { x: 0, y: 0 });

    const eng2 = createStateEngine({ zones: clickIdleZones, idleMotions: IDLE_MOTIONS, ctx: makeCtx() });
    assert.equal(eng2.setState(3), false); // 3 missing from idleMotions
    assert.equal(eng2.current(), 0);
    assert.equal(eng2.idleGroup(), 'idle');
});

test('actions with no matching zone keep the current state and never throw', () => {
    const ctx = makeCtx();
    const eng = createStateEngine({ zones: clickIdleZones, idleMotions: IDLE_MOTIONS, ctx });
    eng.onActionFired('touch_idle2');
    eng.onActionFired('whatever');
    eng.onActionFired('');
    assert.equal(eng.current(), 2);
    assert.equal(eng.idleGroup(), 'touch_idle2');

    // a skin registry without the action at all behaves the same from base state
    const eng2 = createStateEngine({ zones: [], idleMotions: makeIdleMotions({ 0: 'idle' }), ctx: makeCtx() });
    eng2.onActionFired('whatever');
    assert.equal(eng2.current(), 0);
    assert.equal(eng2.idleGroup(), 'idle');
    assert.equal(eng2.describe().sequence, null);
});

test('idle: 0 zones return to base idle and clear the offset (real meikelunbao_2 entries)', () => {
    const mk = fixtures.by_trigger_type['10'].map(e => toZone(e.entry));
    const eng = createStateEngine({
        zones: mk,
        idleMotions: makeIdleMotions({ 0: 'idle', 4: 'touch_idle4' }),
        ctx: makeCtx(),
    });
    assert.equal(eng.onActionFired('touch_idle2'), true); // idle: 4
    assert.equal(eng.current(), 4);
    assert.equal(eng.idleGroup(), 'touch_idle4');

    assert.equal(eng.onActionFired('touch_idle35'), true); // idle: 0
    assert.equal(eng.current(), 0);
    assert.equal(eng.idleGroup(), 'idle');
    assert.deepEqual(eng.sequenceOffset(), { x: 0, y: 0 });
    assert.equal(eng.describe().sequence.prefix, 'touch_idle'); // idle: 0 still tracks its sequence
});
