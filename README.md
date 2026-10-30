# mizu-l2d

Interactive Live2D (Cubism) wallpaper for niri and other wlr-layer-shell
compositors. A character renders on the background layer in a WebKitGTK view
and responds to pointer follow, tap hotspots, and camera controls. Paired with
the [mizu quickshell rice](https://github.com/AtelierMizumi/dotfiles) it also
drives the desktop theme colors and ships a settings page, model browser, and
quick-panel tile.

**Status: v0.1.0-beta.** The reference host is the Python/GTK daemon in
`wall/`. The native C++ renderer in `src/` is parked (PLAN §9-P).

Character content is **not** included and must never be committed — bring your
own and keep it local (see [Licensing](#licensing)).

## Components

| Path | What it is |
| --- | --- |
| `wall/mizu-l2d-wall.py` | Host daemon: one gtk4-layer-shell BACKGROUND window per output, a WebKitGTK 6.0 view loading `web/index.html?wall=1`, monitor hotplug, SIGTERM restore of the previous wallpaper, mirror layout. |
| `wall/mizu-l2d-ctl.py` | Control CLI over a JSON-lines unix socket at `$XDG_RUNTIME_DIR/mizu-l2d-wall.sock`: `status`, `model`, `camera`, `motion`, `tips`, `lock` (placement), `gaze`, `lang`, `pause`, `resume`, `fps`, `eval`. |
| `web/` | The viewer page: pixi.js 6.5.10 + pixi-live2d-display 0.4.0 (vendored, MIT), model picker, dialogue. |
| `scripts/serve.py` | Serves `web/` on `127.0.0.1:8787` and exposes `POST /api/download` (header `X-Mizu-Action: download`, foreign Origin/Host get 403) for on-demand model download, one at a time, catalog-gated. |
| `scripts/fetch-model.sh` | Downloads one model + interaction data into `~/.local/share/mizu/l2d/<name>/`. |
| `scripts/fetch-web-deps.sh` | Re-vendors the MIT web bundles into `web/vendor/` (pinned, with license texts). |
| `src/`, `CMakeLists.txt` | Parked native C++ renderer and its ctl (not a release dependency). |
| `docs/` | `SPEC.md` (product spec), `PLAN.md` (work units, pitfalls), `HANDOVER.md` (agent/owner protocol), `config.example.toml`. |
| `systemd/` | `mizu-l2d-wall.service` — the shipped user unit; `mizu-l2d.service` — unit for the parked native binary. |

## Install (Arch Linux)

```sh
sudo pacman -S --needed gtk4 gtk4-layer-shell webkitgtk-6.0 python-gobject
git clone <this-repo> ~/Projects/Tools/mizu-l2d
cd ~/Projects/Tools/mizu-l2d
./scripts/fetch-web-deps.sh   # vendor pixi + pixi-live2d-display (MIT), idempotent
```

The Live2D Cubism Core is proprietary and never committed. Download it from
Live2D after accepting their SDK license and place it at
`~/.local/share/mizu/cubism/live2dcubismcore.min.js`, then link it in:

```sh
ln -s ~/.local/share/mizu/cubism/live2dcubismcore.min.js web/vendor/live2dcubismcore.min.js
```

## Run

Standalone:

```sh
python3 wall/mizu-l2d-wall.py                 # starts serve.py too if 8787 is free
python3 wall/mizu-l2d-ctl.py status
python3 wall/mizu-l2d-ctl.py model gaoxiong_7
python3 wall/mizu-l2d-ctl.py camera zoom 1.3
```

As a systemd user service (what the mizu shell drives):

```sh
cp systemd/mizu-l2d-wall.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mizu-l2d-wall
```

## Configuration

`~/.config/mizu-l2d/config.toml` — see
[`docs/config.example.toml`](docs/config.example.toml) for the full reference.

```toml
schema = 1

[wall]
model = "gaoxiong_7"           # prefab name under ~/.local/share/mizu/l2d/
outputs = ["eDP-1"]            # omit to draw on every connected output
mirror = true                  # see "Mirror layout" below
```

## Mirror layout

With `[wall] mirror = true` only the first output runs a real WebKit view;
every other output shows a `GtkPicture` that repaints it. One
`WebKitWebProcess` serves every screen instead of one per screen (WebKitGTK
has no shared process model), which cuts wallpaper RAM roughly N×; only the
first screen stays interactive. Measured on a 2-output setup: ~970 MB →
~434 MB of WebKit RSS.

## Models

Models are prefabs (a `.model3.json` plus textures/motions) under
`~/.local/share/mizu/l2d/<prefab>/`. One-off download:

```sh
scripts/fetch-model.sh <prefab> [--bg]   # --bg also fetches the skin background used for theming
scripts/fetch-model.sh <prefab> --verify # check the installed files against the recorded sha256 manifest
scripts/mizu-l2d-cache.py status         # disk usage vs. quota, per-model ages
scripts/mizu-l2d-cache.py enforce        # evict the oldest unpinned models down to the 2 GB quota
scripts/mizu-l2d-cache.py pin <prefab>   # spare a favorite from eviction
```

Downloads are manifest-driven and atomic (a failed run never leaves a half
model), and the wallpaper host records every model load in the ledger at
`~/.local/share/mizu/l2d/.ledger.json`, which the cache tool evicts by.

The in-shell model browser downloads on demand through `serve.py`'s
`POST /api/download`, gated by the local catalog. The catalog and game-data
mirrors (`web/data/`, `web/assets/`) are **gitignored** — content never enters
git (SPEC §12). For the plan to move from a locally-stored library to
on-demand remote sources, see
[`docs/remote-model-sources.md`](docs/remote-model-sources.md).

## mizu shell integration

The [dotfiles rice](https://github.com/AtelierMizumi/dotfiles) (branch
`feat/mizu-l2d`) adds: `L2dService` (systemd lifecycle + watchdog + settings),
a Quick Panel tile, a settings page (model browser, screens, layout, gaze,
tips, language), and `palette/l2d_palette.py` — it extracts an accent color
from the model's textures and its background image, then regenerates the
shell's Material-3 tokens (`tokens.json`) and niri's `colors.kdl` so the whole
desktop follows the character. Stopping the wallpaper restores the static
wallpaper's palette.

## Licensing

- **Code in this repo:** MIT — see [LICENSE](LICENSE).
- **Vendored web bundles:** pixi.js and pixi-live2d-display are MIT; each
  vendored bundle carries its package LICENSE text
  (`web/vendor/SOURCES.md`).
- **Live2D Cubism Core:** Live2D Proprietary. Never committed; mirrored
  locally by you after accepting their license.
- **Character content** (models, textures, motions, dialogue — e.g. Azur Lane
  assets are Manjuu/Yongshi / Yostar / Bilibili IP): third-party IP, personal
  local use only. Never enters this repo.

> This repository is currently **private**: per SPEC §12, the on-demand
> catalog and downloader live here only while the project is local-only; they
> must move to a private overlay before any public release.
