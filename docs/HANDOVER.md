# mizu-l2d — Handover (2026-10-29)

Written for: the next coding agent continuing this project (for example GLM 5.3 flash or
Claude), and the owner who reads along. The owner speaks Vietnamese; this document is in
English per CLAUDE.md rule 6.

Read in this order before doing anything:
1. This file.
2. `CLAUDE.md` (agent rules, authoritative).
3. `docs/SPEC.md` (product spec v3, §12 decisions and amendment).
4. `docs/PLAN.md` (§0 resume protocol, §5 data formats, §6 pitfalls, §8 work units).
5. `STATUS.md` (state ledger, discoveries log).

## 1. Owner and environment

- Owner: Minh Thuận Trần. Personal use now. Wants a clean, reusable public extension later.
- Machine: Arch Linux, niri (Wayland), KDE Plasma installed. Two outputs, `eDP-1` and
  `HDMI-A-1`, 1920×1080 @144 Hz. CPU Intel i5-12500H. GPUs: Intel Iris Xe (integrated)
  and NVIDIA RTX 3050 Mobile.
- The agent's sandbox CANNOT: open a Wayland or X display, reach `cdn.jsdelivr.net`,
  `data.nagami.moe`, `azlassets.nagami.moe`, `azurlane.nagami.moe` or `live2d.com`, use sudo,
  or talk to a unix socket. Anything in that list must be handed to the owner as a command
  block, with the expected output described. (Update 2026-10-29, R0.2 unit: a later
  sandbox DID reach `cdn.jsdelivr.net` — re-test network assumptions per session.)
- The owner runs commands on the desktop. Before any test that changes the live desktop,
  follow CLAUDE.md rule 7: switch to an empty workspace first, restore afterwards.

## 2. What the project is

A Live2D character (Azur Lane models for personal use) rendered as an interactive desktop
background on niri, one surface per output, on the background layer.

- P0 (now): niri reference host. Engine = web page (pixi.js 6.5.10 +
  pixi-live2d-display 0.4.0, WebGL) hosted in WebKitGTK 6.0 inside a gtk4-layer-shell
  window. Python/PyGObject shell (SPEC §4.2).
- Later: other compositors and desktop environments through thin host adapters
  (SPEC §3 tiers, §5 host contract).
- Native C++ Cubism renderer (`src/model/`) is parked (PLAN §9-P). It builds with the
  Cubism SDK (`CUBISM_AVAILABLE=1`) and loads models, but the rest pose renders wrong.
  Do not resume it without a reason. Note: its performance may still be measured (S0-perf).

## 3. Current goal (owner's latest request)

Build a selection UI with preview. The user picks a Live2D model, and it is downloaded on
demand. Nothing is mass-downloaded.

Done when:
- the chosen model is visible on the user's desktop wallpaper, and
- it is interactive there.

Success metric (owner-confirmed):
- Loading: 99 of 100 random loads succeed. Pick a random model from the catalog each time.
  Retries count as attempts; a load fails only if it still fails after retries.
- Interaction: a hotspot triggers its mapped motion; no motion gets stuck; no crash after
  100 interactions; switching models leaks no GL resources.

Constraints:
- Catalog and on-demand download live in this repo while it stays local (SPEC §12
  amendment). Before any push or public release, move them to the private overlay, or
  revert the amendment. Content never enters git.
- Host choice waits for S0-perf (SPEC §12 item 6).
- Process: `mattpocock-skills:tdd`. The seams S1–S6 must be confirmed by the owner before
  any test is written. The owner has NOT yet explicitly confirmed them (see §7, step O4).

## 4. Locked decisions

From SPEC §12 (owner approved the recommendations, 2026-10-29):
- D-L1: engine license MIT. Add `LICENSE` before the first public release.
- D-L2: Azur Lane content, converters and fetch scripts stay out of the public repo.
  Amended for this repo while it is local (see §3). Gate before publishing.
- D-N1: name stays `mizu-l2d`. README must say the project is unaffiliated with Manjuu or
  Yostar. No Azur Lane branding in the public name or logo.
- D-S1: run spikes S5 (KWin layer-shell) and S6 (Plasma native) before committing to any
  tier 2–5 environment.
- D-P1: standalone repo is canonical. A dotfiles submodule is a convenience only, and needs
  a GitHub remote first (not created; needs its own confirmation).
- S0-perf: measure WebKitGTK 6.0 against the native daemon before R2.

From PLAN §4 (not to be re-argued without new evidence):
- D-R1 web viewer; D-R2 Python/GTK shell (now WebKitGTK **6.0**, see §5); D-IPC WebSocket
  control plane; D-HIT hotspots via drawable names; D-SCALE calibration empirical;
  D-THROTTLE idle FPS ramp in the page.

## 5. Done so far

Commits (branch `master`, repo has no remote):
- `7d937ef chore: baseline skeleton, spikes, docs` (R0.1, 35 files, explicit paths).
- `6396616 fix(model): verify moc3 and confine model3.json paths`.

Verified facts:
- Stack: `webkit2gtk-4.1` links GTK3; `gtk4-layer-shell` links GTK4 only. The reference
  host must use `webkitgtk-6.0` (GTK4). NOT installed yet (owner step O1).
- Assets in `~/.local/share/mizu/l2d/`:
  - `abeikelongbi_3`: 14 motion groups, moc3 present, consistent.
  - `aersasi_3`: 82 motion groups, 44 `touch_idle` groups (IDs 1–47 with gaps at 16, 20,
    21), 21 idle groups, `skins.json` with 66 drag entries (65 distinct part names, 9 drags
    with no trigger). moc3 (8,543,360 bytes) fetched by the owner; Cubism Core reports
    `consistent=1`; all 86 model3.json references exist.
- Hotspot triggers: every named trigger action maps to an existing motion group.
- pixi.js and pixi-live2d-display LICENSE pages show MIT (checked on GitHub).
- Cubism Core `csmHasMocConsistency`: real moc3 passes; truncated and corrupted copies fail.

Code and tooling state:
- `src/model/model_runtime.cpp`: moc3 loads with `LoadModel(moc, msz, true)`. Model3
  references (texture, physics, motion) must be relative and contain no `..`
  (`is_safe_rel`). A standalone copy of the helper passed 9/9 cases.
- `scripts/fetch-model.sh <model> [dest]`: now fetches `FileReferences.Moc` (it was missing)
  and refuses `..` or absolute paths from the remote model3.json.
- `spikes/s0-perf/` (committed in this handover, see §8):
  - `webkit_bench_gtk4.py`: side A, WebKitGTK 6.0 page. Modes `blank`, `idle`, `animated`.
    Not yet run. Needs `webkitgtk-6.0`.
  - `native_measure.sh`: side B, native daemon. Modes `model` and `placeholder`. Uses
    `mizu-l2d-ctl perf` (fps, p50, p95, rss_kb). Its failure path was tested in the sandbox.
    Not yet run on a live session.
- Build: `ninja -C build` green. `bash -n` passes for every script.

Docs:
- `docs/SPEC.md`: v3 draft, approved decisions, amendment.
- `docs/PLAN.md`: §1, §7 banners point to SPEC. Fixed: R0.1 explicit paths; R0.2 vendors
  only MIT libraries and keeps nagami data and Cubism Core out of git; §3, D-R2 and R2a.1
  use WebKitGTK 6.0; aersasi_3 counts corrected.
- `README.md`: direction paragraph updated (the old "native, no webview" text was wrong).
- `dotfiles/docs/research/mizu-l2d-tech-design.md`: superseded banner added. That repo is
  the owner's, and the change there is NOT committed.

## 6. Known gaps and risks

- Live2D license terms not verified. `live2d.com` is blocked in the sandbox. Read
  https://live2d.com/eula/live2d-proprietary-software-license-agreement_en.html before any
  public release (SPEC §9).
- Layer-shell support per compositor comes from secondary sources (Kitty docs). KWin, sway,
  labwc and river still need spikes.
- Plasma wallpaper API and Windows WorkerW behavior are unconfirmed (spikes S6, S8).
- pixi-live2d-display 0.4.0 compatibility with the moc3 version of each model is NOT
  verified. Run the model in a real browser and read the console.
- Security, open: `read_all` in `model_runtime.cpp` has no size cap, and stb decoders
  parse untrusted PNGs. Add limits for content packs before any public release (SPEC §4.3).
- Interaction mapping: D-HIT is still empirical. PLAN R1a.4 requires checking whether drag
  `part` names match drawable ids. Some drags (for example `TouchDrag10–14`) have no
  trigger.
- S0-perf is not measured. Side A's `animated` mode uses a synthetic 64×64 mesh, not the
  real Cubism model. Compare like with like: `blank` vs `placeholder` for the floor, and
  real pixi page vs `model` once R0.2–R1 exist.
- GPU use is not measured yet. `intel-gpu-tools` is not installed.
- The native path's `webkit_bench.py` in the scratchpad was a GTK3 version. It is
  superseded by `spikes/s0-perf/webkit_bench_gtk4.py`.
- Repo-local `.claude/` and root device placeholders (`.bashrc`, `.zshrc`, `.idea`,
  `.vscode` and others) stay untracked. They are sandbox artifacts or project config that
  the owner has not decided on yet.

## 7. What to do next (ordered)

Owner-only steps (the agent cannot do these):
- O1. `sudo pacman -S --needed webkitgtk-6.0`
- O2. Run S0-perf, side A, then side B. Paste the output:
  ```
  cd ~/Projects/Tools/mizu-l2d
  for m in blank idle animated; do python3 spikes/s0-perf/webkit_bench_gtk4.py $m; done
  niri msg action focus-workspace-down
  bash spikes/s0-perf/native_measure.sh placeholder
  bash spikes/s0-perf/native_measure.sh model
  niri msg action focus-workspace-up
  ```
  Keep the mouse still. Side A opens a 960×540 window for about 25 s per mode.
- O3. Confirm or change seams S1–S6 (below). Required before any test is written.
- O4. Decide when to commit `spikes/s0-perf` results (they are already committed as tools).
- O5. Fetch the web libraries and the Cubism Core into `~/.local/share/mizu/` once the
  agent writes `scripts/fetch-web-deps.sh` (R0.2).
- O6. Desktop checks for S5 once a host exists.
- O7. Before any push or public release: resolve the D-L2 gate, add `LICENSE` (MIT), and
  read the Live2D license.

Agent steps, in order:
- A1. Get the owner's confirmation of seams S1–S6 (SPEC §4 and this file, §3).
- A2. R0.2: write `scripts/fetch-web-deps.sh`. Pin pixi 6.5.10 and pixi-live2d-display 0.4.0.
  Record sha256 in `web/vendor/SOURCES.md`. Do not fetch nagami data or the Cubism Core into
  the repo. Syntax-check it and state clearly that the sandbox cannot run the download.
- A3. R0.3: write `web/index.html` and `web/main.js`, a pixi scene with transparent
  background. Symlink `web/assets` to `~/.local/share/mizu/l2d` (gitignored). Test with
  `python3 -m http.server 8787 -d web`.
- A4. Render `gaoxiong_7` in the page (R1a.1; test model, never `aersasi_3`). Check the console for errors. Use a browser
  tool if one is connected, or hand a check to the owner.
- A5. TDD slice S1 (catalog): read the manifest, list models, return preview metadata. Test
  with `node:test` (no dependencies). Red, then green, then one slice at a time.
- A6. TDD slice S2 (on-demand fetch): download one model into the cache, then verify all
  references exist and no path escapes the model directory.
- A7. Selection UI with preview (S1, S2 together).
- A8. Interaction (S4): hotspot → mapped motion; motion state checked, not pixels.
- A9. Harness S6: 100 random loads, record success rate, retries included.
- A10. R2 host (after O2): layer-shell surface with WebKitGTK 6.0 on the background layer.
  Then S5 on the desktop.

## 8. Clean up and commit (done in this handover unit)

- Commit `spikes/s0-perf/` (two scripts, no assets, no secrets).
- Commit this file, `docs/PLAN.md` (R0.2 fix), `docs/SPEC.md` (D-L2 amendment), `.gitignore`
  and `STATUS.md`.
- Leave untracked on purpose: `.claude/`, root device placeholders (`.bashrc`, `.zshrc`,
  `.gitconfig`, `.gitmodules`, `.idea`, `.vscode`, `.mcp.json`, `.profile`, `.ripgreprc`,
  `.zprofile`, `.bash_profile`). Stage with explicit paths only; `git add -A` fails on the
  device placeholders (verified).
- Scratchpad: the superseded GTK3 `webkit_bench.py` is removed.
- The dotfiles repo has uncommitted changes (banner in `docs/research/mizu-l2d-tech-design.md`
  and three untracked research files). Not committed here; that repo is the owner's.

## 9. Rules and pitfalls to keep

- Never commit: `build/`, `third_party/cubism/`, any Azur Lane asset, `live2dcubismcore.min.js`,
  nagami data (`web/data/`, `web/assets`), anything matching `.env` or credentials.
- Commits: conventional style, English, no attribution lines (owner instruction, supersedes
  older reminders). Verify with `git diff --cached --stat` before committing.
- Verify before claiming done: run the real build and the real checks, report output.
- PLAN §6 pitfalls still apply. Notably: `MESA_DEBUG=1` first for silent GL failures; the
  frame callback must be committed in the same cycle it is requested; the texture v-flip
  (Unity bottom-up); and an explicit `IpcServer::fd()` bug fixed earlier.
- AGPL code (alg-wiki/AzurLaneL2DViewer) must not be copied (PLAN §7).
- Do not use `rm -rf` on a path built from a variable. The sandbox denied one such command.
  Use `mktemp -d` for scratch, and remove only what you created.
- If the sandbox blocks a host or a socket, do not work around it. Report it and give the
  owner a command.

## 10. Verification commands

```
cd ~/Projects/Tools/mizu-l2d
ninja -C build                       # expect: no work to do (or a clean build)
for f in scripts/*.sh; do bash -n "$f"; done
python3 -c "import ast; ast.parse(open('spikes/s0-perf/webkit_bench_gtk4.py').read())"
git add --dry-run -- <explicit paths>   # never -A
git check-ignore -v build/x third_party/cubism/x web/vendor/live2dcubismcore.min.js web/data/x web/assets
```

Moc consistency check (needs `third_party/cubism/Core/lib/linux/x86_64/libLive2DCubismCore.a`):
compile a C file that calls `csmHasMocConsistency(buffer, size)` on the moc3 bytes, linked
against that library with `-I third_party/cubism/Core/include`. Expect `consistent=1` for
`abeikelongbi_3.moc3` and `aersasi_3.moc3`.
