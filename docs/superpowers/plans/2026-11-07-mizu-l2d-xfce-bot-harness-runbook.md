# Runbook: XFCE Bot Harness (Task 5 appendix)

Short appendix to `2026-11-07-mizu-l2d-xfce-bot-harness.md` (plan), not a second plan.
Gates `docs/PARITY-SPEC.md` AC-1.1 / AC-1.2 / AC-1.3 (BUG-1, tips-off clicks).
Verified 2026-11-07: reviewer verdict `APPROVED` on fresh `gaoxiong_7` evidence
(Task 2 probe 3/3 zones `touch_head touch_body touch_special` == Task 3 headless).

## Evidence layout

All evidence under `~/.hermes/cache/scratch/mizu-xfce-run-YYYYMMDD/` (per-bot subdirs):

| Path | Producer |
|---|---|
| `probe/result.json` (JSON lines `{prefab,action,x,y,expectedAction,lastTap,tips,pass}`) + `probe/xfce_click_probe.png` | Probe bot (Task 2) |
| `logic/` (Task 3: headless stdout, no file required) | Logic bot (Task 3) |
| `logs/{wall.log,journal.txt,env.txt,tokens.json,wallpaper}` | Log bot (Task 4, `collect_logs.sh`) |
| `review/verdict.json` | Reviewer (Task 5, `reviewer.mjs`) |

## Verbatim sequence (run in this order inside the worktree)

```bash
# 0. Preconditions: isolated Bot Desktop + gitignored symlinks (see below).
#    Log in from the Bot Desktop env; never the user's niri session (wayland-1).

# 1. Guard + evidence layout (Task 1). NOTE: this test writes {"ok":true} into
#    probe/result.json (fixture collision, see traps) — run it BEFORE the probe.
node --test tests/xfce/isolation_guard.test.mjs

# 2. Log collector test (Task 4, tmpdir-hermetic, safe any time).
node --test tests/xfce/collect_logs.test.mjs

# 3. Probe bot: fresh XFCE click parity, MUST run after the isolation test.
DISPLAY=:20 XDG_CONFIG_HOME=$HOME/.hermes/bot-desktop/xdg \
  node tests/xfce/xfce_click_probe.mjs gaoxiong_7

# 4. Log bot: read-only bundle (always exit 0).
bash tests/xfce/collect_logs.sh ~/.hermes/cache/scratch/mizu-xfce-run-20261107/logs

# 5. Logic bot regression baseline (Task 3, headless only).
node --test tests/unit/
node tests/probe/p0_tips_off.mjs gaoxiong_7
node tests/probe/p0_busy.mjs gaoxiong_7

# 6. Reviewer gate (Task 5). Re-run step 3 first if result.json is {"ok":true}.
node --test tests/xfce/reviewer.test.mjs
node tests/xfce/reviewer.mjs ~/.hermes/cache/scratch/mizu-xfce-run-20261107
# Exit 0 = APPROVED. Exit 1 = CHANGES/FAIL (read per-AC lines; re-run the
# failing bot, never edit the test to pass).

# 7. Commit with explicit paths only (never `git add -A`; see web/data trap).
git add tests/xfce/reviewer.mjs tests/xfce/reviewer.test.mjs \
        docs/superpowers/plans/2026-11-07-mizu-l2d-xfce-bot-harness-runbook.md
git commit -m "docs(xfce): reviewer checklist and subagent runbook"
git status --short   # must show only ?? web/data (untracked, never staged)
```

## Reviewer checks (`tests/xfce/reviewer.mjs`)

| Check | Spec | Rule | Fail tier |
|---|---|---|---|
| AC-1.1 | PARITY-SPEC AC-1.1 | `lastTap === action` per zone with `tips:false` (dense skins may use `expectedAction` coverage, same rule as `p0_tips_off.mjs`) | FAIL |
| AC-1.2 | PARITY-SPEC AC-1.2 | Same zones tips on/off: probe measures zones tips-ON (phase 1) then clicks tips-OFF (phase 2); every record must have `tips:false` | FAIL |
| AC-1.3 | PARITY-SPEC AC-1.3 | Fresh-load tips-off immediate accept: first record (phase-2 fresh load) must fire with `tips:false` | FAIL |
| AC-3.1 | PARITY-SPEC AC-3.1 | No `main_1..4` dialogue regression: any `main_*` record has `lastTap === action`, and `web/dialogue.js` `keyForAction` regex maps `main_1 -> main1` (behavioral `RegExp` test, not string match) | FAIL |
| logs | plan Task 5 | All 5 `logs/` files present and non-empty | CHANGES |
| screenshot | plan Task 2 | `probe/xfce_click_probe.png` present and non-empty | CHANGES |

Verdict: any FAIL-tier check failed → `FAIL` (exit 1); only logs/screenshot
incomplete → `CHANGES` (exit 1); all checks pass → `APPROVED` (exit 0). Every
check prints per-AC line refs (`probe/result.json:<line>`, `web/dialogue.js:<line>`,
`logs/<name>`, …). `reviewEvidence(runDir)` is exported pure (no writes) for
`node:test`; only the CLI writes `review/verdict.json`.

## Traps (do not rediscover these)

- **Fixture clobber:** `isolation_guard.test.mjs` uses the real scratch dir and
  overwrites `probe/result.json` with `{"ok":true}`. From `progress.md`: "Task 5
  must use fresh evidence, not mutated result.json." Always re-run the probe
  (step 3) after the isolation test, and reviewer-verdict `FAIL` on
  `{"ok":true}` is correct behavior (missing `action`/`lastTap`), not a bug.
- **`web/data` symlink untracked:** the worktree carries gitignored symlinks
  `web/vendor/live2dcubismcore.min.js`, `web/assets`, `web/data` (sync shows
  `?? web/data` because the directory ignore rule does not match a symlink to a
  directory). Recreate them from `task-2-report.md` if the worktree is rebuilt;
  never `git add -A`. Stage named files only.
- **Display isolation:** `DISPLAY=:20` + `XDG_CONFIG_HOME=$HOME/.hermes/bot-desktop/xdg`
  in every bot env; the probe's `assertIsolated` fails before any server/browser
  start otherwise. Never open the user's niri `wayland-1` workspace, never `sudo`,
  never touch `~/.config/niri`, dotfiles, or the Plasma `files.sha256` baseline.
- **Pointer proof scope:** clicks are headed-Chromium CDP `Input.dispatchMouseEvent`
  into the XFCE window on `:20` (same mechanism `p0_tips_off.mjs` proves headless).
  OS-level pointer injection is out of scope unless a future task explicitly
  requires it; the JSON lines carry the `(x, y)` pixels for such a re-check.
- **Reviewer test hermeticity:** `reviewer.test.mjs` uses tmpdir bundles only;
  it never calls `createEvidenceDir` and never touches the real run dir.
