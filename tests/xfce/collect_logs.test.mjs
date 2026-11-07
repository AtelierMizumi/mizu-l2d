// Task 4: log bot — read-only evidence bundle (node:test, tmpdir stub).
// Runs collect_logs.sh against a stub HOME with one of each source file,
// asserts all 5 outputs copied and exit 0 even when wall.log is missing.
// Run: node --test tests/xfce/collect_logs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'collect_logs.sh');

// Build a stub HOME + journalctl stub on PATH, run the collector, return { status, stderr, out }.
function runCollector({ withWallLog = true } = {}) {
    // Read explicit so a missing collector fails as "Cannot read collect_logs.sh" before any spawn.
    assert.ok(existsSync(SCRIPT), `Cannot read collect_logs.sh: ${SCRIPT}`);
    readFileSync(SCRIPT);

    const root = mkdtempSync(join(tmpdir(), 'mizu-collect-logs-'));
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    const out = join(root, 'evidence', 'logs');

    mkdirSync(join(home, '.local/state/mizu-l2d'), { recursive: true });
    mkdirSync(join(home, '.cache/mizu/state'), { recursive: true });
    mkdirSync(bin, { recursive: true });

    if (withWallLog) {
        writeFileSync(join(home, '.local/state/mizu-l2d/wall.log'), 'stub wall log\nwall line 1\n');
    }
    writeFileSync(join(home, '.cache/mizu/tokens.json'), '{"token":"stub"}\n');
    writeFileSync(join(home, '.cache/mizu/state/wallpaper'), '/stub/wallpaper path\n');

    // Deterministic journalctl: never hit the real user journal in tests.
    const journal = join(bin, 'journalctl');
    writeFileSync(journal, '#!/bin/sh\necho stub-journal-warning\n');
    chmodSync(journal, 0o755);

    const res = spawnSync('bash', [SCRIPT, out], {
        encoding: 'utf8',
        env: {
            ...process.env,
            HOME: home,
            PATH: `${bin}:${process.env.PATH}`,
            DISPLAY: ':20',
            XDG_CONFIG_HOME: join(home, '.hermes/bot-desktop/xdg'),
            WAYLAND_DISPLAY: 'wayland-1',
        },
    });
    return { status: res.status, stderr: res.stderr, out };
}

test('collect_logs.sh copies all 5 evidence files', () => {
    const { status, stderr, out } = runCollector({ withWallLog: true });
    assert.equal(status, 0, `expected exit 0, stderr: ${stderr}`);

    for (const name of ['wall.log', 'journal.txt', 'env.txt', 'tokens.json', 'wallpaper']) {
        assert.ok(existsSync(join(out, name)), `missing ${name} in ${out}`);
    }
    assert.match(readFileSync(join(out, 'wall.log'), 'utf8'), /stub wall log/);
    assert.match(readFileSync(join(out, 'tokens.json'), 'utf8'), /"token":"stub"/);
    assert.match(readFileSync(join(out, 'wallpaper'), 'utf8'), /\/stub\/wallpaper path/);
    assert.match(readFileSync(join(out, 'journal.txt'), 'utf8'), /stub-journal-warning/);
    const env = readFileSync(join(out, 'env.txt'), 'utf8');
    assert.match(env, /^DISPLAY=:20$/m);
    assert.match(env, /^XDG_CONFIG_HOME=/m);
    assert.match(env, /^WAYLAND_DISPLAY=wayland-1$/m);
});

test('collect_logs.sh exits 0 even when wall.log is missing', () => {
    const { status, stderr, out } = runCollector({ withWallLog: false });
    assert.equal(status, 0, `expected exit 0 even when wall.log missing, stderr: ${stderr}`);

    for (const name of ['wall.log', 'journal.txt', 'env.txt', 'tokens.json', 'wallpaper']) {
        assert.ok(existsSync(join(out, name)), `missing ${name} in ${out} (wall.log absent in stub)`);
    }
    assert.match(readFileSync(join(out, 'wall.log'), 'utf8'), /missing/);
});
