#!/usr/bin/env python3
"""S2-mirror: Standalone spike verifying Gtk.WidgetPaintable mirroring WebKitGTK 6.0.

Tests:
1. Primary window runs WebKit.WebView with WebGL animation.
2. Secondary window runs Gtk.Picture with Gtk.WidgetPaintable(widget=webview).
3. Measures:
   - WebKitWebProcess count (MUST BE EXACTLY 1).
   - Total RSS memory footprint across all related processes.
   - Click forwarding from mirror window to primary webview.
"""
import json
import os
import subprocess
import sys
import time

import gi

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, GLib, Gtk, WebKit  # noqa: E402

TEST_PAGE = """<!DOCTYPE html>
<html>
<head><style>body { margin: 0; background: transparent; overflow: hidden; }</style></head>
<body>
<canvas id="c" width="800" height="600" style="width:100vw; height:100vh;"></canvas>
<script>
const c = document.getElementById('c');
const gl = c.getContext('webgl');
let frame = 0;
let lastClick = null;
window.__mizuClicks = [];
window.__mizuSyntheticTap = (x, y) => {
  window.__mizuClicks.push({ x, y, t: performance.now() });
};
function draw() {
  frame++;
  const r = (Math.sin(frame * 0.05) + 1) / 2;
  const g = (Math.cos(frame * 0.03) + 1) / 2;
  gl.clearColor(r, g, 0.5, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>
</body>
</html>
"""

class MirrorBenchApp(Gtk.Application):
    def __init__(self, run_seconds=5):
        super().__init__(application_id="dev.mizu.l2d.spike.mirror")
        self.run_seconds = run_seconds
        self.primary_win = None
        self.mirror_win = None
        self.webview = None
        self.paintable = None
        self.start_time = None
        self.result = {}

    def do_activate(self):
        self.start_time = time.time()

        # 1. Primary window with WebKit.WebView
        self.primary_win = Gtk.Window(application=self)
        self.primary_win.set_title("Mizu Primary (WebKit)")
        self.primary_win.set_default_size(800, 600)

        self.webview = WebKit.WebView()
        self.webview.set_background_color(Gdk.RGBA(red=0.0, green=0.0, blue=0.0, alpha=0.0))
        settings = self.webview.get_settings()
        settings.set_enable_webgl(True)
        self.primary_win.set_child(self.webview)
        self.webview.load_html(TEST_PAGE, "http://localhost/")
        self.primary_win.present()

        # 2. Mirror window with Gtk.Picture + Gtk.WidgetPaintable
        self.mirror_win = Gtk.Window(application=self)
        self.mirror_win.set_title("Mizu Mirror (WidgetPaintable)")
        self.mirror_win.set_default_size(800, 600)

        self.paintable = Gtk.WidgetPaintable()
        self.paintable.set_widget(self.webview)

        picture = Gtk.Picture()
        picture.set_paintable(self.paintable)
        picture.set_content_fit(Gtk.ContentFit.COVER)

        # Attach click gesture on mirror window
        click_gesture = Gtk.GestureClick.new()
        click_gesture.connect("released", self.on_mirror_click)
        picture.add_controller(click_gesture)

        self.mirror_win.set_child(picture)
        self.mirror_win.present()

        # Schedule synthetic click test and benchmark measurement
        GLib.timeout_add(1500, self.simulate_mirror_click)
        GLib.timeout_add(self.run_seconds * 1000, self.finish_benchmark)

    def on_mirror_click(self, gesture, n_press, x, y):
        # Forward click to WebKit
        js = f"window.__mizuSyntheticTap({x}, {y});"
        self.webview.evaluate_javascript(js, -1, None, None, None, None, None)

    def simulate_mirror_click(self):
        # Trigger the click handler programmatically to simulate user tapping mirror
        self.on_mirror_click(None, 1, 400.0, 300.0)
        return GLib.SOURCE_REMOVE

    def finish_benchmark(self):
        # Sample processes and RSS
        my_pid = os.getpid()
        proc_tree = subprocess.run(
            ["pgrep", "-P", str(my_pid)], capture_output=True, text=True
        )
        child_pids = [int(p) for p in proc_tree.stdout.strip().split() if p]
        all_pids = [my_pid] + child_pids

        # Count WebKitWebProcess
        web_processes = subprocess.run(
            ["pgrep", "-f", "WebKitWebProcess"], capture_output=True, text=True
        )
        web_pids = [int(p) for p in web_processes.stdout.strip().split() if p]

        # Calculate RSS for all our processes
        total_rss_kb = 0
        for pid in all_pids:
            try:
                with open(f"/proc/{pid}/status") as f:
                    for line in f:
                        if line.startswith("VmRSS:"):
                            total_rss_kb += int(line.split()[1])
            except (FileNotFoundError, ProcessLookupError):
                pass

        # Read clicks recorded inside WebKit
        def js_callback(wv, res, *_user_data):
            try:
                val = wv.evaluate_javascript_finish(res)
                clicks_json = val.to_string() if val else "[]"
            except Exception as e:
                clicks_json = f"error: {e}"

            self.result = {
                "ok": True,
                "web_process_count": len(web_pids),
                "total_rss_mb": round(total_rss_kb / 1024, 2),
                "clicks_received": clicks_json,
                "under_400mb_budget": (total_rss_kb / 1024) < 400.0,
            }
            print(json.dumps(self.result, indent=2))
            self.quit()

        self.webview.evaluate_javascript(
            "JSON.stringify(window.__mizuClicks)", -1, None, None, None, js_callback, None
        )
        return GLib.SOURCE_REMOVE


def main():
    app = MirrorBenchApp(run_seconds=3)
    app.run(None)


if __name__ == "__main__":
    main()
