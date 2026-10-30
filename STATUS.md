# STATUS — state ledger (update at the END of every work unit)

Last updated: 2026-10-30
Last agent: Claude (R1 complete; R2a.1, R2a.2 and part of R2b.1 done; tested on the live niri session)
Next unit: **R2d.2** (mirror one WebKit view onto the other outputs; spike first), then R2d.3 (hotplug). R2b.2 and R2b.3 need owner decisions, see PLAN R2.
Handover for continuation: **docs/HANDOVER.md** (read it first; it lists owner-only steps).
Test model (owner, 2026-10-30): **gaoxiong_7** replaces aersasi_3 (Alsace, broken) for all
tests and screenshots; the web viewer's default `?model=` is now gaoxiong_7. See PLAN §9.

## Done (verified)
- R2b.3 (partially done): `wall/mizu-l2d-wall.py` reads `[wall] model` from config.toml
  and appends `?model=` to the startup URL; `docs/config.example.toml` updated for
  the web host schema. Systemd unit and Quickshell L2dService integrated via dotfiles.
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
- R1c.2 done (verified): `web/picker.js` panel (top-right, glass style) lists
  167 ships / 239 skins from `data/l2d_mapping.json`, sorted by EN name with
  the ship id as tie-break. Search matches EN/CN/JP and folds accents
  ("agir" finds Ägir). The "Đã tải" chip filters on disk state. The state comes
  from a HEAD probe of `assets/<prefab>/<prefab>.model3.json`, cached in
  `mizu.downloaded`. Missing skins get a Tải button that calls
  `scripts/serve.py` `/api/download` (validated against the catalog, one
  download at a time, streams the `fetch-model.sh --bg` log, ends with
  `[exit N]`). `web/main.js` gained `loadModel(prefab)` / `unloadCurrent()`
  (destroy model + textures, close the bg ImageBitmap, drop badges and
  hotspots), with a stale-load token and one ticker and one resize listener.
  Browser-verified on gaoxiong_7 and abeikelongbi_3:
  - Tải: aidang_2 was moved aside and re-downloaded through the picker in 18 s.
    The 20 files match the backup byte-for-byte (`diff -rq`).
  - Filter: moving lafei_4 aside gives 238 skins with the chip on (Laffey
    hidden), and a Tải button appears for the missing skin. lafei_4 was moved
    back.
  - Switching: 60+ live switches via real picker clicks, no page errors. The
    stage keeps 3 children and the ticker keeps 3 listeners. The base-texture
    count alternates 63 ↔ 6 with no growth. The bg renders after the switches.
  - Memory: the texture manager's `renderer.texture.count` is undefined in this
    PIXI build, so the base-texture cache stands in as the GPU proxy. Browser
    RSS measured across 60 switches moved 1547 → 1736 MB and then fell back to
    1652 MB, so it fluctuates and shows no steady climb. This is not a rigorous
    VRAM measurement; a profiler run would be needed to settle it.
  - Data fix: unresolved `{namecode:N}` CN names are stripped from display and
    search.
- Security follow-up (automated review of 1a00703): `/api/download` is now
  POST-only and needs `X-Mizu-Action: download`. Host must be
  127.0.0.1/localhost:<port>, Origin must be same-origin, and Sec-Fetch-Site
  cross-site gets 403 (curl-verified: GET 404, no header 403, bad Host 403,
  foreign Origin 403, cross-site 403, bad prefab 400, accepted POST streams to
  `[exit 0]`).
- R1d done (verified): `scripts/build-words.py` writes `web/data/words/` (239
  files, gitignored). Prefab→skin id: 217 via the Lua prefab field (matched
  case-insensitively, since Lua has names like "yuekechengII_3"), 22 via a name
  join with skin.json (gid + EN name). Three prefabs stay ambiguous (antu_2,
  mojiaduoer_4, jinluhao_3): their name-matched ids have identical voice sets,
  so the lowest id is taken. Lines per key: touch 228, touch2 216, headtouch
  101, main1 238, main2 238, main3 239, main4 39, login 235, home 221, mission 79,
  mission_complete 65, mail 54. `web/dialogue.js`: bubble, cooldown, chatter,
  mute and chatter toggles. Browser-verified:
  - gaoxiong_7 login line on load with login.ogg requested.
  - rangbaer_4 head tap → headtouch line, headtouch.ogg 200, motion fired,
    bubble hides after 3.5 s.
  - rangbaer_3 head tap → motion only, no bubble (no headtouch key).
  - mute and chatter persist across reload (`mizu.settings.<prefab>`).
  - muted → text shown, no audio request.
  - chatter scheduler (200–400 ms test interval) shows a main line on its own.
  - cooldown: allowed → blocked within 2 s → allowed after 2 s.
  - missing audio (404) → text still shown, no exception.
  - Plan deviation: gaoxiong_7's drags config has no touch_head/body/special
    zones (only touch_idle* and touch_drag*), so its taps stay silent. The head
    tap test uses rangbaer_4, which has the head zone and the headtouch key.
    aersasi_3 was not used.
- R2a.1 done (verified on niri): `wall/mizu-l2d-wall.py`, one GTK4 window per
  monitor on the BACKGROUND layer (gtk4-layer-shell, namespace `mizu-l2d`,
  anchored to all four edges, exclusive zone -1). Each holds a WebKitGTK 6.0 view
  on `http://127.0.0.1:8787/?wall=1` with a transparent background.
  - Linking: gtk4-layer-shell must load before libwayland. The script re-execs
    itself with `LD_PRELOAD=/usr/lib/libgtk4-layer-shell.so`. Without it,
    windows fall back to tiled toplevels on the user's workspace. The script now
    refuses to start in that case (`LayerShell.is_layer_window` check).
  - `niri msg --json layers`: `mizu-l2d` Background on HDMI-A-1 and eDP-1.
  - eDP-1 capture (`screenshot-screen` via the clipboard, on empty workspace 3):
    the scene renders on the wallpaper under the Quickshell bar; WebGL works.
  - HDMI-A-1: the layer is present and the page is live. A visual capture was
    not taken because that output's active workspace held the owner's windows.
  - Survives `niri msg action load-config-file`: same host PID, both layers kept.
  - Hotplug: not tested (no monitor unplugged).
  - The owner's own `mizu-wallpaper` layer (Background, both outputs) was left
    alone. Our host was stopped after testing, so the desktop is as it was.
- R2a.2 done (verified): pointer reaches the page through the background layer.
  `spikes/r2a2-input/vptr-click.c` (test-only, wlr virtual pointer) clicked
  eDP-1 at the rangbaer_4 head zone (958, 320). That view's `lastTap` became
  touch_head and HDMI's stayed None. Mute is on by default in wall mode.
- R2b.1 partly done: JSON-lines control socket at `$XDG_RUNTIME_DIR/mizu-l2d-wall.sock`.
  Commands: ping, status, page, camera {zoom|pos|reset}, motion, model. Each runs
  against every view and replies per output. Checked with `wall/mizu-l2d-ctl.py`:
  motion touch_head → true, unknown group → false, camera zoom 1.4 visibly zooms
  the wallpaper (eDP capture), reset restores, model switch works. Not yet:
  `quiet`/`interact` events and `perf`.
  - Bug fixed on the way: JS replies must not block the GTK thread. The first
    version deadlocked, and every reply timed out.
- Wall mode (`?wall=1`): audio muted by default, and separate settings and
  placement keys (`.wall`) so the web viewer's state is untouched. Controls
  (tips, reset, voice, picker) are hidden with `body.wall`. Dialogue bubbles stay.
- `scripts/serve.py` now sends `Cache-Control: no-cache` for static files, so
  WebKit picks up edits without a cache clear.
- R2c.1 done (verified on eDP-1): the owner's shell puts the desktop widgets on
  Bottom while a live host covers the screen, and hides the static picture there.
  Changes are in `~/Projects/Tools/dotfiles/quickshell/.config/quickshell/mizu`
  (uncommitted, owner's repo): `WallpaperService.liveScreens` and `covered()`,
  `MizuIpc.liveWallpaper(screens)`, and the layer rule in Clock, CalendarCard,
  WeatherCard, Todo, Lyrics, UserCard and StickyNotes, plus `WallpaperLayer`
  visibility. Checked with `niri msg --json layers`: under the wall, the widgets
  are Bottom and `mizu-wallpaper` is gone on eDP-1. The screenshot shows the
  Azur wall with the weather, calendar, clock and lyrics widgets above it. After
  SIGTERM, `mizu-wallpaper` and the Background widgets are back.
- R2d.1 done: `wall/mizu-l2d-wall.py --outputs eDP-1` or `[wall] outputs` in
  `~/.config/mizu-l2d/config.toml`. Unknown keys are warned about. Checked with a
  temporary config: the config value and the CLI override both read correctly.
- Resource measurement (2 outputs, same page): WebKitWebProcess 451 MB and
  448 MB, WebKitNetworkProcess 75 MB, total 971 MB. WebKitGTK 6.0 has no process
  model setting. The mirror spike (R2d.2) is the next step.
- Mistake during testing: one test run started the host on eDP-1 without the
  server for about 12 s, so the owner may have seen a blank wallpaper. It has
  not recurred.
- Leftover cleanup (run by the owner; nothing below needs sudo):
  ```
  rm -r ~/.local/share/mizu/verify-bak ~/.local/share/mizu/words/lua/ship_skin_template_main.lua ~/Projects/Tools/dotfiles/.playwright-mcp
  ```
  `verify-bak` is a duplicate of aidang_2 (byte-identical). `ship_skin_template_main.lua`
  is a stray download from a manual check; the builder never reads it. `.playwright-mcp`
  holds screenshots and logs from the browser tests. The control socket is already removed on exit.

## In progress
- S0-perf (SPEC §12): scripts in `spikes/s0-perf/` (committed in `cd21547`). Side A
  `webkit_bench_gtk4.py` needs `webkitgtk-6.0`. Side B `native_measure.sh` needs
  a live Wayland session. Both must be run by the owner on the desktop.

## Next
- R2 wallpaper embed (PLAN §8). S0-perf runs before R2 (SPEC §12).

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
