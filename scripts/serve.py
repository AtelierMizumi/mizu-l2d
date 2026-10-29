#!/usr/bin/env python3
"""Serve web/ on 127.0.0.1 and expose the on-demand model download (R1c.2).

usage: scripts/serve.py [port]          (default 8787)

GET /api/download?prefab=<name>
    runs `fetch-model.sh <name> --bg` and streams its output as text/plain.
    The last line is always "[exit N]". Only prefabs present in the mirrored
    catalog (web/data/l2d_mapping.json) are accepted, one download at a time.
Everything else is served statically from web/, like `http.server`.
"""
import functools
import http.server
import json
import re
import subprocess
import sys
import threading
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
FETCH = ROOT / "scripts" / "fetch-model.sh"
CATALOG = WEB / "data" / "l2d_mapping.json"
PREFAB = re.compile(r"^[a-z0-9_]+$")
DOWNLOAD_LOCK = threading.Lock()


def catalog_prefabs():
    with open(CATALOG, encoding="utf-8") as f:
        mapping = json.load(f)
    return {s["prefab"] for ship in mapping.values() for s in ship.get("skins", [])}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/api/download":
            query = urllib.parse.parse_qs(url.query)
            self.download((query.get("prefab") or [""])[0])
            return
        super().do_GET()

    def download(self, prefab):
        if not PREFAB.fullmatch(prefab) or prefab not in catalog_prefabs():
            self.send_error(400, "unknown prefab")
            return
        if not DOWNLOAD_LOCK.acquire(blocking=False):
            self.send_error(409, "another download is running")
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            proc = subprocess.Popen(
                ["bash", str(FETCH), prefab, "--bg"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=ROOT)
            client_gone = False
            for line in proc.stdout:
                if client_gone:
                    continue  # keep draining so the download still completes
                try:
                    self.wfile.write(line)
                    self.wfile.flush()
                except OSError:
                    client_gone = True
            code = proc.wait()
            if not client_gone:
                self.wfile.write(f"[exit {code}]\n".encode())
                self.wfile.flush()
            self.close_connection = True
        finally:
            DOWNLOAD_LOCK.release()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    handler = functools.partial(Handler, directory=str(WEB))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"serving {WEB} on http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
