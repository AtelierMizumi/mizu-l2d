# Mizu-L2D: Optimization, Bug Fixes & Next-Gen Architecture Plan

> **Status:** Draft / Ready for Review  
> **Target Branch:** `master` (after merge of `feat/interaction-parity`)  
> **Scope:** R1 (Branch Merge), R2 (The Mirror Spike < 400MB RAM), R3 (Pause on Cover / Idle), R4 (Monitor Hotplug)  
> **Binding Authorities:** `docs/PLAN.md` (§7 Perf Budget, §8 Units R2b–R2d), `docs/PARITY-SPEC.md`, `STATUS.md`

---

## 1. Executive Summary & Goals

The `mizu-l2d` project has achieved 100% test-passing interaction parity on `feat/interaction-parity` (48/48 unit tests, 11/11 AC probes). However, as a persistent desktop live wallpaper on Arch Linux (`niri` Wayland compositor, dual-monitor `eDP-1` + `HDMI-A-1`), it faces three critical operational bottlenecks:

1. **Dual-Monitor Memory Explosion (~970MB RSS vs 400MB Budget):** WebKitGTK 6.0 assigns an independent `WebKitWebProcess` (~450MB each) to every `WebKitWebView`. Running two monitors exhausts the 400MB memory budget.
2. **Resource Consumption While Covered (Battery & GPU Waste):** When browser or editor windows cover the entire workspace, `mizu-l2d` continues rendering at 60/144 FPS, draining battery and generating heat.
3. **Monitor Hotplug Disconnect Crashes:** Unplugging or reconnecting the external HDMI monitor while the daemon is running risks crashing or leaving the GTK layer-shell in an invalid state.

This plan details the technical architecture, implementation steps, risk mitigations, and verification criteria to resolve all three bottlenecks while merging `feat/interaction-parity` into `master`.

---

## 2. Technical Architecture & Constraints

```mermaid
flowchart TD
    subgraph Compositor["Arch Linux / Niri Wayland Compositor"]
        NiriIPC["niri msg event-stream / IPC"]
        DisplayMgr["Gdk.Display / Monitors (items-changed)"]
    end

    subgraph WallHost["Python GTK4 Host (wall/mizu-l2d-wall.py)"]
        EventLoop["GLib Event Loop"]
        MonitorSync["Monitor Lifecycle & Hotplug Manager"]
        CoverDetector["Cover & Idle State Detector"]
        SourceWin["Primary Window (eDP-1)\nWebKit.WebView (Single WebProcess)"]
        MirrorWin["Secondary Window (HDMI-A-1)\nGtk.Picture + Gtk.WidgetPaintable"]
    end

    subgraph WebCore["Web Process (web/main.js & PixiJS)"]
        PixiApp["PixiJS 6.5.10 Application"]
        Ticker["app.ticker (60/144 FPS)"]
        Engine["MizuEngine (drags, params, zones)"]
        PauseAPI["window.__mizuSetPaused(bool)\nwindow.__mizuThrottleFps(fps)"]
    end

    NiriIPC -->|Workspaces / Windows / Focus| CoverDetector
    DisplayMgr -->|Monitor Added / Removed| MonitorSync
    CoverDetector -->|Socket / WebKit eval_js| PauseAPI
    PauseAPI -->|ticker.stop() / resume()| Ticker
    SourceWin -.->|WidgetPaintable Repaint| MirrorWin
```

### Constraints (verbatim from PLAN.md & SPEC.md):
- **Memory Ceiling:** Total combined RSS for all `mizu-l2d` processes (`mizu-l2d-wall`, `WebKitWebProcess`, `WebKitNetworkProcess`) must remain **< 400MB** on dual monitors.
- **Engine Purity:** Zero per-skin hardcodes in `web/` or `wall/`. Everything remains strictly data-driven via `drags[]` and `skins.json`.
- **Zero-Blink Compositing:** Wallpaper windows remain strictly on the Wayland `BACKGROUND` layer via `gtk4-layer-shell`, anchored to all 4 edges, exclusive zone -1.
- **Test Integrity:** All 48 unit tests and 11 AC probes must remain 100% green before, during, and after merges.

---

## 3. Detailed Phase Breakdown

### Phase 1: Branch Integration & Merge Gate (R1)

**Objective:** Safely integrate `feat/interaction-parity` into `master` with zero regressions and clean Git history.

- [ ] **Task 1.1: Pre-Merge Verification Sweep**
  - Execute full unit test suite: `node --test tests/unit/` (verify 48/48 PASS).
  - Execute full AC probe suite: `node tests/probe/run-all.mjs` (verify 11/11 PASS).
  - Execute hardcode grep gate: `rg "antu_2|gaoxiong_7|benningdun" web/engine/` (must return 0 matches).
  - Check clean working directory: `git status --porcelain`.
- [ ] **Task 1.2: Merge into Master**
  - Switch to `master`: `git checkout master`.
  - Fast-forward or merge `feat/interaction-parity`: `git merge --ff-only feat/interaction-parity` (or clean merge commit).
- [ ] **Task 1.3: Post-Merge Verification & Documentation**
  - Re-run `node --test tests/unit/` and `node tests/probe/run-all.mjs` directly on `master`.
  - Verify [STATUS.md](file:///home/thuanc177/Projects/Tools/mizu-l2d/STATUS.md) accurately reflects verified state.

---

### Phase 2: The Mirror Spike (R2d.2) — Dual-Monitor RAM < 400MB

**Objective:** Run `mizu-l2d-wall.py` across two monitors (`eDP-1` and `HDMI-A-1`) using a single `WebKitWebProcess` mirrored via `Gtk.WidgetPaintable` to stay under 400MB RSS.

#### Architectural Mechanics:
1. **Primary Screen (`source_key`, eDP-1):**
   - Instantiates a single `WebKit.WebView()`.
   - WebKit spawns 1 `WebKitWebProcess` (~450MB) and 1 `WebKitNetworkProcess` (~75MB).
2. **Secondary Screen (`HDMI-A-1`):**
   - Instead of a second `WebKit.WebView`, instantiates `Gtk.Picture()`.
   - Connects `paintable = Gtk.WidgetPaintable(); paintable.set_widget(source_view)`.
   - Sets `picture.set_paintable(paintable)` and `picture.set_content_fit(Gtk.ContentFit.COVER)`.
3. **Input Handling on Mirror:**
   - Attach `Gtk.GestureClick` to the mirror window.
   - On click at `(x_mirror, y_mirror)`:
     - Map coordinates from HDMI-A-1 dimensions to source eDP-1 dimensions (scaling based on aspect ratios).
     - Forward the synthesized event to `source_view` via `source_view.evaluate_javascript("window.__mizuSyntheticTap(x, y)")`.

#### Tasks & Implementation:
- [ ] **Task 2.1: Standalone Mirror Spike Script (`spikes/s2-mirror/mirror_bench.py`)**
  - Create a lightweight testbed to isolate `Gtk.WidgetPaintable` behavior on WebKitGTK 6.0 under Wayland.
  - Test whether WebKit's hardware-accelerated WebGL canvas repaints continuously at 60/144 FPS on the secondary surface or suffers texture stalling.
- [ ] **Task 2.2: Refine `wall/mizu-l2d-wall.py` Mirror Implementation**
  - Audit `make_surface()` in `wall/mizu-l2d-wall.py`.
  - Ensure `Gtk.WidgetPaintable` cleanly updates without buffer leakage.
  - Implement coordinate transformation logic for input events from mirror to source.
- [ ] **Task 2.3: Memory Measurement Harness (`scripts/measure-rss.sh`)**
  - Create a script that samples RSS of `mizu-l2d-wall.py` + all child WebKit processes every second over 60 seconds.
  - Compute average and peak RSS on dual monitors.
  - **Acceptance Gate:** Peak RSS must remain **< 400MB** (Target: ~380–395MB).

---

### Phase 3: Pause on Cover & Idle (R2b.2) — Power & GPU Conservation

**Objective:** Reduce CPU and GPU usage to near-zero when the wallpaper is obscured by windows or when the user is idle.

#### Architectural Mechanics:
1. **Niri Compositor State Stream:**
   - Spawn an async worker or GLib IO channel reading `niri msg --json event-stream`.
   - Listen for:
     - `WorkspaceActivated`: If the active workspace has fullscreen or maximized windows covering the screen.
     - `WindowsChanged`: Check if current workspace has full-covering tiled windows.
     - Alternatively, use niri's workspace view visibility.
2. **Idle Detection:**
   - Integrate with system idle notification (via `ext-idle-notify-v1` protocol or timeout `quiet_time_s = 60s` with no mouse motion).
3. **Web Renderer Throttling (`web/main.js`):**
   - Expose `window.__mizuSetPaused(isPaused)` and `window.__mizuSetIdleFps(targetFps)`.
   - When covered:
     - Call `app.ticker.stop()` or pause the requestAnimationFrame loop.
     - Live2D physics and vertex calculation stops.
     - GPU utilization drops to 0%.
   - When uncovered:
     - Call `app.ticker.start()`.
     - Reset `lastTime` on ticker to prevent delta-time explosion (jumping/teleporting meshes).

#### Tasks & Implementation:
- [ ] **Task 3.1: Implement Web-side Pause API (`web/main.js`)**
  - Add `window.__mizuSetPaused(paused)`:
    ```javascript
    window.__mizuSetPaused = function(paused) {
      if (paused) {
        if (app && app.ticker && app.ticker.started) {
          app.ticker.stop();
          window.__mizuIsPaused = true;
        }
      } else {
        if (app && app.ticker && !app.ticker.started) {
          app.ticker.start();
          window.__mizuIsPaused = false;
        }
      }
    };
    ```
  - Guard against animation jump: Ensure timestamp delta is clamped when unpausing.
- [ ] **Task 3.2: Implement Niri Event Stream Listener in `wall/mizu-l2d-wall.py`**
  - Add `NiriMonitor` thread using `subprocess.Popen(["niri", "msg", "--json", "event-stream"], ...)`
  - Parse events: determine when all outputs are covered by windows.
  - Dispatch GLib idle call to invoke `evaluate_javascript("window.__mizuSetPaused(true)")`.
- [ ] **Task 3.3: Verification Probe (`tests/probe/p2_pause.mjs`)**
  - Verify that invoking `window.__mizuSetPaused(true)` stops ticker increments.
  - Verify that invoking `window.__mizuSetPaused(false)` resumes rendering smoothly.
  - Measure GPU/CPU difference via `intel_gpu_top` / `pidstat`.

---

### Phase 4: Monitor Hotplug & Dynamic Failover (R2d.3)

**Objective:** Handle plugging/unplugging HDMI monitors without process termination, memory leaks, or black screens.

#### Architectural Mechanics:
1. **Source Screen Disconnect:**
   - If `HDMI-A-1` is unplugged and it was a mirror: Destroy `Gtk.Picture` window cleanly.
   - If `eDP-1` (the `source_key`) is unplugged, or laptop lid is closed:
     - The remaining active monitor (`HDMI-A-1`) must be promoted to the primary source.
     - Destroy its `Gtk.Picture` and instantiate a new `WebKit.WebView` loading `self.url`.
     - Update `self.source_key`.
2. **Reconnection:**
   - When HDMI monitor is plugged in: `Gdk.Display` emits `items-changed`.
   - Re-evaluate monitor topology in `sync_monitors()`.
   - If primary already exists, cleanly attach `Gtk.Picture` mirror.

#### Tasks & Implementation:
- [ ] **Task 4.1: Source Failover Logic in `wall/mizu-l2d-wall.py`**
  - Refactor `sync_monitors()` to handle source promotion deterministically.
  - Explicitly clear `WidgetPaintable` references before destroying windows to prevent GTK crashes.
- [ ] **Task 4.2: Hotplug Simulation & Stress Test**
  - Run `mizu-l2d-wall.py`.
  - Simulate hotplug cycles using Wayland compositor commands or hardware HDMI toggling.
  - Verify zero crash logs in `journalctl --user -u mizu-l2d-wall`.

---

## 4. Risk Matrix & Mitigations

| Risk | Severity | Probability | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Gtk.WidgetPaintable WebGL Texture Stalling** | HIGH | MEDIUM | If WebKit hardware accelerated texture cannot be painted via GTK4 Paintable on Mesa Iris Xe, benchmark fallback: single view on active screen only, or low-rate frame snapshotting. |
| **Input Coordinate Mismatch on Mirror** | MEDIUM | LOW | Use normalized [0.0, 1.0] bounding coordinates derived from `Gtk.Picture` allocation box and scale to source `internalModel` dimensions. |
| **Niri Event-Stream Format Drift** | MEDIUM | LOW | Use robust JSON parsing with fallback to polling `niri msg --json workspaces` every 2s if stream drops. |
| **Mesh Jumps on Resume from Pause** | MEDIUM | MEDIUM | Clamp delta time (`dt`) on first frame of ticker resumption to `1.0 / 60.0`. |

---

## 5. Acceptance Verification Gates

| Gate ID | Target Metric | Verification Command / Method |
| :--- | :--- | :--- |
| **G-1: Interaction Parity** | 100% Pass (48/48 units, 11/11 probes) | `node --test tests/unit/` && `node tests/probe/run-all.mjs` |
| **G-2: Dual-Monitor RSS** | Total RSS < 400 MB | `ps -o rss,cmd -C WebKitWebProcess,python3 \| awk '{s+=$1} END {print s/1024 \" MB\"}'` |
| **G-3: Idle / Covered CPU** | CPU utilization drops by > 80% | `pidstat -p <pid> 1 10` during window cover |
| **G-4: Hotplug Survival** | 0 crashes during 5 disconnect cycles | `tail -f ~/.local/state/mizu-l2d.log` during HDMI plug/unplug |
