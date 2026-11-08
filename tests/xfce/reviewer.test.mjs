// Task 5: reviewer bot — verdict vs PARITY-SPEC AC-1.1/1.2/1.3 (node:test, tmpdir bundles).
// Reads sample evidence bundles (mismatched lastTap, good, logs-incomplete, clobbered)
// and asserts the verdict. Never touches the real scratch dir.
// Run: node --test tests/xfce/reviewer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewEvidence } from './reviewer.mjs';

const LOG_FILES = ['wall.log', 'journal.txt', 'env.txt', 'tokens.json', 'wallpaper'];

function makeBundle({ lines, logFiles = LOG_FILES, withScreenshot = true } = {}) {
    const runDir = mkdtempSync(join(tmpdir(), 'mizu-reviewer-'));
    mkdirSync(join(runDir, 'probe'), { recursive: true });
    mkdirSync(join(runDir, 'logs'), { recursive: true });
    mkdirSync(join(runDir, 'review'), { recursive: true });
    writeFileSync(join(runDir, 'probe/result.json'), lines.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (withScreenshot) {
        writeFileSync(join(runDir, 'probe/xfce_click_probe.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    for (const name of logFiles) {
        writeFileSync(join(runDir, 'logs', name), `stub ${name}\n`);
    }
    return runDir;
}

test('mismatched lastTap yields verdict FAIL (AC-1.1)', () => {
    // brief Step 1, verbatim intent: sample bundle with mismatched lastTap.
    const runDir = makeBundle({
        lines: [
            { prefab: 'gaoxiong_7', action: 'touch_head', x: 1, y: 2, expectedAction: 'touch', lastTap: 'touch', tips: false, pass: false },
        ],
    });
    const { verdict, checks } = reviewEvidence(runDir);
    assert.equal(verdict, 'FAIL');
    const ac11 = checks.find(c => c.ac === 'AC-1.1');
    assert.ok(ac11, 'missing AC-1.1 check with per-AC line refs');
    assert.equal(ac11.ok, false);
    assert.ok(ac11.lines.some(l => l.includes('probe/result.json:1')), `AC-1.1 must cite result.json line, got ${JSON.stringify(ac11.lines)}`);
});

test('good tips-off bundle yields verdict APPROVED', () => {
    const runDir = makeBundle({
        lines: [
            { prefab: 'gaoxiong_7', action: 'touch_head', x: 1, y: 2, expectedAction: 'touch_head', lastTap: 'touch_head', tips: false, pass: true },
            { prefab: 'gaoxiong_7', action: 'touch_body', x: 3, y: 4, expectedAction: 'touch_body', lastTap: 'touch_body', tips: false, pass: true },
            { prefab: 'gaoxiong_7', action: 'touch_special', x: 5, y: 6, expectedAction: 'touch_special', lastTap: 'touch_special', tips: false, pass: true },
        ],
    });
    const { verdict, checks } = reviewEvidence(runDir);
    assert.equal(verdict, 'APPROVED');
    for (const ac of ['AC-1.1', 'AC-1.2', 'AC-1.3']) {
        const c = checks.find(x => x.ac === ac);
        assert.ok(c && c.ok, `${ac} must pass, got ${JSON.stringify(c)}`);
        assert.ok(c.lines.length > 0, `${ac} must cite per-AC line refs`);
    }
});

test('incomplete log bundle with good probe yields verdict CHANGES', () => {
    const runDir = makeBundle({
        lines: [
            { prefab: 'gaoxiong_7', action: 'touch_head', x: 1, y: 2, expectedAction: 'touch_head', lastTap: 'touch_head', tips: false, pass: true },
        ],
        logFiles: LOG_FILES.filter(n => n !== 'wallpaper'),
    });
    const { verdict, checks } = reviewEvidence(runDir);
    assert.equal(verdict, 'CHANGES');
    const logs = checks.find(c => c.ac === 'logs');
    assert.ok(logs && logs.ok === false, 'logs check must fail when bundle incomplete');
    assert.ok(logs.lines.some(l => l.includes('wallpaper')), 'logs check must name the missing file');
});

test('clobbered probe evidence (no action fields) yields verdict FAIL', () => {
    // Task 1 isolation test writes {"ok":true} into probe/result.json (progress.md);
    // the reviewer must treat that as FAIL, not a silent pass.
    const runDir = makeBundle({ lines: [{ ok: true }] });
    const { verdict } = reviewEvidence(runDir);
    assert.equal(verdict, 'FAIL');
});
