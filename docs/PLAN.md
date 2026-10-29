# mizu-l2d — Master Execution Plan (v2, post-pivot)

This is the single source of truth for continuing this project. It is written
to be picked up **cold** by any agent or human with no prior conversation
context. Follow §0 before doing anything else.

Project in one sentence: put an Azur Lane Live2D character (with scene
background, touch hotspots, idle poses and mouse-follow) on the niri desktop
background layer as an interactive wallpaper, by porting the approach of the
public web viewer at https://azurlane.nagami.moe/live2d-viewer to a local
Wayland layer-shell surface.

Design research lives in the dotfiles repo:
`~/Projects/Tools/dotfiles/docs/research/mizu-l2d-tech-design.md` (background
and rationale; this PLAN supersedes its renderer decisions — see §13 there).

Researched/verified 2026-10-29 on the target machine.

## 0. How to use this plan (resume protocol)

1. Read this file fully, then `STATUS.md` (repo root) — it records the exact
   state: last completed unit, next unit, known blockers.
2. Run `git -C ~/Projects/Tools/mizu-l2d status` and `ninja -C build` to see
   the working tree and confirm the build is green before changing anything.
3. Execute **exactly one work unit** (§8) — units are sized for one agent
   session. Do not start the next unit unless the current one's acceptance
   criteria are verifiably met.
4. When the unit is done (or blocked):
   a. Update `STATUS.md` (done list, next unit, blockers, discoveries).
   b. Commit with explicit paths (see R0.1; never `git add -A`) — commit
      messages in English, conventional style. **Never commit** `third_party/cubism/`,
      `build/`, or anything under `~/.local/share/mizu/` (gitignore already
      covers build + third_party/cubism; assets live outside the repo).
   c. If you discovered a reusable fact (a pitfall, a data-format detail),
      append it to §6 or §5 of this file.
5. If you run out of time/quota mid-unit: leave the tree building (revert
   broken changes if needed), write what remains in STATUS.md, commit. The
   next agent resumes from there — losing quota mid-unit must not corrupt
   state.

Rule: **never re-litigate decisions in §4** — they were made after empirical
verification documented in the design doc. If a decision is truly broken,
write the case in STATUS.md and stop for human review.

## 1. Goal & non-goals

> **Scope superseded by [docs/SPEC.md](SPEC.md) (v3 draft).** The non-goals below
> (X11, Windows/macOS, public distribution) no longer apply to the public extension.
> The niri goal below remains the P0 reference target.

Goal:
- One Live2D character on the **background layer** of niri, per monitor.
- Full scene background image behind the character (the game's "home" art).
- Interactions like the game: mouse-follow (head/eyes), tap zones → motions
  (`touch_head`/`touch_body`/`touch_special`), the site's hotspot system for
  models that ship it (`skins.json`: 66 drag entries, 65 distinct part names;
  44 `touch_idle` motion groups), idle pose cycling.
- Camera: pan/zoom (pointer drag/wheel on exposed background), reset.
- Model switching; semi-transparent Azur Lane-flavored chrome appears on
  hover only (later phase).
- Smoothness: vsync-driven, idle fps ramp, resource discipline
  (< ~400 MB resident) — measured, not assumed.

Non-goals: multi-model scenes, sound/voice (parked), Windows/macOS, X11,
public distribution of assets.

## 2. Current state (verified 2026-10-29)

Repo: `~/Projects/Tools/mizu-l2d` (git initialized, **no commits yet**).

Exists and works:
- **Spike results** (recorded in design doc §2): S1 PASS — niri delivers
  pointer enter/motion to background-layer surfaces with a full input region
  (`spikes/s1-pointer/main.c`, binary `build/mizu-s1`, also injects cursor
  sweeps via wlr-virtual-pointer which niri supports); S2 PASS — EGL on
  Wayland works, `EGL_EXT_buffer_age` + swap-with-damage present, panel-rate
  frame callbacks (137 Hz on the 144 Hz panels); S4 PASS — AL moc3 drawable
  names are semantic (`Eyes`, `HairFront`, `Face`, `Body`, `TouchIdle1`…).
- **C++ daemon skeleton** (`src/`): per-output background layer surfaces,
  EGL/GLES2 context, vsync frame loop with old∪new-bbox damage discipline,
  idle-fps ramp, TOML config (`~/.config/mizu-l2d/config.toml`, example in
  `docs/config.example.toml`), JSON-lines IPC over
  `$XDG_RUNTIME_DIR/mizu-l2d.sock` + `build/mizu-l2d-ctl`
  (`ping|status|perf|camera [zoom|pos|reset]|motion <group>`), SIGINT clean
  exit. Build: `cmake -B build -G Ninja && ninja -C build` (green).
- **Native Cubism renderer** (`src/model/`, built when
  `third_party/cubism/` exists): loads model3.json/moc3/textures (premultiplied,
  v-flipped)/motions/physics, renders via Cubism SDK for Native 5-r.3 +
  `CSM_TARGET_LINUX_GLES2` vendor patch (`scripts/patch-cubism.sh`). Status:
  **parked with an open bug** — rest pose renders "exploded" (correct texture
  sampling per part, scrambled part layout) even with `MIZU_NO_MOTION=1`.
  Do not resume this without reading §9-P. The web pivot does not depend on
  fixing it.
- **Assets downloaded** to `~/.local/share/mizu/l2d/`:
  - `abeikelongbi_3/` (9.6 MB, 14 motion groups, no hotspots config)
  - `aersasi_3/` (40 MB — Alsace "Tipsy Oni on a Sacred Night": 2 textures,
    82 motion groups incl. 44 `touch_idle` groups, physics, `animator.json`,
    `skins.json` with 66 drags) [counts checked 2026-10-29]
- **Scripts**: `scripts/fetch-model.sh <name>` mirrors a model + its
  interaction data from the nagami CDNs (primary asset source; MilkyLan repo
  is interchangeable for moc/motions); `scripts/fetch-thirdparty.sh` fetches
  Cubism Native SDK (only needed for the parked native path);
  `scripts/patch-cubism.sh` (native path only).
- **Docs**: design research in dotfiles (see above), this PLAN, STATUS.md,
  CLAUDE.md.

Broken/unknown (do not assume otherwise):
- Native renderer rest-pose explosion (open, §9-P).
- WebKitGTK-on-layer-shell has not been tried yet (R2a covers it).
- Exact semantics of some `skins.json` fields are inferred, not verified
  (marked in §5); R1c calibrates empirically against the site.

## 3. Environment & paths

Machine: Arch Linux, niri 26.04 (wlr-layer-shell v1 + wlr-virtual-pointer),
2 outputs `eDP-1` + `HDMI-A-1`, both 1920×1080 @144 Hz, Mesa/Iris Xe,
wayland-1.26. `$WAYLAND_DISPLAY=wayland-1` inside the session.

Toolchain present: gcc/g++ (C++20), cmake+ninja, pkg-config, wayland-scanner,
tomlplusplus 3.4.0, glm, GLEW 2.3.1 (unused post-pivot), grim NOT installed.
For R2a install: `sudo pacman -S --needed webkitgtk-6.0 gtk4-layer-shell`
(GTK4 stack. `webkit2gtk-4.1` links GTK3 and cannot share a process with
gtk4-layer-shell; corrected 2026-10-29.)
(python-gobject is preinstalled on Arch).

Paths:
- Repo: `~/Projects/Tools/mizu-l2d`
- Assets: `~/.local/share/mizu/l2d/<prefab>/`
- Config: `~/.config/mizu-l2d/config.toml`
- IPC socket: `$XDG_RUNTIME_DIR/mizu-l2d.sock`
- dotfiles research docs: `~/Projects/Tools/dotfiles/docs/research/`

Network endpoints (all public, no auth; assets are Manjuu/Yostar IP —
personal local use only):
- Model assets: `https://azlassets.nagami.moe/EN/live2d/<prefab>/...`
- Data layer: `https://data.nagami.moe/live2d/EN/l2d_mapping.json`,
  `.../EN/index.json`, `.../EN/skins/<prefab>.json`
- Backgrounds: `https://azlassets.nagami.moe/EN/bg/star_level_bg_<bg_id>.png`
  (verified 2026-10-29 — the bare `<bg_id>.png` path in the earlier note was
  wrong and 404s; the site applies the image as the stage container's CSS
  background)
- Cubism Web Core (the exact build the site renders with):
  `https://azurlane.nagami.moe/live2dcubismcore.min.js` — mirror it locally;
  do not bundle a different version without re-verifying rendering.
- Fallback asset mirror: `https://github.com/MilkyLan/AzurLane-Live2d`
  (~53 GB repo — never clone fully; use `scripts/fetch-model.sh` or partial
  clone).

## 4. Architecture (v2) — decisions already made

- **D-R1: the viewer is a web page** (pixi-live2d-display + WebGL) rendering
  character + background, driven entirely by locally mirrored nagami data
  files. Verified facts that make this safe: the site renders these exact
  assets in WebGL; all interaction data is public JSON; no frontend source
  needed (site frontend is private — checked GitHub user/repo/code search).
- **D-R2: the wallpaper shell is a Python/GTK app** (`mizu-l2d-wall`,
  PyGObject + WebKitGTK 6.0 + gtk4-layer-shell): one layer-shell window per
  monitor on the `background` layer hosting the page. Rationale: WebKit
  replaces the entire GL/renderer layer; Python keeps the shell trivial;
  the C++ daemon's native renderer is parked (see §9-P) but its IPC protocol,
  input knowledge and perf discipline carry over.
- **D-IPC: control plane is a WebSocket** (`ws://127.0.0.1:<port>`) speaking
  the same JSON command set as the C++ daemon's IPC (`ping|status|camera|
  motion|model|perf`), because page JS cannot reach a unix socket. The
  Python shell owns the socket; the page connects as a client and also
  receives push events (`{"event":"quiet"|"interact"|"camera", ...}`).
- **D-HIT: hotspots are drawable-name hit tests, not model3.json HitAreas**
  (AL models have no HitAreas; the site's `drags[].part` values are
  part/drawable names like `TouchIdle1`). Implementation (R1b): on pointer
  move, convert screen→model coords (pixi inverse transform), iterate
  `model.internalModel.coreModel.drawables.ids` matching drag part names,
  hit-test against that drawable's current `vertexPositions` bbox, then
  `model.motion(group, index, 3)`. Empirical naming check is R1a.4.
- **D-SCALE: skins.json `scale`/`offset` semantics are unverified** — R1c
  calibrates by overlay-comparing our render against a nagami screenshot;
  do not burn time deriving units from first principles.
- **D-THROTTLE: idle fps ramp lives in the page** (rAF skipping on a
  `quiet` push event), not in the compositor/shell.

## 5. Data formats (reverse-engineered 2026-10-29)

### l2d_mapping.json (data.nagami.moe)
`{ "<shipId>": { names: {EN,CN,JP}, skins: [ { prefab, names{...},
servers[], bg } ] } }` — `prefab` = model directory name (e.g. `aersasi_3`),
`bg` = background id (image at `azlassets/EN/bg/<bg>.png`).

### skins/<prefab>.json (data.nagami.moe; mirrored to <model>/skins.json)
Verified keys (aersasi_3):
- `offset: [-136.6, 0]`, `scale: 53` — model placement; units unverified
  (D-SCALE). `newMainOffset`, `profileOffset`, `profileScale` — other view
  modes on the site; ignore for the wallpaper.
- `dragRate: [0.5,0.5,0.5]` — likely mouse-follow smoothing/limits.
- `actions: ["idle","main_1",...,"touch_head"]` — motion groups in use.
- `paraRange: {"ParamAngleX":[-10,10], "ParamAngleY":[-10,10]}` — mouse-follow
  parameter clamps (in-game the head only turns ±10° for this skin).
- `drags: [66 entries]` — the hotspot system. One entry:
  `{ id: 80503201, part: "TouchIdle1", param: "empty", range: [0,1],
     rangeAbs: true, smooth: 0.1, revertSmooth: 0.1, revert: -1,
     limitTime: 1, ignoreAction: true, ignoreReact: true,
     reactCondition: {idleOn: [0]}, trigger: {type: 2, action:
     "touch_idle1"}, idle: 1, enable: [], ignore: [...] }`
  Reading: hovering/clicking the region of part `TouchIdle1` triggers motion
  `touch_idle1`; `idle: N` marks idle-pose candidates; `ignore` lists groups
  during which the hotspot is disabled. Semantics of `trigger.type: 2` (vs
  click vs hover) and `limitTime` are **inferred** — verify by observing the
  site's behavior (R1b acceptance).
- `tips.guide` — UI text on the site; ignore.

### animator.json (azlassets, mirrored to <model>/animator.json)
`{ version: 1, layers: [ { name, blending: "override", weight,
defaultState: "idle", states: { <motionGroup>: { speed, loop,
writeDefaults } } } ] }` — a Unity-Mecanim-like controller. For the
wallpaper the useful subset: which groups `loop` (idle poses) vs one-shot
(touch/main). Full state-machine semantics (transitions/conditions) may
exist deeper in the file — inspect before relying on it.

### model3.json (standard Cubism)
`FileReferences.Motions` = group → motion files; aersasi_3 has 82 groups:
`idle`, `idle1..21` (21 idle poses), 44 `touch_idle` groups (IDs 1–47 with gaps
at 16, 20, 21), `touch_head/body/special`, `main_1..4`, event groups. No
`HitAreas`. Checked 2026-10-29. Hotspot triggers: 57 of the 66 drag entries carry
a `trigger`, and every named trigger action maps to an existing group (9 drags,
e.g. `TouchDrag10–14`, have no trigger).

## 6. Lessons learned / known pitfalls (from the build log — do not rediscover)

Wayland / niri:
1. Attach protocol listeners **at bind time** (inside the registry global
   handler). The first dispatch roundtrip delivers `wl_seat.capabilities` /
   `wl_output.name`; a later attach never sees them. Symptom was total input
   silence, not an error.
2. Never `emplace_back` into a vector whose element addresses are registered
   as listener data. Reserve capacity first — reallocation dangling pointers
   caused a glibc malloc abort.
3. A frame callback must be **committed in the same cycle** it is requested
   (request → draw+swap). Requesting after the swap without a further commit
   deadlocks the loop silently.
4. Full-screen damage every frame defeats compositor damage tracking; the
   damage must be the animated content's old∪new bbox. Assert this in debug.
5. GLEW cannot initialize on a Wayland/EGL-only session (needs GLX) — any
   "desktop GL + GLEW" plan is dead here; use GLES via EGL or WebKit.

Cubism:
6. The Native SDK's Linux path emits `#version 120` desktop-GLSL shaders and
   uses client-side vertex arrays: it cannot run on a GLES3 context (ES3
   removed client arrays) and only works on desktop-GL-compat, which GLEW
   blocks on Wayland (see 5). The GLES2 route required a vendor patch
   (`CSM_TARGET_LINUX_GLES2`, `scripts/patch-cubism.sh`) selecting the
   `#version 100` shader variants + GLES2 headers. All of this is native-path
   only; the web path uses `live2dcubismcore.min.js` + WebGL and is unaffected.
7. Unity Texture2D is bottom-up: extracted atlases need a **vertical flip at
   load** to match Cubism UV convention (v=0 = top row). Without it you get
   correct shapes sampling wrong atlas regions (looked like "exploded black
   blobs"). The web runtime does this the same way (no flip + standard UVs).
8. When Cubism rendering is silently wrong, set `MESA_DEBUG=1` first — Mesa
   pinpoints the failing GL call (`glUniformMatrix(program not linked)` etc.).
   Framework `CubismLogError` output is unreliable until the log handler is
   proven (we saw lost messages).
9. The generated layer-shell C header names a parameter `namespace` — include
   it from C++ under a `#define namespace ...` shim (see `src/app.cpp`).

C++ skeleton (still relevant for IPC/systemd reuse):
10. `IpcServer::fd()` returned the wrong member (never assigned) → IPC
    silently dead while the socket listened. Check fd plumbing when porting.
11. EGL surfaces must be created per output *before* first use; a missing
    `add_output` silently no-ops swaps (surface guard) and stalls frame
    callbacks.

Web/Cubism-web (for R1):
12. Pin `live2dcubismcore.min.js` to the site's copy (proven with these
    models). Newer Cubism cores (5.3+) are known to break
    pixi-live2d-display (its issue #178) — mirror, don't upgrade blindly.
13. pixi-live2d-display auto-interaction (`autoFocus`/`autoHitTest`) is built
    for model3.json HitAreas; AL needs D-HIT instead — disable autoInteract
    and implement the drawable-name hit test.

## 7. Licensing & IP rules

> **Engine licensing superseded by [docs/SPEC.md](SPEC.md) §9.** The rules below
> still apply to all Azur Lane content and to Cubism Core. The engine itself is public.

- All Azur Lane assets (models, textures, motions, backgrounds) are
  Manjuu/Yongshi / Yostar / Bilibili IP: **personal local use only**. Nothing
  asset-like is committed to git; nothing is published.
- `live2dcubismcore.min.js` is Live2D proprietary — mirrored locally by
  script, never committed.
- The nagami site's frontend is private; do not scrape/decompile their JS
  bundles beyond what public network traffic already taught us. Their public
  data files (skins/mapping) are consumed as-is for personal use.
- alg-wiki/AzurLaneL2DViewer and its forks are AGPL — if any code is ever
  copied from there, that code must be released under AGPL. Default: write
  our own page, borrow only conventions.
- pixi-live2d-display and pixi.js are MIT.

## 8. Work units

Each unit: entry condition → steps → acceptance criteria (all must be
objectively checkable) → end-of-unit actions (§0.4). Effort markers:
S = <1 session, M = ~1 session, L = plan for 2+ sessions with commit points.

### R0 — pre-flight (S)
1. `R0.1` Commit the current tree as the baseline. Stage explicit paths only:
   `git add .gitignore CLAUDE.md CMakeLists.txt README.md STATUS.md docs scripts
   spikes src systemd third_party/protocols third_party/stb`, then
   `git commit -m "chore: baseline skeleton, spikes, docs"`. Do not use
   `git add -A`: the repo root holds character-device placeholders (`.bashrc`,
   `.zshrc`, `.idea`, …) and `git add -A` fails on them (verified 2026-10-29).
   `.claude/` stays out until the owner decides what to track.
   *Accept:* `git log` shows the baseline; `git status` lists only `.claude/`
   and the root placeholders; `ninja -C build` green. Requires the owner's OK
   to commit (see STATUS.md).
2. `R0.2` Vendor the MIT web libraries. Keep Azur Lane data and Cubism Core out of git
   (SPEC §12, D-L2 and its amendment):
   - `web/vendor/pixi.min.js` ← jsDelivr pixi.js@6.5.10 browser build (MIT)
   - `web/vendor/pixi-live2d-display.min.js` ← jsDelivr
     pixi-live2d-display@0.4.0 `dist/cubism4.min.js` (MIT; verified 2026-10-29:
     0.4.0 has no `dist/web/`, and the full `dist/index.min.js` bundle hard-fails
     at load without the proprietary Cubism 2 runtime `live2d.min.js` — AL models
     are moc3/Cubism 4, so the cubism4 bundle is the right vendor)
   - Record every URL, version and sha256 in `web/vendor/SOURCES.md`. Commit these.
   - NOT in git: `live2dcubismcore.min.js` (Live2D proprietary) and the nagami data
     (`l2d_mapping.json`, `index.json`, skins). Keep them under `~/.local/share/mizu/`
     and reference them by path at runtime. Gitignore `web/data/` and `web/assets`.
   *Accept:* the two MIT files exist; `SOURCES.md` lists URL, version, sha256; `git
   check-ignore` reports the core, `web/data/` and `web/assets` as ignored.
3. `R0.3` Static server + page scaffold: `web/` with `index.html`,
   `main.js`, and `assets -> ~/.local/share/mizu/l2d` symlink (gitignored); serve with
   `python3 -m http.server 8787 -d web` (same-origin for fetch/CORS-free
   textures). *Accept:* `curl -s localhost:8787/index.html` 200;
   `curl -sI localhost:8787/assets/gaoxiong_7/gaoxiong_7.model3.json` 200.

### R1 — viewer web MVP in a normal browser (M; the core deliverable)
1. `R1a.1` Page renders the model: PIXI app with transparent background;
   `Live2DModel.from('assets/gaoxiong_7/gaoxiong_7.model3.json',
   {autoInteract:false})`; idle motion looping; fit model to ~90% viewport
   height, anchored bottom-center. *Accept:* character visibly renders and
   idles in the browser (screenshot via browser tooling or manual).
2. `R1a.2` Background: load the model's bg via `l2d_mapping.json` (find ship
   by prefab → skins[].bg → mirror `azlassets/EN/bg/<bg>.png` into
   `assets/bg/`; extend fetch-model.sh with a `--bg` step), draw as sprite
   behind the model, cover-fit the viewport. *Accept:* screenshot shows
   character over its scene, like the site.
3. `R1a.3` Consume `skins.json`: apply `offset`/`scale` (units unknown —
   first pass: try `scale` as % of viewport height, `offset` as px), and
   store `paraRange`/`drags` for later units. *Accept:* placement keys are
   applied without errors; values logged.
4. `R1a.4` Discovery: log `coreModel.drawables.ids` — confirm whether drag
   `part` names (`TouchIdle1`…) match drawable ids, part ids, or neither.
   Print counts. *Accept:* a written note in STATUS.md concluding the match
   rule for D-HIT (this decides R1b's hit-test input).
4a. `R1a.5` Placement editor (added 2026-10-30, after R1a.3): drag an empty
   stage point (more than 4 px = drag, hotspot presses never drag); wheel zooms
   around the cursor, clamped 0.3x–3x of the nagami default; reset button
   (hover-only, left of the tips toggle). The user view persists per prefab in
   `localStorage` `mizu.placement.<prefab>` = `{dx, dy, zoom}` in design px
   (multiplied by uiScale when applied, so it survives resizes). Shared
   settings layer `mizu.settings.<prefab>` (`tips` now; `mute` for R1d).
   *Accept:* drag, wheel and reset work on gaoxiong_7 and rangbaer_3; a reload
   keeps the view; reset returns to the default and deletes the key; a
   resize keeps the view proportional; hotspot clicks still fire without
   dragging.
5. `R1b.1` Mouse follow: pointer → `model.focus(x, y)`-equivalent driving
   `ParamAngleX/Y` (+eye params) clamped by `paraRange`, with smoothing.
   *Accept:* head/eyes track the cursor within the clamped range (visual).
6. `R1b.2` Hotspots: implement D-HIT (screen→model coords → per-drawable
   bbox hit for drag parts → `model.motion(trigger.action, undefined, 3)`),
   honoring `ignore` groups and a per-hotspot cooldown. Click to trigger;
   hover only if observation of the site suggests so. *Accept:* clicking the
   head triggers `touch_head`, body → `touch_body`, a `TouchIdleN` region →
   its motion; ≥3 distinct hotspots verified visually.
7. `R1b.3` Idle poses: surface the idle-pose list (from model3.json groups
   and/or `drags[].idle`) in a minimal side panel; clicking plays it; auto
   cycle option. *Accept:* 21 idle poses playable for gaoxiong_7 (test model).
8. `R1c.1` Calibration against the site: screenshot ours vs the site's
   rendering of the same skin (browser tab), iterate `scale`/`offset`
   interpretation until placement differs ≤ ~5%. Write the derived unit
   semantics into §5. *Accept:* side-by-side comparison saved to
   `docs/calibration.md` with images.
9. `R1c.2` Model carousel + mapping: a simple dropdown/list built from
   `l2d_mapping.json` (names EN/CN), `fetch-model.sh` integration
   (download-on-demand), switch model without reload bugs. *Accept:* switch
   between gaoxiong_7 and abeikelongbi_3 live; no texture/VRAM leak across 10
   switches (measure via `performance.memory` / renderer info + process RSS).

### R2 — embed as the wallpaper (M–L)
1. `R2a.1` Install webkitgtk-6.0 + gtk4-layer-shell (GTK4 pair); write
   `wall/mizu-l2d-wall.py` (PyGObject): one `Gtk.Application` window per
   monitor, `gtk4layershell` init → BACKGROUND layer, anchor all sides,
   exclusive zone −1, hosting a `WebKitWebView` loading
   `http://127.0.0.1:8787/`. Set the page's `<html>` background transparent
   (`backgroundAlpha:0` + WebKit transparency). *Accept:* wallpaper visible
   on both outputs; windows/reload/hotplug don't crash; process survives
   `niri msg action reload`.
2. `R2a.2` Input check: pointer events reach the page through the background
   layer (S1 proved raw layer input; gtk-layer-shell adds its own input
   region handling — verify, and if gtk-layer-shell forces an empty input
   region for background windows, fall back to raw layer-shell + WebKit in
   a GTK-less window or set the input region explicitly). *Accept:* clicking
   the model triggers a hotspot on the desktop itself.
3. `R2b.1` Shell owns the control plane: unix socket **and/or** WebSocket
   (same command set: ping/status/camera/motion/model/perf) + push events to
   the page (`quiet`/`interact`/`camera`/`model`). Shell executes camera by
   evaluating JS (`window.mizu.camera(...)`) — expose that JS API in R1
   pages from the start. *Accept:* `mizu-l2d-ctl camera zoom 1.4` (a small
   Python CLI, same JSON lines) visibly zooms the wallpaper; `motion
   touch_head` plays the motion.
4. `R2b.2` Idle fps ramp + pause-on-cover: shell detects pointer-over and
   fullscreen coverage (niri IPC `niri msg event-stream` — unverified, spike
   S3 of the design doc) and pushes `quiet`/`interact`; page throttles rAF
   to idle_fps (config, default 30). *Accept:* measured: GPU/CPU drops when
   quiet, restores instantly on interaction (page rAF counters + RSS).
5. `R2b.3` systemd user unit (`wall/mizu-l2d-wall.service`) + spawn from
   niri config via the dotfiles; autostart with the session; restart on
   crash. *Accept:* reboot/login test; `systemctl --user status mizu-l2d-wall`
   green; wallpaper returns after monitor hotplug.

### R3 — product polish (L, optional ordering)
- Mizu chrome: hover-revealed semi-transparent AL-flavored toolbar
  (position mode, model switcher, settings) drawn **in-page** (HTML/CSS with
  the same visual language as the design doc §6; the webview makes this far
  cheaper than GL-drawn UI). Keybinds via niri → ctl.
- Palette extraction (design doc §8): the page can compute the palette from
  the WebGL canvas (`gl.readPixels` downsample → OKLab k-means) and publish
  to the shell (WS event) → state file → noctalia. S4 semantics (semantic
  drawable names) apply in-page.
- Lock/login hook (`login` motion), special-touch gating state machine
  (design doc §5), camera persistence per model+output.
- Battery-aware idle fps; day/night dimming.

### P — parked: native Cubism renderer (do not start without cause)
Open bug: rest pose exploded (textures correct per part, layout scrambled;
independent of motions — `MIZU_NO_MOTION=1` identical; texture v-flip already
applied; no GL errors; all drawables bound). Re-entry notes:
- First hypothesis to test: moc3 → csmUpdate produced deformed vertices at
  rest that are wrong; compare `GetDrawableVertexPositions` before/after
  `Update()` and against the Cubism Editor/reference viewer for the same
  model; also try Cubism Native SDK 4-r.7 (moc3 written by editor 3/4).
- Second: canvas info is 6000×6000 but vertices span ±130 — the game may
  rely on its own model-space scale that the samples bake into the model
  matrix differently. Try multiplying the MVP by a canvas→vertex-space
  scale, though note the *renderer and our bbox read the same arrays*, so a
  uniform mismatch should still render self-consistently — which it didn't.
- The web path (R1) doubles as the oracle: if pixi-live2d-display renders the
  same moc3 correctly in WebGL, the asset is fine and the bug is in our
  native use of the SDK; diff our update/draw sequence against
  `CubismUserModel`-based samples line by line.
Only resume P if R2 ships and native becomes genuinely worth it (e.g.,
webkit overhead measured unacceptable on the iGPU).

## 9. Verification playbook

- **Build/daemon (C++, still used for spikes):** `ninja -C build` green;
  `./build/mizu-l2d-ctl ping|status|perf` respond; screenshots via
  `--screenshot /tmp/shot.png` + `SIGUSR1` (numbered files); interaction via
  `spikes/s1-pointer` virtual-pointer sweeps.
- **Test model (owner rule, 2026-10-30):** never use `aersasi_3` (Alsace) for
  any test or screenshot — it is broken. Use `gaoxiong_7` (Takao "Inner
  Cultivation"; 111 motion groups, 62 touch groups, 82 drags, clothed and
  SFW). Backup: `guanghui_9` (Illustrious, sheer white gown). Do not test with
  `chaijun_6`, `zhangwu_2`, `baifeng_3`, or `wuzang_4` (revealing outfits).
- **Web viewer (R1):** serve `web/` on :8787; verify in a real browser;
  screenshots of idle/motion/zoom states saved under `docs/shots/`; the
  browser automation used to research nagami (ZCode in-app browser) can drive
  these checks headlessly if the agent has it.
- **Wallpaper (R2):** run on an empty niri workspace
  (`niri msg action focus-workspace-down` first, restore with `-up`);
  acceptance = what §0–§8 units specify; always test both outputs; always
  test `niri msg action reload` survival.
- **Global perf gates:** interactive frame interval p95 ≤ 1.5× refresh
  budget (144 Hz → ≤ 10.4 ms); idle mode actually lowers GPU/CPU (measure
  before/after with `intel_gpu_top` or power readout); RSS ≤ 400 MB with one
  model; no growth over a 10-min idle loop.

## 10. Appendix

- Command cheat-sheet:
  - build: `cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo && ninja -C build`
  - run daemon: `./build/mizu-l2d [--screenshot /tmp/shot.png] [--layer bottom]`
  - ctl: `./build/mizu-l2d-ctl ping|status|perf|camera ...`
  - fetch model: `scripts/fetch-model.sh gaoxiong_7`
  - empty-workspace test: `niri msg action focus-workspace-down` / `-up`
- Key files: `src/app.{hpp,cpp}` (Wayland), `src/gl_core.*` (EGL),
  `src/ipc.*` (JSON-lines + flat JSON), `src/config.*`, `src/main.cpp`,
  `src/model/*` (parked native), `spikes/s1-pointer/` (input spike),
  `scripts/{fetch-model,fetch-thirdparty,patch-cubism}.sh`,
  `systemd/mizu-l2d.service` (C++ daemon variant; R2 gets its own).
- Glossary: prefab = model directory name (pinyin of the CN ship name + skin
  index, e.g. `aersasi_3` = Alsace skin 3); drags = the site's hotspot/trigger
  config; quiet = no pointer over the wallpaper for `quiet_time_s`.
