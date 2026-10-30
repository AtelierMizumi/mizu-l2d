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
  mizu-l2d-ctl.py tips [on|off]             toggle or set interaction hints
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
    if args.cmd in ("ping", "status", "page", "pause", "resume"):
        return {"cmd": args.cmd}
    if args.cmd == "fps":
        val = int(args.action) if args.action else (int(args.values[0]) if args.values else None)
        return {"cmd": "fps", "fps": val}
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
    if args.cmd == "gaze":
        on = None
        if args.action in ("true", "1", "on"):
            on = True
        elif args.action in ("false", "0", "off"):
            on = False
        return {"cmd": "gaze", "on": on}
    if args.cmd == "lang":
        val = args.action or (args.values[0] if args.values else "vi")
        return {"cmd": "lang", "lang": val}
    if args.cmd == "tips":
        on = None
        if args.action in ("true", "1", "on"):
            on = True
        elif args.action in ("false", "0", "off"):
            on = False
        return {"cmd": "tips", "on": on}
    if args.cmd == "lock":
        locked = None
        if args.action in ("true", "1", "on", "lock"):
            locked = True
        elif args.action in ("false", "0", "off", "unlock"):
            locked = False
        return {"cmd": "lock", "locked": locked}
    if args.cmd == "tooltip":
        on = None
        if args.action in ("true", "1", "on"):
            on = True
        elif args.action in ("false", "0", "off"):
            on = False
        return {"cmd": "tooltip", "on": on}
    if args.cmd == "state":
        sub = args.action or "info"
        val = args.values[0] if args.values else None
        return {"cmd": "state", "action": sub, "value": val}
    if args.cmd == "eval":
        return {"cmd": "eval", "code": " ".join([args.action or ""] + args.values)}
    raise SystemExit(f"unknown command {args.cmd}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--socket", default=str(default_socket()))
    parser.add_argument("cmd", choices=["ping", "status", "page", "camera", "motion", "model", "tips", "lock", "state", "tooltip", "gaze", "lang", "pause", "resume", "fps", "eval"])
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
