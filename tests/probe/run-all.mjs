// One-command AC verification (PARITY-PLAN Task 12, AC-7.1): drives every
// interaction probe against the mirrored catalog and aggregates results.
// Run: node tests/probe/run-all.mjs   (needs ~/.local/share/mizu/l2d assets)
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const RUNS = [
    { ac: 'AC-1.x/1.3 tips-off clicks (gaoxiong_7)', cmd: ['p0_tips_off.mjs', 'gaoxiong_7'] },
    { ac: 'AC-1.1 tips-off clicks (antu_2)', cmd: ['p0_tips_off.mjs', 'antu_2'] },
    { ac: 'AC-1.1 tips-off clicks (benningdun_2)', cmd: ['p0_tips_off.mjs', 'benningdun_2'] },
    { ac: 'AC-2.1/2.2/2.4 busy gate (antu_2)', cmd: ['p0_busy.mjs', 'antu_2'] },
    { ac: 'AC-2.1/2.2/2.4 busy gate (benningdun_2)', cmd: ['p0_busy.mjs', 'benningdun_2'] },
    { ac: 'AC-4.1/4.2/4.3 drift+reset (wuqi_3)', cmd: ['p0_drift.mjs', 'wuqi_3', '2'] },
    { ac: 'AC-4.1 drift+reset (benningdun_2)', cmd: ['p0_drift.mjs', 'benningdun_2', '2'] },
    { ac: 'AC-4.1 drift+reset (gaoxiong_7)', cmd: ['p0_drift.mjs', 'gaoxiong_7', '2'] },
    { ac: 'AC-5.1/5.2/5.3/5.7/5.8 engine (antu_2+)', cmd: ['p1_engine.mjs', 'all'] },
    { ac: 'AC-5.4 param drags + AC-5.5 xiaqi cells', cmd: ['p1_drag.mjs', 'all'] },
    { ac: 'Review Focus 5 model switch resets engine state', cmd: ['p1_switch.mjs'] },
    { ac: 'Phase 3 pause/resume and synthetic tap control', cmd: ['p2_pause.mjs'] },
];

let failed = 0;
const results = [];
for (const r of RUNS) {
    const proc = spawnSync('node', [join(HERE, r.cmd[0]), ...r.cmd.slice(1)], {
        encoding: 'utf8', timeout: 420000,
    });
    const ok = proc.status === 0;
    if (!ok) {
        failed++;
        console.error(`=== FAILURE OUTPUT FOR ${r.ac} ===\n${proc.stdout}\n${proc.stderr}\n=== END ===`);
    }
    results.push({ ac: r.ac, ok, tail: (proc.stdout || '').trim().split('\n').filter(Boolean).pop() ?? (proc.stderr || '').trim().split('\n').pop() ?? '' });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${r.ac}`);
}
console.log('\n=== AC sweep summary ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.ac}`);
console.log(failed === 0 ? `\nALL ${results.length} AC PROBES PASS` : `\n${failed}/${results.length} AC PROBES FAILED`);
process.exit(failed === 0 ? 0 : 1);
