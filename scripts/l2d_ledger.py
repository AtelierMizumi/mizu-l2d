#!/usr/bin/env python3
"""Shared ledger for the mizu-l2d model cache (docs/remote-model-sources.md M2).

One JSON file at <l2d-dir>/.ledger.json records, per prefab: last_used (unix
seconds), pinned, and the cached on-disk size in bytes. The wallpaper host
touches last_used on every model load, fetch-model.py records sizes after an
install, and mizu-l2d-cache.py enforces the quota on top of it. Every write is
a load-modify-atomic-replace so the three tools can interleave safely.
"""
import json
import os
import time
from pathlib import Path

LEDGER_NAME = ".ledger.json"
DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


def ledger_path(l2d_dir):
    return Path(l2d_dir) / LEDGER_NAME


def load(l2d_dir):
    data = {}
    try:
        data = json.loads(ledger_path(l2d_dir).read_text(encoding="utf-8"))
    except Exception:
        pass
    if not isinstance(data, dict):
        data = {}
    if not isinstance(data.get("prefabs"), dict):
        data["prefabs"] = {}
    data.setdefault("quota_bytes", 0)
    return data


def save(l2d_dir, data):
    path = ledger_path(l2d_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def touch(l2d_dir, prefab, when=None):
    data = load(l2d_dir)
    entry = data["prefabs"].setdefault(prefab, {})
    entry["last_used"] = int(when if when is not None else time.time())
    save(l2d_dir, data)
    return data


def set_bytes(l2d_dir, prefab, size):
    data = load(l2d_dir)
    entry = data["prefabs"].setdefault(prefab, {})
    entry.setdefault("last_used", int(time.time()))
    entry["bytes"] = int(size)
    save(l2d_dir, data)
    return data


def set_pinned(l2d_dir, prefab, pinned):
    data = load(l2d_dir)
    entry = data["prefabs"].setdefault(prefab, {})
    entry["pinned"] = bool(pinned)
    save(l2d_dir, data)
    return data


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def quota_bytes(data):
    q = int(data.get("quota_bytes") or 0)
    return q if q > 0 else DEFAULT_QUOTA_BYTES
