// Interaction capability census (PARITY-PLAN Task 13, AC-5.6): run the engine
// zone registry over every mirrored prefab and compare against index.json.
// Output: /tmp/mizu-parity-evidence/census.json + a readable summary.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import vm from 'node:vm';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
globalThis.window = globalThis;
vm.runInThisContext(readFileSync(join(REPO, 'web/engine/zones.js'), 'utf8'));
const { buildZones } = globalThis.window.MizuEngine;

const ASSETS = join(homedir(), '.local/share/mizu/l2d');
const index = JSON.parse(readFileSync(join(REPO, 'web/data/l2d_index.json'), 'utf8'));
const prefabs = readdirSync(ASSETS).filter((p) => !p.startsWith('.') && !p.startsWith('bg'));

// Drawable ids live inside the moc3 binary string table — the same trick the
// R1a.4 verification used. This is a superset (part/param names too), which is
// fine for a census: the runtime engine gets the authoritative list from the
// loaded model.
function mocDrawableNames(prefab) {
    try {
        const buf = readFileSync(join(ASSETS, prefab, `${prefab}.moc3`));
        const text = buf.toString('latin1');
        const names = new Set();
        for (const m of text.matchAll(/[\x20-\x7e]{4,}/g)) {
            for (const tok of m[0].split(/[^A-Za-z0-9_.]/)) {
                if (tok.length >= 3) names.add(tok);
            }
        }
        return [...names];
    } catch {
        return [];
    }
}

const rows = [];
const triggerHistogram = {};
const exclusions = [];
for (const prefab of prefabs.sort()) {
    let skins = null;
    try {
        skins = JSON.parse(readFileSync(join(ASSETS, prefab, 'skins.json'), 'utf8'));
    } catch { /* skins.json optional */ }
    const drawableIds = mocDrawableNames(prefab);
    const flags = index.skins?.[prefab] ?? {};
    const r = buildZones({ skins, flags, drawableIds, motionGroups: [] });
    for (const z of [...r.zones, ...r.paramListeners]) {
        const t = z.trigger ? z.trigger.type : 'none';
        triggerHistogram[t] = (triggerHistogram[t] ?? 0) + 1;
    }
    const expected = typeof flags.hotspots === 'number' ? flags.hotspots : null;
    const registered = r.zones.length;
    const row = {
        prefab,
        drags: r.meta.total,
        zonesWithDrawable: registered,
        paramOnly: r.paramListeners.length,
        indexHotspots: expected,
        match: expected === null ? 'no-index-entry' : (registered + r.paramListeners.length === expected ? 'match' : 'MISMATCH'),
    };
    if (row.match === 'MISMATCH') exclusions.push(row);
    rows.push(row);
}

const summary = {
    generatedAt: new Date().toISOString(),
    prefabs: rows.length,
    withDrags: rows.filter((r) => r.drags > 0).length,
    totalDrags: rows.reduce((a, r) => a + r.drags, 0),
    triggerHistogram,
    mismatches: exclusions.length,
};
mkdirSync('/tmp/mizu-parity-evidence', { recursive: true });
writeFileSync('/tmp/mizu-parity-evidence/census.json', JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (exclusions.length) {
    console.log('--- mismatches (first 10) ---');
    for (const m of exclusions.slice(0, 10)) console.log(JSON.stringify(m));
}
process.exit(0);
