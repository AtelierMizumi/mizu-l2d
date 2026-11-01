#!/usr/bin/env python3
"""mizu-l2d wallpaper host for niri and other wlr-layer-shell compositors (R2a).

One GTK4 window per monitor, placed on the BACKGROUND layer by gtk4-layer-shell,
anchored to all four edges, with a WebKitGTK 6.0 view that loads the web viewer
(web/index.html?wall=1). Monitors are tracked for hotplug. A JSON-lines control
socket in $XDG_RUNTIME_DIR runs the commands in SPEC §5.3 against every view.

Mirror layout: with [wall] mirror = true only the first output runs a real
WebKit view; every other output shows a GtkPicture that repaints it, so one
WebKitWebProcess serves every screen (WebKitGTK has no shared process model).
Only the first screen is interactive in this mode.

usage: wall/mizu-l2d-wall.py [--url URL] [--no-serve]
  --url       page to load (default http://127.0.0.1:8787/?wall=1)
  --no-serve  do not start scripts/serve.py when nothing listens on the port
  --outputs   connectors to draw on (overrides config)

config: $XDG_CONFIG_HOME/mizu-l2d/config.toml (default ~/.config/mizu-l2d/config.toml)
  schema = 1
  [wall]
  outputs = ["eDP-1"]      # omit for every output
  mirror = true            # omit for an independent model on every output
"""
import argparse
import atexit
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import tomllib
import urllib.parse
from pathlib import Path

LAYER_SHELL_LIB = "/usr/lib/libgtk4-layer-shell.so"


def ensure_layer_shell_preload():
    """gtk4-layer-shell must load before libwayland-client. A dynamically linked
    Python loads libwayland through GTK first, so the library is preloaded by
    re-executing once with LD_PRELOAD (see the gtk4-layer-shell linking notes)."""
    preload = os.environ.get("LD_PRELOAD", "")
    if "libgtk4-layer-shell" in preload or not Path(LAYER_SHELL_LIB).exists():
        return
    os.environ["LD_PRELOAD"] = f"{preload}:{LAYER_SHELL_LIB}" if preload else LAYER_SHELL_LIB
    os.execv(sys.executable, [sys.executable, *sys.argv])


ensure_layer_shell_preload()

import gi  # noqa: E402

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
gi.require_version("Gtk4LayerShell", "1.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, Gtk4LayerShell as LayerShell, WebKit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SERVE = ROOT / "scripts" / "serve.py"
PROTOCOL_VERSION = 1
DEFAULT_URL = "http://127.0.0.1:8787/?wall=1"
JS_TIMEOUT_S = 5.0
LIVE_PUSH_S = 5
QS_LIVE = ["qs", "ipc", "-c", "mizu", "call", "mizu", "liveWallpaper"]
CONFIG_PATH = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "mizu-l2d" / "config.toml"
KNOWN_CONFIG_KEYS = {"schema", "wall"}


def socket_path():
    runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    return Path(runtime) / "mizu-l2d-wall.sock"


MODEL_RE = re.compile(r"^[a-z0-9_]+$")


def load_config(cli_outputs):
    """Load configuration from config.toml and CLI arguments.
    Returns (outputs, model, mirror). Unknown config keys are reported, not dropped (SPEC §4.4)."""
    outputs = cli_outputs
    model = None
    mirror = False
    if not CONFIG_PATH.exists():
        return outputs, model, mirror
    try:
        with open(CONFIG_PATH, "rb") as f:
            config = tomllib.load(f)
    except Exception as err:
        print(f"[wall] error reading config {CONFIG_PATH}: {err}", file=sys.stderr)
        return outputs, model, mirror

    for key in sorted(set(config) - KNOWN_CONFIG_KEYS):
        print(f"[wall] unknown config key ignored: {key}", file=sys.stderr)

    wall = config.get("wall", {})
    if outputs is None:
        outputs = wall.get("outputs")

    raw_model = wall.get("model")
    if raw_model is not None:
        if isinstance(raw_model, str) and MODEL_RE.match(raw_model):
            model = raw_model
        else:
            print(f"[wall] invalid model name in config: {raw_model!r}", file=sys.stderr)

    raw_mirror = wall.get("mirror")
    if raw_mirror is not None:
        if isinstance(raw_mirror, bool):
            mirror = raw_mirror
        else:
            print(f"[wall] invalid mirror value in config: {raw_mirror!r}", file=sys.stderr)

    return outputs, model, mirror


def touch_last_used(prefab):
    """Record a model load in the cache ledger (best effort — never fatal).

    mizu-l2d-cache.py reads this to evict by last-used order instead of by
    guesswork; see docs/remote-model-sources.md (M2).
    """
    if not MODEL_RE.fullmatch(prefab or ""):
        return
    try:
        ledger = Path.home() / ".local/share/mizu/l2d" / ".ledger.json"
        try:
            data = json.loads(ledger.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        if not isinstance(data.get("prefabs"), dict):
            data["prefabs"] = {}
        entry = data["prefabs"].setdefault(prefab, {})
        entry["last_used"] = int(time.time())
        tmp = ledger.with_name(ledger.name + f".tmp-{os.getpid()}")
        tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, ledger)
    except Exception:
        pass


def port_open(host, port):
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


class NiriWatcher(threading.Thread):
    """Watches niri workspace and window events to determine when the wallpaper
    is fully covered, allowing the render loop to pause and conserve GPU/CPU."""

    def __init__(self, on_cover_changed):
        super().__init__(daemon=True)
        self.on_cover_changed = on_cover_changed
        self._covered = False
        self._running = True

    def run(self):
        try:
            proc = subprocess.Popen(
                ["niri", "msg", "--json", "event-stream"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except Exception:
            return  # niri not available or not on path

        # Initial check
        self.evaluate_coverage()

        while self._running:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except Exception:
                continue

            if any(k in event for k in ("WorkspacesChanged", "WindowsChanged", "WorkspaceActivated")):
                self.evaluate_coverage()

    def stop(self):
        self._running = False

    def evaluate_coverage(self):
        try:
            ws_res = subprocess.run(
                ["niri", "msg", "--json", "workspaces"],
                capture_output=True,
                text=True,
                timeout=1.0,
            )
            if ws_res.returncode != 0:
                return
            workspaces = json.loads(ws_res.stdout)
            active_ws = [w for w in workspaces if w.get("is_active")]
            if not active_ws:
                return
            all_covered = all(w.get("active_window_id") is not None for w in active_ws)
            if all_covered != self._covered:
                self._covered = all_covered
                GLib.idle_add(self.on_cover_changed, self._covered)
        except Exception:
            pass


class WallApp(Gtk.Application):
    def __init__(self, url, control, outputs, mirror=False):
        super().__init__(application_id="dev.mizu.l2d.wall")
        self.url = url
        self.control = control
        self.outputs = outputs  # None = every output
        self.mirror = mirror  # one real view, GtkPicture copies on the rest
        self.views = {}  # monitor connector name -> (window, view)
        self.source_key = None  # the connector whose view the mirrors repaint
        self._paused = False
        self.niri_watcher = None

    def do_activate(self):
        display = Gdk.Display.get_default()
        if display is None:
            print("[wall] no display", file=sys.stderr)
            self.quit()
            return
        monitors = display.get_monitors()
        monitors.connect("items-changed", self.on_monitors_changed)
        self.sync_monitors()
        self.control.start(self)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, self.quit_on_signal)
        GLib.timeout_add_seconds(LIVE_PUSH_S, self.push_live_tick)
        self.niri_watcher = NiriWatcher(self.on_cover_changed)
        self.niri_watcher.start()
        self.hold()

    def quit_on_signal(self):
        self.quit()
        return GLib.SOURCE_REMOVE

    def do_shutdown(self):
        if self.niri_watcher:
            self.niri_watcher.stop()
        # hand the screens back so the owner's static wallpaper and widgets return
        push_live_screens([])
        Gtk.Application.do_shutdown(self)

    def on_cover_changed(self, covered):
        print(f"[wall] niri coverage: covered={covered}", flush=True)
        self.set_paused(covered)

    def set_paused(self, paused):
        if self._paused == paused:
            return
        self._paused = paused
        script = f"window.__mizuSetPaused && window.__mizuSetPaused({str(paused).lower()});"
        for view in self.views_list():
            view.evaluate_javascript(script, -1, None, None, None, None, None)

    def push_live_tick(self):
        # re-sent periodically: a restarted shell starts with no live screens
        push_live_screens(sorted(self.views))
        return GLib.SOURCE_CONTINUE

    def on_monitors_changed(self, *_):
        self.sync_monitors()

    def sync_monitors(self):
        monitors = Gdk.Display.get_default().get_monitors()
        current = {}
        for i in range(monitors.get_n_items()):
            mon = monitors.get_item(i)
            key = self.monitor_key(mon)
            if self.outputs is None or key in self.outputs:
                current[key] = mon
        for key in list(self.views):
            if key not in current:
                window, view = self.views.pop(key)
                print(f"[wall] monitor removed: {key}", flush=True)
                if isinstance(view, Gtk.Picture):
                    p = view.get_paintable()
                    if isinstance(p, Gtk.WidgetPaintable):
                        p.set_widget(None)
                    view.set_paintable(None)
                window.destroy()
                if key == self.source_key:
                    # the mirrored views painted this one; rebuild every surface
                    self.source_key = None
                    for other in list(self.views):
                        other_win, other_view = self.views.pop(other)
                        if isinstance(other_view, Gtk.Picture):
                            p = other_view.get_paintable()
                            if isinstance(p, Gtk.WidgetPaintable):
                                p.set_widget(None)
                            other_view.set_paintable(None)
                        other_win.destroy()
        # sorted order picks a stable source screen in mirror mode
        for key in sorted(current):
            if key not in self.views:
                print(f"[wall] monitor added: {key}", flush=True)
                if self.mirror and self.source_key in self.views:
                    source = self.views[self.source_key][1]
                    self.views[key] = self.make_surface(current[key], source)
                else:
                    if self.mirror:
                        self.source_key = key
                    self.views[key] = self.make_surface(current[key])
        push_live_screens(sorted(self.views))

    @staticmethod
    def monitor_key(mon):
        return mon.get_connector() or f"{mon.get_manufacturer()}-{mon.get_model()}"

    def make_surface(self, monitor, source=None):
        """A background-layer window on `monitor`. With `source`, it holds a
        GtkPicture repainting that view instead of its own WebKit one."""
        window = Gtk.Window(application=self)
        window.set_decorated(False)
        LayerShell.init_for_window(window)
        # never fall back to a tiled toplevel on the user's workspace
        if not LayerShell.is_layer_window(window):
            raise SystemExit("[wall] window is not a layer surface; check gtk4-layer-shell linking")
        LayerShell.set_namespace(window, "mizu-l2d")
        LayerShell.set_layer(window, LayerShell.Layer.BACKGROUND)
        LayerShell.set_monitor(window, monitor)
        for edge in (LayerShell.Edge.TOP, LayerShell.Edge.BOTTOM,
                     LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT):
            LayerShell.set_anchor(window, edge, True)
        LayerShell.set_exclusive_zone(window, -1)
        LayerShell.set_keyboard_mode(window, LayerShell.KeyboardMode.NONE)

        if source is None:
            view = WebKit.WebView()
            # transparent page: the scene is the only thing on the background layer
            view.set_background_color(Gdk.RGBA(red=0.0, green=0.0, blue=0.0, alpha=0.0))
            settings = view.get_settings()
            settings.set_enable_webgl(True)
            settings.set_media_playback_allows_inline(True)
            settings.set_media_playback_requires_user_gesture(False)
            window.set_child(view)
            view.load_uri(self.url)
        else:
            # mirror: one WebKitWebProcess serves every screen this way
            paintable = Gtk.WidgetPaintable()
            paintable.set_widget(source)
            view = Gtk.Picture()
            view.set_paintable(paintable)
            view.set_content_fit(Gtk.ContentFit.COVER)

            # Mirror click forwarding: forward clicks on secondary screen to primary WebKit view
            click_gesture = Gtk.GestureClick.new()
            def on_mirror_click(gesture, n_press, x, y):
                w_m = view.get_width() or 1920
                h_m = view.get_height() or 1080
                w_s = source.get_width() or 1920
                h_s = source.get_height() or 1080
                sx = (x / w_m) * w_s
                sy = (y / h_m) * h_s
                js = f"window.mizu && window.mizu.tap ? window.mizu.tap({sx}, {sy}) : 0;"
                source.evaluate_javascript(js, -1, None, None, None, None, None)
            click_gesture.connect("released", on_mirror_click)
            view.add_controller(click_gesture)

            window.set_child(view)
        window.present()
        return window, view
        window.present()
        return window, view

    def views_list(self):
        """The real WebKit views; the GtkPicture mirrors receive no JS."""
        return [view for _window, view in self.views.values()
                if isinstance(view, WebKit.WebView)]


class Control:
    """JSON-lines socket. Handlers run on the GTK thread; replies go back here."""

    def __init__(self):
        self.path = socket_path()
        self.app = None

    def start(self, app):
        self.app = app
        if self.path.exists():
            self.path.unlink()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(self.path))
        server.listen(4)
        atexit.register(lambda: self.path.exists() and self.path.unlink())
        threading.Thread(target=self.accept_loop, args=(server,), daemon=True).start()
        print(f"[wall] control socket {self.path}", flush=True)

    def accept_loop(self, server):
        while True:
            conn, _ = server.accept()
            threading.Thread(target=self.serve_conn, args=(conn,), daemon=True).start()

    def serve_conn(self, conn):
        with conn, conn.makefile("rwb") as stream:
            for raw in stream:
                reply = self.handle_line(raw)
                stream.write((json.dumps(reply) + "\n").encode())
                stream.flush()

    def handle_line(self, raw):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return {"v": PROTOCOL_VERSION, "ok": False, "error": "bad json"}
        if msg.get("v") != PROTOCOL_VERSION:
            return {"v": PROTOCOL_VERSION, "ok": False, "error": "protocol version"}
        done = threading.Event()
        box = {}

        def respond(reply):  # may be called on the GTK thread; never blocks it
            box["reply"] = reply
            done.set()

        GLib.idle_add(self.run_on_main, msg, respond)
        if not done.wait(JS_TIMEOUT_S + 1):
            return {"v": PROTOCOL_VERSION, "ok": False, "error": "timeout"}
        return {"v": PROTOCOL_VERSION, **box["reply"]}

    def run_on_main(self, msg, respond):
        try:
            self.dispatch(msg.get("cmd"), msg, respond)
        except Exception as err:  # the socket must never crash the host
            respond({"ok": False, "error": str(err)})
        return GLib.SOURCE_REMOVE

    def dispatch(self, cmd, msg, respond):
        views = self.app.views_list()
        if cmd == "ping":
            return respond({"ok": True, "pong": True, "outputs": len(views)})
        if cmd == "status":
            return respond({"ok": True, "outputs": sorted(self.app.views), "views": len(views)})
        if cmd == "camera":
            action = msg.get("action")
            if action == "zoom":
                call = f"window.mizu.camera({{zoom:{float(msg['value'])}}})"
            elif action == "pos":
                call = f"window.mizu.camera({{dx:{float(msg['dx'])},dy:{float(msg['dy'])}}})"
            elif action == "reset":
                call = "window.mizu.camera({reset:true})"
            else:
                return respond({"ok": False, "error": "camera action must be zoom|pos|reset"})
            return self.run_js(views, call, respond)
        if cmd == "page":
            return self.run_js(views, "window.mizu.status()", respond)
        if cmd == "motion":
            group = str(msg.get("group", ""))
            return self.run_js(views, f"window.mizu.motion({json.dumps(group)})", respond)
        if cmd == "model":
            prefab = str(msg.get("prefab", ""))
            touch_last_used(prefab)
            return self.run_js(views, f"window.mizu.model({json.dumps(prefab)})", respond)
        if cmd == "tips":
            val = msg.get("on")
            arg = f"{"true" if val else "false"}" if val is not None else ""
            return self.run_js(views, f"window.mizu.tips({arg})", respond)
        if cmd == "lock":
            val = msg.get("locked")
            arg = f"{"true" if val else "false"}" if val is not None else ""
            return self.run_js(views, f"window.mizu.lock({arg})", respond)
        if cmd == "tooltip":
            val = msg.get("on")
            arg = f"{"true" if val else "false"}" if val is not None else ""
            return self.run_js(views, f"window.mizu.tooltip({arg})", respond)
        if cmd == "state":
            sub = msg.get("action", "info")
            val = msg.get("value")
            arg = f"{json.dumps(val)}" if val is not None else f"{json.dumps(sub)}"
            return self.run_js(views, f"window.mizu.state({arg})", respond)
        if cmd == "pause":
            return self.run_js(views, "window.mizu.pause()", respond)
        if cmd == "resume":
            return self.run_js(views, "window.mizu.resume()", respond)
        if cmd == "fps":
            target = msg.get("fps")
            arg = f"{int(target)}" if target is not None else ""
            return self.run_js(views, f"window.mizu.fps({arg})", respond)
        if cmd == "gaze":
            val = msg.get("on")
            arg = f"{"true" if val else "false"}" if val is not None else ""
            return self.run_js(views, f"window.mizu.gaze({arg})", respond)
        if cmd == "lang":
            val = str(msg.get("lang", ""))
            return self.run_js(views, f"window.mizu.lang({json.dumps(val)})", respond)
        if cmd == "eval":
            code = msg.get("code", "")
            return self.run_js(views, code, respond)
        return respond({"ok": False, "error": f"unknown command: {cmd}"})

    @staticmethod
    def run_js(views, script, respond):
        """Starts script in every view. respond() runs once all views answered."""
        if not views:
            return respond({"ok": False, "error": "no outputs"})
        results = []

        def finish(view, res):  # GTK thread, from the WebKit callback
            try:
                value = view.evaluate_javascript_finish(res)
                results.append({"ok": True, "result": value.to_string()})
            except GLib.Error as err:
                results.append({"ok": False, "error": err.message})
            if len(results) == len(views):
                respond({"ok": all(r["ok"] for r in results), "outputs": results})

        def callback_for(view):
            # a factory, so the view is bound even if GI passes extra arguments
            def callback(_source, res, *_user_data):
                finish(view, res)
            return callback

        for view in views:
            view.evaluate_javascript(script, -1, None, None, None, callback_for(view), None)


def push_live_screens(names):
    """Tells the owner's shell which screens the live wallpaper covers (see
    WallpaperService.liveScreens in the mizu quickshell config). Failures only
    mean the shell is not running; the next tick retries."""
    try:
        subprocess.run([*QS_LIVE, ",".join(names)], timeout=5, capture_output=True)
    except (OSError, subprocess.TimeoutExpired) as err:
        print(f"[wall] shell IPC failed: {err}", file=sys.stderr)


def ensure_server(url, serve):
    parsed = urllib.parse.urlsplit(url)
    host, port = parsed.hostname or "127.0.0.1", parsed.port or 80
    if port_open(host, port):
        return None
    if not serve:
        print(f"[wall] nothing listens on {host}:{port}; start scripts/serve.py first",
              file=sys.stderr)
        return None
    print(f"[wall] starting {SERVE.name} on {port}", flush=True)
    proc = subprocess.Popen([sys.executable, str(SERVE), str(port)], cwd=ROOT)
    atexit.register(proc.terminate)
    return proc


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--no-serve", action="store_true")
    parser.add_argument("--outputs", help="comma-separated connector names, e.g. eDP-1,HDMI-A-1")
    args = parser.parse_args()
    cli = [o.strip() for o in args.outputs.split(",") if o.strip()] if args.outputs else None
    outputs, model, mirror = load_config(cli)
    url = args.url
    if model:
        parsed = urllib.parse.urlsplit(url)
        q = urllib.parse.parse_qs(parsed.query)
        if "model" not in q:
            sep = "&" if parsed.query else ""
            new_query = f"{parsed.query}{sep}model={urllib.parse.quote(model)}" if parsed.query else f"model={urllib.parse.quote(model)}"
            url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment))
    if model:
        touch_last_used(model)
    print(f"[wall] outputs: {outputs if outputs is not None else 'all'}, model: {model or 'default'}, mirror: {mirror}", flush=True)
    ensure_server(url, serve=not args.no_serve)
    app = WallApp(url, Control(), outputs, mirror)
    return app.run(None)


if __name__ == "__main__":
    sys.exit(main())
