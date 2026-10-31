// Unit tests for web/engine/zones.js (PARITY-PLAN Task 6): drags[] -> zone
// registry. Loads the dual-env module with a window stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
vm.runInThisContext(readFileSync(new URL('../../../web/engine/zones.js', import.meta.url), 'utf8'));
const { buildZones } = globalThis.window.MizuEngine;

const FX = JSON.parse(readFileSync(new URL('./fixtures/real-samples.json', import.meta.url), 'utf8'));
const DRAWABLES = ['TouchHead', 'TouchBody', 'TouchSpecial', 'TouchIdle1', 'TouchDrag1', 'TouchDrag14'];
const GROUPS = ['idle', 'touch_head', 'touch_body', 'touch_special', 'touch_idle1', 'touch_drag1'];

function entryFromType(type) {
    const sample = FX.by_trigger_type[String(type)]?.[0];
    if (!sample) throw new Error('no fixture for trigger type ' + type);
    return JSON.parse(JSON.stringify(sample.entry));
}

test('type-2 click entry with resolvable part becomes a hit zone', () => {
    const e = entryFromType(2);
    e.part = 'TouchIdle1';
    e.trigger = e.trigger || {};
    e.trigger.type = 2;
    e.trigger.action = 'touch_idle1';
    e.limitTime = 1;
    const { zones, meta } = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS });
    assert.equal(zones.length, 1);
    assert.equal(zones[0].partIndex, DRAWABLES.indexOf('TouchIdle1'));
    assert.equal(zones[0].action, 'touch_idle1');
    assert.equal(zones[0].limitTimeMs, 1000);
    assert.equal(zones[0].inert, false);
    assert.equal(meta.total, 1);
    assert.equal(meta.hitAreas, 1);
});

test('click entry carrying idle exposes it (pose switch)', () => {
    const sample = FX.click_with_idle[0].entry;
    const { zones } = buildZones({
        skins: { drags: [sample] },
        drawableIds: [...DRAWABLES, sample.part].filter((v, i, a) => a.indexOf(v) === i),
        motionGroups: GROUPS,
    });
    assert.equal(zones.length, 1);
    assert.equal(zones[0].idle, sample.idle);
});

test('entry whose part is not a drawable becomes a param listener', () => {
    const e = entryFromType(2);
    e.part = 'NotARealPart';
    const { zones, paramListeners } = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS });
    assert.equal(zones.length, 0);
    assert.equal(paramListeners.length, 1);
    assert.equal(paramListeners[0].partIndex, -1);
});

test('unknown trigger type is an inert zone that still carries the action', () => {
    const e = entryFromType(2);
    e.part = 'TouchBody';
    e.trigger = { type: 99, action: 'touch_body' };
    const { zones } = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS });
    assert.equal(zones.length, 1);
    assert.equal(zones[0].inert, true);
    assert.equal(zones[0].action, 'touch_body');
});

test('entry without a trigger is inert', () => {
    const e = entryFromType(2);
    e.part = 'TouchBody';
    delete e.trigger;
    const { zones } = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS });
    assert.equal(zones[0].inert, true);
    assert.equal(zones[0].action, null);
});

test('null skins and drags-less skins yield an empty registry without throwing', () => {
    for (const skins of [null, {}, { drags: null }]) {
        const r = buildZones({ skins, drawableIds: DRAWABLES, motionGroups: GROUPS });
        assert.deepEqual(r, { zones: [], paramListeners: [], meta: { total: 0, hitAreas: 0 } });
    }
});

test('limitTime normalization: absent -> 1000ms, 0.1 -> 100ms, invalid -> 1000ms', () => {
    const mk = (lt) => {
        const e = entryFromType(2);
        e.part = 'TouchBody';
        e.trigger = { type: 2, action: 'touch_body' };
        if (lt === undefined) delete e.limitTime; else e.limitTime = lt;
        return buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS }).zones[0].limitTimeMs;
    };
    assert.equal(mk(undefined), 1000);
    assert.equal(mk(0.1), 100);
    assert.equal(mk(0.3), 300);
    assert.equal(mk(-1), 1000);
});

test("param 'empty' normalizes to null", () => {
    const e = entryFromType(2);
    e.part = 'TouchBody';
    e.trigger = { type: 2, action: 'touch_body' };
    e.param = 'empty';
    const { zones } = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS });
    assert.equal(zones[0].param, null);
});

test('xiaqi entry keeps its trigger fields (index/target)', () => {
    const e = entryFromType(15);
    e.part = 'TouchDrag14';
    const { zones } = buildZones({ skins: { drags: [e] }, drawableIds: [...DRAWABLES], motionGroups: GROUPS });
    assert.equal(zones.length, 1);
    assert.equal(zones[0].trigger.type, 15);
    assert.ok('index' in zones[0].trigger);
});

test('every normalized zone carries the full key set with null defaults', () => {
    const e = entryFromType(2);
    e.part = 'TouchBody';
    e.trigger = { type: 2, action: 'touch_body' };
    delete e.rangeAbs; // fixture entries carry rangeAbs: true; absent -> null
    const { zones } = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS });
    for (const k of ['id', 'part', 'partIndex', 'meshIndices', 'action', 'trigger', 'inert', 'idle', 'param',
        'range', 'rangeAbs', 'smooth', 'revertSmooth', 'revert', 'revertActionIndex', 'revertIdle', 'idleFocus',
        'mode', 'snap', 'snapMode', 'dragDirect', 'rate', 'listener', 'relations', 'reactCondition', 'ignore',
        'enable', 'ignoreAction', 'ignoreReact', 'limitTimeMs', 'offsetX', 'offsetY', 'label']) {
        assert.ok(k in zones[0], 'missing key ' + k);
    }
    assert.equal(zones[0].rangeAbs, null);
    assert.equal(zones[0].ignore.length, 0);
    // real values pass through untouched
    e.rangeAbs = true;
    const r2 = buildZones({ skins: { drags: [e] }, drawableIds: DRAWABLES, motionGroups: GROUPS }).zones[0];
    assert.equal(r2.rangeAbs, true);
});
