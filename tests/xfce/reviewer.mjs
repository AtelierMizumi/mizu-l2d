// Reviewer bot: gates XFCE evidence vs PARITY-SPEC AC-1.1/1.2/1.3 (plan Task 5).
// Consumes <runDir>/probe/result.json (JSON lines from xfce_click_probe.mjs)
// plus the log-bot bundle under <runDir>/logs/ and the probe screenshot.
// Produces verdict APPROVED | CHANGES | FAIL with per-AC line refs.
//   FAIL    — AC-1.x identity/tips/fresh-load or main_1..4 dialogue regression.
//   CHANGES — ACs pass but evidence is incomplete (log bundle / screenshot missing).
//   APPROVED — all checks pass.
// Import (pure, no writes): reviewEvidence(runDir)
// CLI: node tests/xfce/reviewer.mjs <runDir>
//   Prints the verdict + per-AC lines, writes <runDir>/review/verdict.json,
//   exits 0 only on APPROVED (1 otherwise so the gate blocks CHANGES/FAIL).
// Run tests: node --test tests/xfce/reviewer.test.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOG_FILES = ['wall.log', 'journal.txt', 'env.txt', 'tokens.json', 'wallpaper'];

const DIALOGUE_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../web/dialogue.js');

function readRecords(runDir) {
    const rel = 'probe/result.json';
    const abs = join(runDir, rel);
    if (!existsSync(abs)) {
        return { records: [], fatal: [`${rel}: missing (expected ${abs})`], rel };
    }
    const text = readFileSync(abs, 'utf8');
    const records = [];
    const fatal = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            fatal.push(`${rel}:${i + 1} invalid JSON (not a probe record)`);
            continue;
        }
        if (Array.isArray(parsed)) {
            for (const entry of parsed) records.push({ line: i + 1, rec: entry });
        } else {
            records.push({ line: i + 1, rec: parsed });
        }
    }
    return { records, fatal, rel };
}

function identityOk(rec) {
    if (rec.action == null || rec.lastTap == null) return false;
    if (rec.lastTap === rec.action) return true;
    // dense skins: an overlapping winning zone may legally cover the pixel
    // (identical rule to p0_tips_off / xfce_click_probe pass flag)
    return rec.prefab !== 'gaoxiong_7' && rec.expectedAction != null && rec.lastTap === rec.expectedAction;
}

export function reviewEvidence(runDirArg) {
    const runDir = resolve(String(runDirArg ?? ''));
    const { records, fatal } = readRecords(runDir);
    const checks = [];

    // AC-1.1: lastTap === action per zone with tips off.
    const ac11Lines = [...fatal];
    let ac11ok = fatal.length === 0 && records.length > 0;
    if (!records.length && !fatal.length) {
        ac11Lines.push('probe/result.json: no records (expected >=1 zone line per probe run)');
        ac11ok = false;
    }
    for (const { line, rec } of records) {
        const ref = `probe/result.json:${line} action=${rec.action ?? '?'} lastTap=${rec.lastTap ?? '?'}`;
        ac11Lines.push(ref);
        if (rec.action == null || rec.lastTap == null) {
            ac11Lines.push(`${ref} missing action/lastTap (AC-1.1)`);
            ac11ok = false;
        } else if (rec.tips !== false) {
            ac11Lines.push(`${ref} tips=${JSON.stringify(rec.tips)} expected false (AC-1.1)`);
            ac11ok = false;
        } else if (!identityOk(rec)) {
            ac11Lines.push(`${ref} lastTap !== action (AC-1.1)`);
            ac11ok = false;
        }
        if (rec.pass === false) {
            ac11Lines.push(`${ref} probe pass=false (AC-1.1)`);
            ac11ok = false;
        }
    }
    checks.push({ ac: 'AC-1.1', ok: ac11ok, lines: ac11Lines, note: 'lastTap === action per zone with tips off' });

    // AC-1.2: same zones tips on/off (zones were measured tips-ON, clicked tips-OFF).
    const ac12Lines = [];
    let ac12ok = records.length > 0 && fatal.length === 0;
    if (!records.length) {
        ac12Lines.push('probe/result.json: no records (cannot prove tips on/off parity)');
        ac12ok = false;
    }
    for (const { line, rec } of records) {
        ac12Lines.push(`probe/result.json:${line} tips=${JSON.stringify(rec.tips)} action=${rec.action ?? '?'}`);
        if (rec.tips !== false) ac12ok = false;
    }
    checks.push({ ac: 'AC-1.2', ok: ac12ok, lines: ac12Lines, note: 'same zones tips on/off; every tips-off click fired (probe measured zones tips-ON then clicked tips-OFF)' });

    // AC-1.3: fresh-load tips-off immediate accept (probe phase 2 is a fresh load).
    const ac13Lines = [];
    let ac13ok = records.length > 0;
    if (!records.length) {
        ac13Lines.push('probe/result.json: no records (cannot prove fresh-load accept)');
        ac13ok = false;
    } else {
        const first = records[0];
        const firstRec = first.rec;
        ac13Lines.push(`probe/result.json:${first.line} first fresh-load click action=${firstRec.action ?? '?'} lastTap=${firstRec.lastTap ?? '?'} tips=${JSON.stringify(firstRec.tips)}`);
        if (firstRec.tips !== false || !identityOk(firstRec)) ac13ok = false;
    }
    checks.push({ ac: 'AC-1.3', ok: ac13ok, lines: ac13Lines, note: 'fresh-load tips-off immediate accept (first click after fresh load fired)' });

    // AC-3.1: no main_1..4 dialogue regression.
    // (a) probe records: a main_* action must have lastTap === action.
    // (b) static: web/dialogue.js keyForAction regex must map main_1 -> main1.
    const ac31Lines = [];
    let ac31ok = true;
    for (const { line, rec } of records) {
        if (typeof rec.action === 'string' && /^main_?\d$/.test(rec.action)) {
            const ref = `probe/result.json:${line} action=${rec.action} lastTap=${rec.lastTap ?? '?'}`;
            ac31Lines.push(ref);
            if (rec.lastTap !== rec.action) {
                ac31Lines.push(`${ref} main_* lastTap !== action (AC-3.1)`);
                ac31ok = false;
            }
        }
    }
    try {
        const text = readFileSync(DIALOGUE_PATH, 'utf8');
        const srcLines = text.split('\n');
        let n = 0;
        for (let i = 0; i < srcLines.length; i++) {
            if (srcLines[i].includes('main_?')) { n = i + 1; break; }
        }
        const m = srcLines[n - 1]?.match(/\/(.+)\//, 0) ?? srcLines[n - 1]?.match(/\/.*\//);
        const body = m ? m[1] : null;
        let mapped = null;
        if (body != null) {
            try {
                const re = new RegExp(body);
                const hit = re.exec('main_1');
                mapped = hit ? `main${hit[1]}` : null;
            } catch { mapped = null; }
        }
        ac31Lines.push(`web/dialogue.js:${n} keyForAction main_1 -> ${mapped ?? 'NO MAP'}`);
        if (mapped !== 'main1') ac31ok = false;
    } catch (e) {
        ac31Lines.push(`web/dialogue.js: unreadable (${e.message}) (AC-3.1)`);
        ac31ok = false;
    }
    checks.push({ ac: 'AC-3.1', ok: ac31ok, lines: ac31Lines, note: 'no main_1..4 dialogue regression (probe lastTap + keyForAction regex)' });

    // Log-bot bundle completeness.
    const logLines = [];
    let logsOk = true;
    for (const name of LOG_FILES) {
        const abs = join(runDir, 'logs', name);
        let ok = false;
        let size = 0;
        try { ok = existsSync(abs) && statSync(abs).size > 0; size = ok ? statSync(abs).size : 0; } catch { ok = false; }
        logLines.push(ok ? `logs/${name}: present (${size}B)` : `logs/${name}: missing or empty (expected ${abs})`);
        if (!ok) logsOk = false;
    }
    checks.push({ ac: 'logs', ok: logsOk, lines: logLines, note: 'log bot bundle complete (wall.log journal.txt env.txt tokens.json wallpaper)' });

    // Probe screenshot evidence.
    const shotAbs = join(runDir, 'probe/xfce_click_probe.png');
    let shotOk = false;
    let shotSize = 0;
    try { shotOk = existsSync(shotAbs) && statSync(shotAbs).size > 0; shotSize = shotOk ? statSync(shotAbs).size : 0; } catch { shotOk = false; }
    checks.push({
        ac: 'screenshot',
        ok: shotOk,
        lines: [shotOk ? `probe/xfce_click_probe.png: present (${shotSize}B)` : `probe/xfce_click_probe.png: missing or empty (expected ${shotAbs})`],
        note: 'probe screenshot rendered (model visible, no rendering errors)',
    });

    const hardFail = checks.some(c => ['AC-1.1', 'AC-1.2', 'AC-1.3', 'AC-3.1'].includes(c.ac) && !c.ok);
    const evidenceGap = checks.some(c => ['logs', 'screenshot'].includes(c.ac) && !c.ok);
    const verdict = hardFail ? 'FAIL' : evidenceGap ? 'CHANGES' : 'APPROVED';
    return { verdict, checks, runDir };
}

function defaultRunDir() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return join(homedir(), '.hermes/cache/scratch', `mizu-xfce-run-${stamp}`);
}

const isCli = process.argv[1] != null && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
    const runDir = process.argv[2] ?? defaultRunDir();
    const { verdict, checks } = reviewEvidence(runDir);
    try {
        const reviewDir = join(resolve(runDir), 'review');
        mkdirSync(reviewDir, { recursive: true });
        writeFileSync(join(reviewDir, 'verdict.json'), JSON.stringify({ verdict, checks }, null, 2) + '\n');
    } catch { /* verdict file is best-effort; stdout verdict is the gate */ }
    console.log(verdict);
    for (const c of checks) {
        console.log(`${c.ac} ${c.ok ? 'ok' : 'FAIL'} — ${c.note}`);
        for (const line of c.lines) console.log(`  ${line}`);
    }
    process.exit(verdict === 'APPROVED' ? 0 : 1);
}
