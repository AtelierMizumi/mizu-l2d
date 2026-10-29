# mizu-l2d — Product Specification (v3, DRAFT for owner review)

Status: DRAFT, 2026-10-29. Written for the owner and for agents or contributors who
will build the project. Supersedes PLAN §1 (goal, non-goals) and PLAN §7 (licensing)
for the scope of a public, multi-environment extension. PLAN §4 decisions are kept;
D-R2 is reinterpreted (the Python/GTK shell becomes the reference Linux host adapter,
not the only host). Items marked **[verify]** are unconfirmed and need a spike before
they become requirements. Items marked **[owner]** need a decision before implementation.

## 1. Vision

mizu-l2d is an open, host-agnostic engine that displays a Live2D (Cubism) character as
an interactive desktop background. The engine is portable. A thin **host adapter** per
desktop environment or window manager places it on the desktop. Character content is
supplied by the user and is not part of the project.

"Official" means: a versioned protocol, a published compatibility matrix that states what
is tested on which environment, reproducible tests, a documented install path, and clean
licensing. It does not mean bundled content.

## 2. Goals and non-goals

Goals
- One character per output, on the desktop background layer, with mouse-follow,
  tap/hotspot motions, idle poses, and a camera (pan, zoom, reset).
- The same engine on every supported host. Adding a host means writing an adapter,
  not changing the engine.
- Smooth and light: vsync-driven, idle-FPS ramp, and resource budgets that are measured
  (target below ~400 MB RSS per output set, verified in R2).
- Runtime works offline. Network is used only by an explicit user command.
- Crash-safe: a crashed host restarts without leaving the desktop broken.

Non-goals (for v3)
- Multi-character scenes, sound or voice playback.
- macOS. Not planned.
- Shipping any Azur Lane or other third-party character content, data, or Cubism Core
  (see §9).
- Native C++ Cubism renderer. Parked (PLAN §9-P). Not a release dependency.

## 3. Compatibility tiers

A tier is "supported" only when its conformance checklist (§6) passes on the listed
environment and the matrix is updated. Until then it is "experimental" or "planned".

| Tier | Environment | Host approach | Status |
|---|---|---|---|
| 1 | niri (reference, owner's daily driver) | wlr-layer-shell, background layer, GTK4 + gtk4-layer-shell + WebKitGTK | In progress (R0–R2) |
| 1 | Hyprland, sway | same as tier 1 | Planned. sway needs checks for background layering **[verify]** |
| 1 | KDE Plasma (Wayland) | same layer-shell host if KWin behaves | Planned. Kitty's table lists KWin as working **[verify, spike S5]** |
| 1 | labwc, river | same as tier 1 | Planned. Layer-shell support not confirmed **[verify]** |
| 2 | KDE Plasma, native | Plasma wallpaper plugin (QML) that embeds or launches the engine | Spike only, if tier 1 KWin path is inadequate. Plasma's wallpaper API is thinly documented **[verify, spike S6]** |
| 3 | GNOME (Mutter) | GNOME Shell extension host, or a best-effort window | Spike only. Mutter does not implement wlr-layer-shell **[verify, spike S7]** |
| 4 | X11 (any WM) | Desktop-type window (`_NET_WM_WINDOW_TYPE_DESKTOP`) | Best effort, later **[verify]** |
| 5 | Windows | WorkerW parenting + WebView2 | Research only. Relies on undocumented Progman/WorkerW behavior that changes across builds **[verify, spike S8]** |

Each new environment starts as a spike with a go/no-go decision recorded in STATUS.md.

## 4. Architecture

```
            ┌────────────────────────── host adapter (one per environment) ─────────────────┐
desktop ──► │ surface per output  ·  pointer/keyboard in  ·  idle/cover signals  ·  control │
            │ hosts a WebView that loads the engine page                                    │
            └───────────────┬───────────────────────────────────────────────▲───────────────┘
                            │ host contract (§5)                            │ control plane
            ┌───────────────▼───────────────┐                               │ (JSON, §5.3)
            │ engine: web page              │◄──── content pack (§4.3) ─────┘ mizu-l2d-ctl
            │ pixi + pixi-live2d-display,   │      + user-supplied Cubism Core (§9)
            │ WebGL, scene + camera + UI    │
            └───────────────────────────────┘
```

### 4.1 Engine
- A static web page (HTML, JS, CSS) that renders one character per surface using WebGL.
- Libraries: pixi.js and pixi-live2d-display (both MIT per PLAN §7; re-check the exact
  versions at vendoring time). The Cubism Core runtime is loaded from a path the user
  configures.
- Why a web engine: it is the only renderer that runs unchanged on every host WebView
  (WebKitGTK, WebView2, and others). It also makes UI chrome ordinary HTML/CSS. The
  native C++ renderer is parked (PLAN §9-P), so it cannot block the spec.
- The engine has no compositor-specific code. Everything platform-specific is in the host.

### 4.2 Host adapter
- One process per host. It creates one surface per output, hosts the engine page, forwards
  input, reports idle and cover state, and exposes the control plane.
- Reference adapter (tier 1): Python, PyGObject, gtk4-layer-shell, WebKitGTK 6.0
  (GTK4 build, `webkitgtk-6.0` package). WebKitGTK 4.1 links GTK3 and cannot be
  combined with gtk4-layer-shell (PLAN D-R2, R2a). The adapter must be replaceable without touching the engine.
- Adapters are separate modules with the same contract. The contract is the source of truth,
  not any one implementation.

### 4.3 Content pack
- A directory with a manifest `mizu-pack.json` (our schema, versioned) and standard
  Cubism files: `*.model3.json`, `*.moc3`, textures, motions, physics.
- Optional `interaction.json` (our schema): hotspot regions, idle pose list, mouse-follow
  parameter ranges, placement (scale, offset), and palette hints.
- The engine loads any valid Cubism 3/4/5 pack. It must not require vendor-specific fields.
  Missing `interaction.json` falls back to motion groups only.
- Converters from third-party sources (for example, the owner's Azur Lane mirror) live
  outside the public tree (§9).

### 4.4 Configuration
- `$XDG_CONFIG_HOME/mizu-l2d/config.toml` on Linux. Other platforms use their native
  config location (decided per adapter).
- A `schema` key in the file. Unknown keys are reported, not silently dropped.
- Example and reference: `docs/config.example.toml`.

## 5. Host contract (what makes multi-environment work)

This section is the public interface. Changing it needs a protocol version bump (§8).

### 5.1 Host to engine (per surface)
- `surface.create {id, width, height, scale}` and `surface.resize`.
- `input.pointer {id, x, y, buttons, kind}` in surface-local coordinates. `kind` is
  `enter`, `motion`, `leave`, `press`, or `release`.
- `state.quiet {id, quiet}`: the host says the desktop is idle, or a window covers the
  surface (fullscreen). The engine drops to `idle_fps`. Hosts must send `quiet: false`
  on the next interaction.
- `surface.destroy {id}`.

### 5.2 Engine to host (events)
- `ready {id}`, `error {id, code, message}`, and `stats {id, fps, rss_mb}` (rate-limited).
- `palette {id, colors}` (R3, optional).

### 5.3 Control plane (JSON lines, same command set on every host)
- Commands: `ping`, `status`, `camera {zoom|pos|reset}`, `motion {group}`, `model {id}`,
  `perf`.
- Transport: unix socket in `$XDG_RUNTIME_DIR` on Linux. Page-side transport is
  WebSocket, owned by the host. Windows uses a named pipe **[verify]**.
- Every message carries `"v": <protocol version>`. Unknown commands get an `error` reply,
  not a crash.

### 5.4 Adapter requirements (must be provable)
- Pointer events reach the engine while the surface sits on the background layer
  (S1 proved this on niri).
- Surfaces track output hotplug, scale changes, and compositor reloads.
- Restart on crash without losing the desktop background.
- Idle detection and cover detection: each adapter names its data source (niri event
  stream, KWin D-Bus, sway IPC, and so on) **[verify per environment]**.

## 6. Quality gates

- **Engine unit tests** (headless, no compositor): pack loader, config schema, protocol
  parsing, camera math, hotspot hit-test math.
- **Conformance suite:** a fake host that drives the engine through the contract in §5.
  Every adapter must pass it.
- **Per-environment checklist** (manual, with evidence): pointer on background layer,
  hotplug, reload, quiet/cover, RSS and FPS measured with a stated method. Results go
  in the compatibility matrix with the date and the versions tested.
- **Verification rule:** a claim of support needs an executed check and recorded output,
  as in CLAUDE.md.

## 7. Budgets

- Idle: about 30 FPS or less while quiet. Full rate restores on the next interaction.
- Memory: measured per output. The target stays under ~400 MB RSS total, and the
  measurement method is stated in each report.
- No periodic work while quiet. Measured with idle CPU and GPU readings.

## 8. Versioning and stability

- Engine, adapter, and CLI follow semantic versioning. The public host contract has its
  own protocol version (`v` field).
- Pack manifest has a `schema` version. The engine reads older schemas for one major version.
- Deprecations are announced in CHANGELOG.md for one minor release before removal.
- Compatibility matrix is versioned with each release.

## 9. Licensing and IP (changed from PLAN §7; owner decision required)

- **Cubism Core** (`live2dcubismcore.min.js`) is Live2D proprietary software under the
  Live2D Proprietary Software License Agreement. It binds the user, not the project, and
  the license text should be read before any public release. The forum reply cited below
  says modifying the distributed file is prohibited. Therefore:
  - It is never bundled or modified in any artifact.
  - The engine checks a user-configured path and shows a clear message if it is missing.
  - Our docs tell the user to obtain it from Live2D and accept Live2D's terms.
  Sources: [Live2D proprietary license](https://live2d.com/eula/live2d-proprietary-software-license-agreement_en.html),
  [Live2D Support forum reply](https://community.live2d.com/discussion/comment/2551).
  This section is a technical summary, not legal advice.
- **Azur Lane content** (models, textures, motions, backgrounds, nagami data) is
  Manjuu/Yostar/Bilibili IP. Under PLAN §7 it is personal use only.
  - The public project contains no such content, no such data, and no tooling that fetches
    it by default.
  - Azur Lane-specific converters and fetch scripts stay in a private overlay (for example
    the owner's dotfiles), outside the public repo.
  - **[owner]** D-L2: confirm this split. Decide whether the private overlay stays
    private permanently.
- **Engine license:** **[owner]** D-L1. Choose the license for engine, adapters, and docs.
  Recommendation: MIT, or Apache-2.0 if patent language matters. Pick one and put it in
  `LICENSE` before the first public release.
- **Third-party code:** pixi, pixi-live2d-display (MIT per PLAN §7; re-check at vendoring).
  AGPL code (for example alg-wiki/AzurLaneL2DViewer) is not copied (PLAN §7).
- **Naming and branding:** **[owner]** D-N1. The public name should not use the Azur Lane
  brand or imply affiliation with Manjuu or Yostar. "mizu-l2d" is generic enough, but the
  README must state that the project is not affiliated with those companies.

## 10. Phases (revises PLAN §8 for v3)

- **P0 (current, owner's environment):** R0 baseline, R1 web MVP, R2 niri wallpaper.
  Exit: tier 1 niri supported. This is the reference implementation of §4–§5.
- **P1 (extract contract):** write the §5 contract as a conformance suite and a fake host.
  Split the engine from the niri host. Pack format `mizu-pack.json` v1. Exit: niri host
  passes the suite.
- **P2 (tier 1 verification):** spikes S5 (KWin layer-shell, background layer, pointer),
  Hyprland and sway parity. Exit: matrix rows for each, with evidence.
- **P3 (tier 2–5 go/no-go):** spikes S6 (Plasma native), S7 (GNOME), S8 (Windows).
  Each ends with go, no-go, or defer recorded in STATUS.md.
- **P4 (official release):** packaging (AUR first), CHANGELOG, CONTRIBUTING, license,
  README rewrite, compatibility matrix in the README.

Spike IDs S5–S8 are new. S1–S4 keep their meaning from the design doc §2.

## 11. Conflicts with existing documents (to resolve)

| Document | Conflict | Resolution |
|---|---|---|
| `README.md` (mizu-l2d) | Said "Native C++ (Cubism SDK for Native), no webview" | Direction paragraph updated 2026-10-29; full rewrite at P4 |
| `docs/PLAN.md` §1 | Non-goals list X11, Windows, macOS, public distribution | Superseded by §2 here |
| `docs/PLAN.md` §7 | Personal-only rule applies to the whole project | Superseded for the engine; content rule stays (§9) |
| `CLAUDE.md` hard rule 2 | "Never publish" applies to all assets | Still applies to content. Its wording should say the engine is public |
| `dotfiles/docs/research/mizu-l2d-tech-design.md` | Native renderer as the product (D1) | Superseded banner added 2026-10-29; file kept as the record of the earlier analysis |

## 12. Decisions

Owner approved the recommendations below on 2026-10-29.

1. **D-L1** Engine license: MIT. Put `LICENSE` in the repo before the first public release.
2. **D-L2** Azur Lane content, its converters and fetch scripts stay in a private overlay,
   permanently. The public repo ships no content and no Cubism Core.
3. **D-N1** Name stays `mizu-l2d`. README states the project is not affiliated with Manjuu
   or Yostar. No Azur Lane branding in the public name or logo.
4. **D-S1** Run spikes S5 (KWin layer-shell) and S6 (Plasma native) before committing to any
   tier 2 to 5 environment.
5. **D-P1** Standalone repo is canonical. A submodule in dotfiles is a development
   convenience only. Creating the GitHub remote needs its own confirmation.
6. **S0-perf** (from the performance discussion): run the A/B measurement (WebKitGTK 6.0
   page vs native daemon) before R2. The web vs native host choice follows the numbers.

## 13. Sources consulted for this draft

- Layer-shell support by compositor (secondary source, panel-oriented):
  [Kitty docs](https://3l0c-wk.readthedocs.io/en/latest/faq/index.html).
  GNOME Mutter lacks support per a [JetBrains compose-multiplatform issue](https://github.com/JetBrains/compose-multiplatform/issues/4518)
  (secondary; confirm against upstream Mutter before relying on it).
- Live2D license: [proprietary license](https://live2d.com/eula/live2d-proprietary-software-license-agreement_en.html),
  [forum reply on modifying Core](https://community.live2d.com/discussion/comment/2551).
- KDE Plasma wallpaper plugins (QML route, thin docs):
  [KDE Discuss thread](https://discuss.kde.org/t/wanting-to-contribute-a-daily-wallpaper-plugin-where-can-i-start/16569).
- Windows WorkerW technique (undocumented, fragile):
  [AutoHotkey forum thread](https://www.autohotkey.com/boards/viewtopic.php?p=425051).

Gaps: no source confirmed KWin's background-layer behavior for this host, Plasma's
`WallpaperInterface`, or Windows Progman/WorkerW behavior on current builds. Those are
the spikes above.
