# CLAUDE.md — agent rules for the mizu-l2d repo

Read `docs/PLAN.md` (§0 first) and `STATUS.md` before any work. Update
STATUS.md and commit at the end of every work unit.

## Project

Interactive Azur Lane Live2D wallpaper for niri (Wayland), by porting the
approach of azurlane.nagami.moe's public web viewer to a local webview
layer-shell surface. Web page (pixi-live2d-display) renders; a Python/GTK
shell hosts it on the background layer. A native Cubism C++ renderer exists
in `src/model/` but is parked (open bug, PLAN §9-P) — do not resume without
cause.

## Build & verify

```sh
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo && ninja -C build
./build/mizu-l2d --help   # daemon (spikes + IPC still live here)
./build/mizu-l2d-ctl ping # IPC roundtrip
```

Assets live OUTSIDE the repo in `~/.local/share/mizu/l2d/` (fetch with
`scripts/fetch-model.sh <prefab>`). The web viewer is served from `web/`
(R0.3 onward): `python3 scripts/serve.py 8787` (R1c.2: serves `web/` on
127.0.0.1 plus the on-demand `/api/download` used by the picker's Tải button;
plain `python3 -m http.server 8787 -d web` works for everything else).

## Hard rules

1. **Never commit**: `build/`, `third_party/cubism/`, any Azur Lane asset
   (models/textures/motions/backgrounds), `live2dcubismcore.min.js`.
   `.gitignore` covers the first two; keep it that way.
2. Assets are Manjuu/Yostar/Bilibili IP and Cubism Core is Live2D
   proprietary: personal local use only, never publish, never redistribute.
3. Verify before claiming done: build green + the unit's acceptance criteria
   (PLAN §8) actually executed. Report failures honestly with output.
4. Do not re-litigate PLAN §4 decisions. New evidence → STATUS.md + stop for
   human review.
5. Match the existing code style; comments only for non-obvious constraints.
6. English for code, commit messages (conventional), and docs; conversation
   with the owner in Vietnamese.
7. When testing on the live desktop: switch to an empty workspace first
   (`niri msg action focus-workspace-down`), restore afterwards
   (`focus-workspace-up`). The owner is watching — brief navy/art flashes on
   the background layer are expected and fine.
8. MESA_DEBUG=1 is the first tool for any silent GL misbehavior (PLAN §6.8).
