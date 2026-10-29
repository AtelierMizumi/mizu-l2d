# mizu-l2d

Live2D wallpaper engine for niri — renders a Live2D character on the background
layer, interactive like the in-game secretary screen. Character content is not
included; bring your own.

Current direction (see `docs/SPEC.md` and `docs/PLAN.md`):
- Engine: a web page (pixi-live2d-display on WebGL), hosted in WebKitGTK 6.0
  behind a gtk4-layer-shell window. This is the planned reference host.
- The native C++ renderer in `src/model/` is parked (PLAN §9-P).
- Web vs native host for performance is undecided until a measurement spike.
- `docs/research/mizu-l2d-tech-design.md` in the dotfiles repo describes an
  earlier native-only plan and is superseded for the renderer decision.

## Status

Increment 1 complete (2026-10-29):

- **Spikes answered** (see dotfiles design doc §2 for results):
  - S1 **PASS** — niri delivers pointer enter/motion to background-layer
    surfaces with a full input region (`spikes/s1-pointer/`).
  - S2 **PASS** — GLES3 context via EGL on Wayland, `EGL_EXT_buffer_age` +
    swap-with-damage available; vsync frame callbacks drive the loop.
  - S4 **PASS** — AL moc3 drawable names are semantic (`Eyes`, `HairFront`,
    `Face`, `Body`…), so palette extraction can render named drawable groups.
- **Skeleton daemon running**: per-output background layer surfaces, GLES3,
  vsync frame loop with old∪new-bbox damage discipline, idle-fps ramp,
  JSON-lines IPC (`mizu-l2d-ctl`), TOML config. Placeholder scene (navy +
  accent disc + camera) stands in for the Cubism model runtime.
- Model `abeikelongbi_3` downloaded to `~/.local/share/mizu/l2d/` (19 files,
  9.6 MB).

Next increment: Cubism Core/Framework integration (fetch + build wiring),
model loader + per-output instances, focus tracking, tap zones, camera on the
model. Then: settings drawer, model carousel, palette extraction.

## Build (Arch)

```sh
sudo pacman -S --needed wayland wayland-egl egl GLES2 mesa glm tomlplusplus
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
ninja -C build
```

## Run

```sh
niri msg action focus-workspace-down   # optional: empty workspace to see it
./build/mizu-l2d                       # navy + accent disc on the background
./build/mizu-l2d-ctl ping
./build/mizu-l2d-ctl status
./build/mizu-l2d-ctl camera zoom 1.5
./build/mizu-l2d-ctl perf
```

`--layer bottom` switches the layer (spike fallback); `--config <file>`
overrides the config path.

## Assets

- `scripts/fetch-model.sh <name>` — downloads one model from
  MilkyLan/AzurLane-Live2d into `~/.local/share/mizu/l2d/`. Game assets are
  Manjuu/Yongshi / Yostar / Bilibili IP — **personal, local use only**.
- `scripts/fetch-thirdparty.sh` — downloads Cubism SDK for Native (Core is
  proprietary; never committed). Requires accepting the Live2D SDK license.

## Layout

```
src/app.{hpp,cpp}     Wayland: globals, layer surfaces, pointer, event loop
src/gl_core.{hpp,cpp} EGL: ES3 context, per-output surfaces, damage swaps
src/scene.{hpp,cpp}   Placeholder renderer (→ Cubism model runtime)
src/ipc.{hpp,cpp}     JSON-lines unix socket + flat JSON v0
src/config.{hpp,cpp}  TOML config (toml++)
src/main.cpp          wiring: frame loop, fps ramp, perf counters
src/ctl.cpp           mizu-l2d-ctl
spikes/s1-pointer/    S1+S2 spike (kept for the record)
third_party/          vendored protocol XMLs; Cubism SDK (not committed)
systemd/              user unit
```
