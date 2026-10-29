#!/usr/bin/env python3
"""S0-perf: WebKitGTK 6.0 (GTK4) cost of a WebGL page. Side A of the A/B.

Requires: sudo pacman -S --needed webkitgtk-6.0 gtk4-layer-shell
Uses a normal toplevel window, not the layer shell, so the wallpaper is untouched.
Keep the mouse still while it runs (about 25 s per mode).

Modes:
  blank     plain page, no canvas (WebKit floor)
  idle      WebGL context, one frame drawn, no animation loop
  animated  per-frame CPU mesh deformation + upload + draw every rAF
            (same shape of work as Cubism Core deforming a model)

Prints one JSON line: page fps (last full second), CPU% and PSS of the WebKit
process tree sampled over SAMPLE_S seconds after WARMUP_S.
"""
import json
import os
import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import GLib, Gtk, WebKit  # noqa: E402

MODE = sys.argv[1] if len(sys.argv) > 1 else "animated"
WARMUP_S = 3
SAMPLE_S = 8
CLK_TCK = os.sysconf("SC_CLK_TCK")

MESH_JS = """
function mesh(gl, animate) {
  const N = 64, V = (N + 1) * (N + 1);
  const vs = 'attribute vec2 p; attribute float a; varying float v;'
    + 'void main(){gl_Position=vec4(p,0.0,1.0);v=a;}';
  const fs = 'precision mediump float; varying float v;'
    + 'void main(){gl_FragColor=vec4(0.8*v,0.6,0.4,0.9);}';
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr); gl.useProgram(pr);
  const base = new Float32Array(V * 2), pos = new Float32Array(V * 2);
  const idx = new Uint16Array(N * N * 6), al = new Float32Array(V);
  for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
    base[2 * k] = i / N * 2 - 1; base[2 * k + 1] = j / N * 2 - 1; al[k] = 0.5;
  }
  for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.set([a, b, c, b, d, c], k); k += 6;
  }
  pos.set(base);
  const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const ab = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ab);
  gl.bufferData(gl.ARRAY_BUFFER, al, gl.STATIC_DRAW);
  const al2 = gl.getAttribLocation(pr, 'a');
  gl.enableVertexAttribArray(al2); gl.vertexAttribPointer(al2, 1, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const draw = () => {
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  };
  if (!animate) { draw(); document.title = 'F0'; return; }
  let frames = 0, t0 = performance.now();
  const frame = (now) => {
    const t = now / 1000;
    for (let k = 0; k < V; k++) {
      const x = base[2 * k], y = base[2 * k + 1];
      pos[2 * k] = x + 0.08 * Math.sin(t * 2 + x * 3 + y * 2);
      pos[2 * k + 1] = y + 0.08 * Math.cos(t * 1.7 + y * 3 - x * 2);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    draw();
    frames++;
    if (now - t0 >= 1000) { document.title = 'F' + frames; frames = 0; t0 = now; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function run(animate) {
  const c = document.getElementById('c');
  c.width = innerWidth; c.height = innerHeight;
  const gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true });
  if (!gl) { document.title = 'nogl'; return; }
  mesh(gl, animate);
}
"""

BODY = {
    "blank": "<p>blank</p>",
    "idle": '<canvas id="c" style="width:100vw;height:100vh"></canvas>',
    "animated": '<canvas id="c" style="width:100vw;height:100vh"></canvas>',
}
RUN = {"blank": "", "idle": "run(false);", "animated": "run(true);"}
if MODE not in BODY:
    sys.exit(f"unknown mode {MODE!r}; use blank | idle | animated")

HTML = (
    '<!doctype html><html><head><meta charset="utf-8">'
    "<style>html,body{margin:0;background:transparent;overflow:hidden}</style></head>"
    f"<body>{BODY[MODE]}<script>{MESH_JS}{RUN[MODE]}</script></body></html>"
)


def process_tree():
    me = os.getpid()
    procs = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat") as f:
                s = f.read()
        except OSError:
            continue
        comm = s[s.index("(") + 1 : s.rindex(")")]
        rest = s[s.rindex(")") + 2 :].split()
        procs[int(name)] = (int(rest[1]), comm, int(rest[11]) + int(rest[12]))
    tree = {me}
    grew = True
    while grew:
        grew = False
        for pid, (ppid, _, _) in procs.items():
            if ppid in tree and pid not in tree:
                tree.add(pid)
                grew = True
    return {pid: (procs[pid][1], procs[pid][2]) for pid in tree if pid in procs}


def pss_kb(pid):
    try:
        with open(f"/proc/{pid}/smaps_rollup") as f:
            for line in f:
                if line.startswith("Pss:"):
                    return int(line.split()[1])
    except OSError:
        pass
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except OSError:
        pass
    return 0


state = {}


def on_load(view, event):
    if event == WebKit.LoadEvent.FINISHED and "started" not in state:
        state["started"] = True
        GLib.timeout_add_seconds(WARMUP_S, begin_sample)


def begin_sample():
    state["before"] = process_tree()
    GLib.timeout_add_seconds(SAMPLE_S, end_sample)
    return False


def end_sample():
    after = process_tree()
    before = state["before"]
    rows = []
    for pid, (comm, ticks) in after.items():
        if pid in before:
            cpu = 100.0 * (ticks - before[pid][1]) / CLK_TCK / SAMPLE_S
            rows.append({"pid": pid, "comm": comm, "cpu_pct": round(cpu, 2),
                         "pss_mb": round(pss_kb(pid) / 1024.0, 1)})
    rows.sort(key=lambda r: -r["pss_mb"])
    out = {
        "side": "A-webkit-gtk4",
        "mode": MODE,
        "page_fps_last_second": state["view"].get_title(),
        "tree_cpu_pct": round(sum(r["cpu_pct"] for r in rows), 2),
        "tree_pss_mb": round(sum(r["pss_mb"] for r in rows), 1),
        "tree_procs": len(after),
        "procs": rows[:8],
    }
    print(json.dumps(out))
    state["loop"].quit()
    return False


def main():
    if not Gtk.init_check():
        sys.exit("GTK could not open a display (run this from your desktop session)")
    loop = GLib.MainLoop()
    state["loop"] = loop
    win = Gtk.Window(title=f"mizu bench {MODE}")
    win.set_default_size(960, 540)
    view = WebKit.WebView()
    state["view"] = view
    win.set_child(view)
    view.connect("load-changed", on_load)
    win.present()
    view.load_html(HTML, "file:///")
    GLib.timeout_add_seconds(WARMUP_S + SAMPLE_S + 20, lambda: (loop.quit(), False)[1])
    loop.run()
    win.destroy()


if __name__ == "__main__":
    main()
