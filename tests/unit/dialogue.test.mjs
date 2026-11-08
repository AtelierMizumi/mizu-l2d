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

// Thorough fix — Issue #1 (RED before GREEN):
// - say(null/'') must stay silent (no touch fallback)
// - keyForAction must map full upstream action space when words present
// - drag/idle pool rotation must not repeat same line
test('say() stays silent for null/empty (no touch fallback)', () => {
    const d = makeInstance({ touch: { line: 'generic' } });
    assert.equal(d.say(null), false);
    assert.equal(d.say(''), false);
    assert.equal(d.say(undefined), false);
    assert.equal(d.visible, false);
});

test('keyForAction maps upstream event keys when words present', () => {
    const d = makeInstance({
        wedding: { line: 'w' }, change_in: { line: 'ci' }, change_out: { line: 'co' },
        feeling: { line: 'f' }, feeling5: { line: 'f5' }, asmr: { line: 'a' },
        expedition: { line: 'e' }, detail: { line: 'd' }, unlock: { line: 'u' },
        win_mvp: { line: 'win' }, battle: { line: 'b' }, lose: { line: 'l' },
        upgrade: { line: 'up' }, skill: { line: 's' }, propose: { line: 'p' },
        profile: { line: 'prof' }, gift_prefer: { line: 'g' }, hp_warning: { line: 'hp' },
        couple_encourage1: { line: 'ce1' },
    });
    assert.equal(d.keyForAction('wedding'), 'wedding');
    assert.equal(d.keyForAction('change_in'), 'change_in');
    assert.equal(d.keyForAction('change_out'), 'change_out');
    assert.equal(d.keyForAction('feeling'), 'feeling');
    assert.equal(d.keyForAction('feeling5'), 'feeling5');
    assert.equal(d.keyForAction('asmr'), 'asmr');
    assert.equal(d.keyForAction('expedition'), 'expedition');
    assert.equal(d.keyForAction('detail'), 'detail');
    assert.equal(d.keyForAction('unlock'), 'unlock');
    assert.equal(d.keyForAction('win_mvp'), 'win_mvp');
    assert.equal(d.keyForAction('propose'), 'propose');
    assert.equal(d.keyForAction('couple_encourage1'), 'couple_encourage1');
});

test('keyForAction returns specific drag key when words has it', () => {
    const d = makeInstance({ touch: { line: 't' }, touch2: { line: 't2' }, touch_drag7: { line: 'd7' } });
    assert.equal(d.keyForAction('touch_drag7'), 'touch_drag7');
    assert.equal(d.keyForAction('touch_drag8'), 'touch2');
});

test('say() rotates touch pool instead of repeating same line', () => {
    const d = makeInstance({ touch: { line: 't1' }, touch2: { line: 't2' }, main1: { line: 'm1' } });
    assert.equal(d.say('touch', { force: true }), true);
    const first = d.text;
    assert.equal(d.say('touch', { force: true }), true);
    const second = d.text;
    assert.equal(d.say('touch', { force: true }), true);
    assert.notEqual(first, second);
});
