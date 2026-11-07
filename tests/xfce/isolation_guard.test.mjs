// Task 1: isolation guard + evidence layout (node:test, env-stubbed).
// Run: node --test tests/xfce/isolation_guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertIsolated } from './isolation_guard.mjs';
import { createEvidenceDir, collectEvidence } from './evidence.mjs';

const HOME = process.env.HOME;

test('assertIsolated throws on wrong display / config home', () => {
    // brief Step 1, verbatim values
    assert.throws(() => assertIsolated({ DISPLAY: ':0', XDG_CONFIG_HOME: '/home/user/.config', WAYLAND_DISPLAY: 'wayland-1' }));
});

test('assertIsolated passes on Bot Desktop env', () => {
    // brief Step 1, verbatim values
    const res = assertIsolated({ DISPLAY: ':20', XDG_CONFIG_HOME: `${HOME}/.hermes/bot-desktop/xdg`, WAYLAND_DISPLAY: 'wayland-1' });
    assert.deepEqual(res.ok, true);
    assert.deepEqual(res, {
        ok: true,
        DISPLAY: ':20',
        xdgConfigHome: `${HOME}/.hermes/bot-desktop/xdg`,
        waylandDisplay: 'wayland-1',
    });
});

test('createEvidenceDir makes run dir with bot subdirs', () => {
    const dir = createEvidenceDir('20261107');
    assert.equal(dir, join(HOME, '.hermes/cache/scratch/mizu-xfce-run-20261107'));
    for (const sub of ['probe', 'logic', 'logs', 'review']) {
        assert.ok(statSync(join(dir, sub)).isDirectory(), `missing subdir ${sub}`);
    }
    // collectEvidence: string content and file-copy forms
    const src = join(dir, 'probe/result.json');
    const written = collectEvidence({ [src]: '{"ok":true}' });
    assert.deepEqual(written, [src]);
    assert.ok(existsSync(src));
});
