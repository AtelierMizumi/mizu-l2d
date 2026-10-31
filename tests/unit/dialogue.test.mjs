// Unit tests for web/dialogue.js mapping + fallback rules (PARITY-PLAN Task 3).
// dialogue.js is a browser IIFE; load it with minimal DOM/window stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeEl() {
    return {
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        setAttribute() {}, append() {}, style: {}, hidden: false, textContent: '',
    };
}
const stubWindow = { addEventListener() {}, MizuDialogue: null };
globalThis.window = stubWindow;
delete globalThis.BroadcastChannel; // Node ships one; it would keep the test event loop alive
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { createElement: makeEl, getElementById: () => null, body: { append() {} } };
globalThis.Audio = class {
    constructor() { this.volume = 1; }
    play() { return Promise.resolve(); }
    pause() {}
    removeAttribute() {}
};

vm.runInThisContext(readFileSync(new URL('../../web/dialogue.js', import.meta.url), 'utf8'));

function makeInstance(words) {
    const d = stubWindow.MizuDialogue.init({ settings: { mute: true } });
    if (words) d.load(words);
    d.setChatter(false); // load() arms a 3–8 min chatter timer; keep the event loop clean
    return d;
}

test('main_N actions map to mainN keys', () => {
    assert.equal(stubWindow.MizuDialogue.keyForAction('main_1'), 'main1');
    assert.equal(stubWindow.MizuDialogue.keyForAction('main_4'), 'main4');
});

test('event actions map to their words keys', () => {
    assert.equal(stubWindow.MizuDialogue.keyForAction('login'), 'login');
    assert.equal(stubWindow.MizuDialogue.keyForAction('home'), 'home');
    assert.equal(stubWindow.MizuDialogue.keyForAction('mission'), 'mission');
    assert.equal(stubWindow.MizuDialogue.keyForAction('mission_complete'), 'mission_complete');
    assert.equal(stubWindow.MizuDialogue.keyForAction('mail'), 'mail');
});

test('touch groups map as before', () => {
    assert.equal(stubWindow.MizuDialogue.keyForAction('touch_head'), 'headtouch');
    assert.equal(stubWindow.MizuDialogue.keyForAction('touch_body'), 'touch');
    assert.equal(stubWindow.MizuDialogue.keyForAction('touch_special'), 'touch2');
});

test('drag/idle actions prefer touch2 when the skin has it', () => {
    const d = makeInstance({ touch: { line: 't' }, touch2: { line: 't2' } });
    assert.equal(d.keyForAction('touch_drag7'), 'touch2');
    assert.equal(d.keyForAction('touch_idle3'), 'touch2');
});

test('actions without a words key return null (no wrong-zone line)', () => {
    assert.equal(stubWindow.MizuDialogue.keyForAction('change_in'), null);
    assert.equal(stubWindow.MizuDialogue.keyForAction('change_out'), null);
    assert.equal(stubWindow.MizuDialogue.keyForAction('wedding'), null);
    assert.equal(stubWindow.MizuDialogue.keyForAction('some_unknown_group'), null);
});

test('say() stays silent for a key the skin does not have', () => {
    const d = makeInstance({ touch: { line: 'generic' }, main1: { line: 'm1' } });
    assert.equal(d.say('nosuchkey'), false);
    assert.equal(d.visible, false);
});

test('say() still shows a line the skin has', () => {
    const d = makeInstance({ touch: { line: 'generic' } });
    assert.equal(d.say('touch'), true);
    assert.equal(d.text, 'generic');
});
