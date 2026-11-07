// Evidence layout for XFCE Bot harness runs (plan Task 1).
// All evidence lives under ~/.hermes/cache/scratch/mizu-xfce-run-YYYYMMDD/
// with one subdirectory per bot role: probe/ logic/ logs/ review/.
// Run: node --test tests/xfce/isolation_guard.test.mjs
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const EVIDENCE_BASE = join(homedir(), '.hermes/cache/scratch');
export const EVIDENCE_SUBDIRS = ['probe', 'logic', 'logs', 'review'];

/**
 * Create (or reuse) the evidence dir for a run date and its bot subdirs.
 * @param {string} dateStr 'YYYYMMDD' (a 'YYYY-MM-DD' value is normalized)
 * @returns {string} absolute path of the run dir
 */
export function createEvidenceDir(dateStr) {
    const stamp = String(dateStr).replace(/-/g, '');
    if (!/^\d{8}$/.test(stamp)) {
        throw new Error(`createEvidenceDir: dateStr must be YYYYMMDD, got ${JSON.stringify(dateStr)}`);
    }
    const dir = join(EVIDENCE_BASE, `mizu-xfce-run-${stamp}`);
    for (const sub of EVIDENCE_SUBDIRS) {
        mkdirSync(join(dir, sub), { recursive: true });
    }
    return dir;
}

/**
 * Persist evidence files. fileMap is { destAbsPath: srcOrContent }:
 * - string value that is an existing file -> copied to dest
 * - otherwise the value is written as file content
 * Parent dirs are created as needed. Only explicit dest paths are written.
 * @param {Record<string, string|Buffer|Uint8Array>} fileMap
 * @returns {string[]} absolute paths written, in insertion order
 */
export function collectEvidence(fileMap = {}) {
    const written = [];
    for (const [dest, src] of Object.entries(fileMap)) {
        const destAbs = resolve(dest);
        mkdirSync(dirname(destAbs), { recursive: true });
        if (typeof src === 'string' && existsSync(src) && statSync(src).isFile()) {
            copyFileSync(src, destAbs);
        } else {
            writeFileSync(destAbs, src ?? '');
        }
        written.push(destAbs);
    }
    return written;
}
