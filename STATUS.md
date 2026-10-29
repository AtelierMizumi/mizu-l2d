# STATUS — state ledger (update at the END of every work unit)

Last updated: 2026-10-30
Last agent: Claude (R1a.3 committed, R1a.5 placement editor, tested on gaoxiong_7 and rangbaer_3)
Next unit: **R1c.2** (picker with filter and sort, PLAN §8 R1 item 9). R1a.5 done.
Handover for continuation: **docs/HANDOVER.md** (read it first; it lists owner-only steps).
Test model (owner, 2026-10-30): **gaoxiong_7** replaces aersasi_3 (Alsace, broken) for all
tests and screenshots; the web viewer's default `?model=` is now gaoxiong_7. See PLAN §9.

## Done (verified)
- Spikes S1/S2/S4 PASS (design doc §2). Pointer input to background layer
  works on niri; virtual-pointer injection works for testing.
- C++ daemon skeleton builds green and runs on both outputs (frame loop,
  damage discipline, IPC, ctl, config). Committed in the R0.1 baseline.
- Native Cubism renderer built (SDK 5-r.3 + LINUX_GLES2 vendor patch);
  renders *something* but rest pose is exploded → parked (PLAN §9-P).
- Assets mirrored: `~/.local/share/mizu/l2d/abeikelongbi_3` (MilkyLan),
  `~/.local/share/mizu/l2d/aersasi_3` (nagami CDN, 40 MB, full touch_idle
  set + animator.json + skins.json with 66 drags).
- nagami.moe data layer reverse-engineered and documented (PLAN §5);
  frontend source confirmed private.
- `scripts/fetch-model.sh` rewritten for the nagami CDNs (tested).
- R0.2 done (verified): `scripts/fetch-web-deps.sh` fetched and pinned
  pixi 6.5.10 (`dist/browser/pixi.min.js`) and pixi-live2d-display 0.4.0
  (`dist/index.min.js`) into `web/vendor/`, sha256 recorded in
  `web/vendor/SOURCES.md`; package LICENSE texts vendored as `*.LICENSE`.
  `git check-ignore` confirms the Cubism Core, `web/data/` and `web/assets`
  stay out of git.
- R0.3 done (verified): `web/index.html` + `web/main.js` transparent PIXI
  scaffold; `web/assets -> ~/.local/share/mizu/l2d` symlink (gitignored).
  Served via `python3 -m http.server 8787 -d web`; curl checks returned 200
  for index.html, the aersasi_3 model3.json through the symlink, and both
  vendor bundles.
- R1a.1 done (verified): `web/main.js` renders the model with idle motion,
  fit to 90% viewport height, anchored bottom-center; model selectable via
  `?model=<prefab>` (default aersasi_3). Real-browser checks: aersasi_3
  (82 groups) and lisailiu_3 load with no console errors, render correctly
  (screenshot), and idle motion starts and animates when the page ticks.
- R1a.2 done (verified): scene background behind the model. `findBackgroundUrl`
  resolves prefab → skins[].bg from the mirrored mapping; bg fetched by
  `fetch-model.sh --bg` into `assets/bg/<id>.png` (URL is
  `bg/star_level_bg_<id>.png` — PLAN §5 corrected). Sprite is cover-fit
  behind the model with an idempotent fit (see discoveries: the first cut
  re-scaled from the already-scaled sprite width and shrank the bg on every
  resize event — caught by the full-catalog sweep, not by spot checks).
- Full-catalog import (owner-directed, 2026-10-30): all 239 prefabs from
  `l2d_mapping.json` imported via `fetch-model.sh` into
  `~/.local/share/mizu/l2d/` (5.3 GB, 9440 files, 76 unique bgs, 0
  failures). Note: this is a one-off verification sweep of the pipeline; the
  product remains download-on-demand (owner goal 2026-10-29, no mass
  download in the UI).
- Full-catalog verification sweep (owner-directed, final pass 2026-10-30):
  every one of the 239 models loaded in a real browser: model3.json+textures
  load, bg file matches the mapping, bg sprite covers the full canvas, the bg
  texture renders real pixels (verified with the model hidden — bg-only
  corner patches), idle motion starts and animates (parameter delta > 0
  across driven updates). 239/239 PASS; screenshots in
  `~/.local/share/mizu/verify-shots/`. Three product bugs were found and
  fixed along the way (see discoveries: fitBackground idempotency, the
  0.4.0 idle-reservation deadlock, and the hidden-tab texture-upload race).
  12 models legitimately render with black surrounds — the model mesh
  contains its own scene card/backdrop (verified against the nagami site
  for anninvwang_2: identical rendering). wuqi_3 (Azuma — Career Counseling)
  owns a full-canvas dark classroom scene (atlas confirmed); worth an
  eyeball against the site during R1c.1 calibration.
- R1b.2 done (verified): D-HIT hotspots + the game-style "L2D interaction
  tips" toggle. Zones come from `skins.json drags[]` (part = drawable id,
  trigger.action = motion group, limitTime = cooldown s); skins WITHOUT a
  drags config (Jean Bart, lisailiu_3, …) synthesize basic zones from their
  Touch* drawables whose names map to motion groups. Numbered glass
  speech-bubble badges track each zone's live vertex bbox; hover label +
  pointer cursor; click fires the motion behind a per-zone cooldown.
  Browser-verified on rangbaer_3/rangbaer_4 (3 zones each: hover label,
  click → touch_head/body/special motion, 1s cooldown swallows rapid
  re-clicks) and regression-checked on aersasi_3 (66 drags → 48 playable
  zones, fallback inert). drags[].ignore/reactCondition stay unapplied
  (PLAN §5 unverified; the cooldown alone prevents retrigger spam).
- R1a.3 done (verified, commit 08bc351): nagami home-screen placement from
  skins.json + data/l2d_index.json (uiScale = viewport height / 1080, scale
  = (scale ?? 52) / pixelsPerUnit · uiScale, effective offset per the site
  formula). gaoxiong_7 (full body, bottom near the viewport edge) and
  rangbaer_3 (no skins offset/scale, default placement) render with no
  console errors.
- R1a.5 done (verified, plan unit added in PLAN §8): placement editor. Drag
  the empty stage (4 px threshold), wheel-zoom around the cursor (0.3x–3x),
  hover-only reset button. View persists per prefab (`mizu.placement.<prefab>`,
  design px) and `mizu.settings.<prefab>` holds tips. Browser-verified on
  gaoxiong_7 and rangbaer_3: drag moves by exactly the dragged px / uiScale,
  wheel keeps the model point under the cursor fixed (drift 0.000), zoom clamps
  at 0.3 and 3, reload restores the view, reset deletes the key, resize to
  1920×1080 lands on the expected position, hotspot clicks fire without drag,
  and the 1 s cooldown holds.
- Test model: gaoxiong_7 (owner-directed; aersasi_3 is broken and must not be
  used for tests or screenshots).

## In progress
- S0-perf (SPEC §12): scripts in `spikes/s0-perf/` (committed in `cd21547`). Side A
  `webkit_bench_gtk4.py` needs `webkitgtk-6.0`. Side B `native_measure.sh` needs
  a live Wayland session. Both must be run by the owner on the desktop.

## Next
- R1c.2 (model picker with filter and sort, PLAN §8 R1 item 9), then R1d
  dialogue (bubble + voice). S0-perf runs before R2 (SPEC §12).

## Blockers / open questions
- `skins.json` scale/offset unit semantics unknown (resolved empirically in
  R1c.1).
- gtk4-layer-shell input-region behavior on the background layer unverified
  (R2a.2 spike).
- Native renderer exploded rest pose — parked, hypotheses in PLAN §9-P.

## Discoveries log (append-only)
- 2026-10-29: initial ledger written; see PLAN §6 for pitfalls 1–13.
- 2026-10-29: owner asked for an official multi-environment extension. Wrote
  docs/SPEC.md (v3 DRAFT): engine + host adapters + content packs. Public engine
  cannot ship Cubism Core or Azur Lane content (SPEC §9). Owner decisions open:
  D-L1 license, D-L2 private overlay for content, D-N1 name, D-S1 tiers, D-P1 repo
  location. Spikes S5–S8 added. Not yet reviewed by owner.
- 2026-10-29 spec audit (tests run, see PLAN §8 R0.1 and §5):
  - `ninja -C build`: no work to do (green). `bash -n scripts/*.sh`: all pass.
  - `git add -A` FAILS on root character-device placeholders. R0.1 now uses explicit paths.
  - Asset counts fixed in PLAN: aersasi_3 has 82 motion groups (not ~60), 44 touch_idle
    groups (not 47; gaps at 16, 20, 21). 21 idle groups and 66 drags confirmed.
    abeikelongbi_3 has 14 groups, confirmed.
  - WebKit stack: `ldd gtk4-layer-shell` links GTK4 only; `webkit2gtk-4.1` links GTK3.
    Reference host is now webkitgtk-6.0 (PLAN D-R2, R2a.1, §3; SPEC §4.2).
  - pixi.js and pixi-live2d-display LICENSE pages show MIT (fetched from GitHub 2026-10-29).
  - Not verified: Live2D license terms (live2d.com blocked in sandbox). Layer-shell
    support per compositor (secondary sources only). Performance A/B (not run: no
    display in sandbox; `webkit_bench.py` written, not yet run on the owner's session).
- 2026-10-29 owner approved: decisions D-L1, D-L2, D-N1, D-S1, D-P1 recorded in SPEC §12
  (recommendations accepted). R0.1 committed with explicit paths. `.claude/` stays
  untracked until the owner decides. S0-perf is the next measurement, before R2.
- 2026-10-29 security review of R0.1 (automated finding, model_runtime.cpp), fixed in the
  working tree, NOT committed (needs owner OK):
  - moc3 now loads with `LoadModel(moc, msz, true)`. Cubism Core's default is no check.
    Verified: the real abeikelongbi_3 moc3 passes `csmHasMocConsistency`; truncated and
    corrupted copies fail.
  - Every model3.json reference (texture, physics, motion) must be relative with no `..`
    (`is_safe_rel`). A standalone test of the helper passes 9/9.
  - Still open: `read_all` has no size cap, and stb decoders parse untrusted PNGs. Address
    with the content-pack limits in SPEC §4.3 before any public release.
- 2026-10-29 bug: `scripts/fetch-model.sh` never fetched `FileReferences.Moc`. aersasi_3
  has no moc3 locally, so the native runtime cannot load it (and PLAN R1a.1 uses it).
  Fixed in the working tree. The same script also refuses `..` or absolute paths from the
  remote model3.json. Owner must re-run `bash scripts/fetch-model.sh aersasi_3` to fetch
  the moc3. The sandbox blocks azlassets.nagami.moe, so the URL is unverified here.
- 2026-10-29 goal set by owner (`/mattpocock-skills:tdd`): a selection UI with preview,
  on-demand download of a chosen Live2D model (no mass download), and the model shown and
  interactive on the desktop wallpaper.
  - Success: 99 of 100 random loads succeed (retries counted). Interaction: the hotspot
    fires the mapped motion, no motion gets stuck, no crash after 100 interactions, and
    switching models leaks no GL resources.
  - Placement: catalog and fetch live in this repo while it is local. Gate: move them to the
    overlay before any push or public release (SPEC §12, D-L2 amendment).
  - Host: wait for the S0-perf result before choosing WebKitGTK 6.0 or native.
  - Seams S1–S6 are proposed (catalog, on-demand fetch, render, interaction, wallpaper host,
    success-rate harness). Not yet confirmed by the owner; no tests written yet.
- 2026-10-29 R0.2 unit:
  - pixi-live2d-display@0.4.0 has NO `dist/web/` (that layout is 0.5.x); the
    0.4.0 bundle is `dist/index.min.js`. PLAN R0.2 corrected before vendoring.
  - The 0.4.0 bundle embeds no license notice, so each package's LICENSE text
    is vendored as `<bundle>.LICENSE` (MIT redistribution requirement).
  - This sandbox CAN reach cdn.jsdelivr.net — HANDOVER §1's "cannot" list was
    written for the previous agent's sandbox. Re-test network assumptions per
    session instead of trusting the handover.
- 2026-10-29 R1a.1 + model import unit:
  - lisailiu_3 (Richelieu "Evergreen Prophecy") fetched with fetch-model.sh:
    7 MB, 1 texture, 15 motion groups (idle, main_1..3, touch_head/body/
    special, wedding, plus secretary UI groups), all 18 model3.json
    references present. skins.json has offset [0, 40] and paraRange but NO
    drags — this skin has no hotspot config.
  - pixi-live2d-display 0.4.0 hardcodes motionManager.groups.idle = 'Idle'
    (capital I) while AL model3.json defines the group as 'idle' —
    startRandomMotion looked up definitions['Idle'] and silently no-oped,
    so auto-idle never started on any model. Fixed in main.js by remapping
    groups.idle to the group name the model actually defines.
  - Probe lesson: an occluded automation tab throttles rAF to ~2 FPS (or 0),
    so motion start and param animation read as frozen. Drive
    `internalModel.update(dt, now)` manually when probing time-based state;
    do not conclude from wall-clock sampling that nothing animates.
- 2026-10-30 R1a.2 + catalog sweep unit:
  - `fitBackground` was non-idempotent: it scaled from `sprite.width` (which
    already includes the current scale), so every resize event shrank the bg
    back to native size centered in the viewport. Bgs larger than the
    viewport masked the bug visually. Fixed by scaling from the texture's
    natural size. Found only because the sweep forced resizes per model.
  - pixi-live2d-display 0.4.0 deadlock: `state.complete()` clears
    `currentGroup` but nothing clears `reservedIdleGroup` when a reserved
    motion is never started, so `shouldRequestIdleMotion()` stays false and
    `reserve()` rejects every new idle request ("already reserved") — auto
    idle stops permanently. Watchdog in main.js clears the stale reservation
    whenever no motion is current.
  - Hidden-tab texture race: `texImage2D` on an HTMLImageElement that the
    decoder has not finished uploads an OPAQUE-BLACK GL texture, and the base
    texture is marked uploaded so it never re-uploads — the bg then renders
    black forever (~7% of catalog bgs). `img.decode()` is itself deferred
    indefinitely in hidden tabs, so the fix loads bgs via
    `fetch` + `createImageBitmap` (deterministic decode, ImageBitmapResource).
  - Probe toolkit notes: PIXI `renderer.plugins.extract.canvas(stage)` gives
    deterministic in-page screenshots (CDP surface capture flakes under
    load); driving `internalModel.update(dt, now)` needs a follow-up await
    tick before motion state is observable (startMotion is async); Chromium
    throttles rAF to ~0 in occluded tabs so the ticker-driven watchdog and
    renderer must be exercised manually during probes.
  - Scene-card models: some skins (anninvwang_2, ajiier_3, wuqi_3, ...)
    contain their own opaque backdrop/panel inside the mesh; the mapping bg
    is invisible behind them and black corners in screenshots are model art,
    not bugs. Verified against https://azurlane.nagami.moe/live2d-viewer.
  - Catalog: 239 prefabs / 76 unique bgs / 5.3 GB mirrored under
    `~/.local/share/mizu/l2d/`. Import and verification artifacts in
    /tmp/mizu-import (logs, probe JSONL) are ephemeral.
- 2026-10-30 R1b.2 unit (tested on the owner's pick, Jean Bart rangbaer_3/_4):
  - rangbaer_3/_4 carry NO drags config (nagami index.json flags are `{}`
    too) but the mesh has TouchHead/TouchBody/TouchSpecial drawables with
    matching touch_* motion groups — the tech-design §13 "older models fall
    back to basic touch zones" case. The buildHotspots fallback synthesizes
    zones only when drags is empty; drags-configured skins are untouched.
  - Drawable ids are PascalCase ("TouchHead") while motion groups are
    snake_case ("touch_head"): naive `.toLowerCase()` gives "touchhead" and
    matches nothing — the first fallback cut silently produced 0 zones and
    a hidden toggle. Convert with `/([a-z0-9])([A-Z])/` before matching.
    When page state contradicts the file on disk, read the executed source
    in-page (`buildHotspots.toString()`) before suspecting the cache.
  - limitTime across the 137 drags-configured skins: 1s is the game's
    common cooldown (2481/3333 entries) — used for the fallback zones too.
  - Probe caveats: two CDP clicks are ~2s apart unless the probe avoids
    waits between them, so a cooldown test must read lastFired on
    back-to-back clicks; occluded-tab rAF throttling (FPS 1) means
    hover-driven state needs a follow-up wait before asserting.
