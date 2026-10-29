#!/usr/bin/env python3
"""Control CLI for the mizu-l2d wallpaper host (SPEC §5.3, JSON lines).

usage:
  mizu-l2d-ctl.py ping
  mizu-l2d-ctl.py status
  mizu-l2d-ctl.py page                      page state per output (prefab, zones, tap)
  mizu-l2d-ctl.py camera zoom <factor>      e.g. camera zoom 1.4
  mizu-l2d-ctl.py camera pos <dx> <dy>      design px, screen axes (+y down)
  mizu-l2d-ctl.py camera reset
  mizu-l2d-ctl.py motion <group>            e.g. motion touch_head
  mizu-l2d-ctl.py model <prefab>            e.g. model rangbaer_4
Socket: $XDG_RUNTIME_DIR/mizu-l2d-wall.sock (override with --socket).
"""
import argparse
import json
import os
import socket
import sys
from pathlib import Path

PROTOCOL_VERSION = 1


def default_socket():
    runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    return Path(runtime) / "mizu-l2d-wall.sock"


def build_message(args):
    if args.cmd in ("ping", "status", "page"):
        return {"cmd": args.cmd}
    if args.cmd == "camera":
        if args.action == "zoom":
            return {"cmd": "camera", "action": "zoom", "value": float(args.values[0])}
        if args.action == "pos":
            return {"cmd": "camera", "action": "pos",
                    "dx": float(args.values[0]), "dy": float(args.values[1])}
        return {"cmd": "camera", "action": "reset"}
    if args.cmd == "motion":
        return {"cmd": "motion", "group": args.values[0]}
    if args.cmd == "model":
        return {"cmd": "model", "prefab": args.values[0]}
    raise SystemExit(f"unknown command {args.cmd}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--socket", default=str(default_socket()))
    parser.add_argument("cmd", choices=["ping", "status", "page", "camera", "motion", "model"])
    parser.add_argument("action", nargs="?", help="camera: zoom|pos|reset")
    parser.add_argument("values", nargs="*")
    args = parser.parse_args()
    if args.cmd == "camera" and args.action not in ("zoom", "pos", "reset"):
        parser.error("camera needs zoom|pos|reset")
    if args.cmd in ("motion", "model") and not args.values:
        args.values = [args.action] if args.action else []
    if args.cmd in ("motion", "model") and not args.values:
        parser.error(f"{args.cmd} needs a value")
    msg = {"v": PROTOCOL_VERSION, **build_message(args)}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(15)
        try:
            sock.connect(args.socket)
        except OSError as err:
            print(f"cannot reach the wallpaper host at {args.socket}: {err}", file=sys.stderr)
            return 1
        sock.sendall((json.dumps(msg) + "\n").encode())
        reply = sock.makefile("rb").readline()
    print(reply.decode().strip())
    return 0 if json.loads(reply).get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
