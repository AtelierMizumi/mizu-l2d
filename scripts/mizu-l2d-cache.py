#!/usr/bin/env python3
"""mizu-l2d-cache.py — model cache management (remote-model-sources.md M2).

usage:
  mizu-l2d-cache.py status [--json] [--rescan]
  mizu-l2d-cache.py touch <prefab>
  mizu-l2d-cache.py pin <prefab> | unpin <prefab>
  mizu-l2d-cache.py evict <prefab>
  mizu-l2d-cache.py enforce [--quota GB] [--dry-run]
  mizu-l2d-cache.py quota <GB>
  mizu-l2d-cache.py verify [prefab]

The ledger at <l2d-dir>/.ledger.json is the single source of truth (per-prefab
last_used / pinned / bytes; optional quota_bytes). Eviction removes whole
prefab directories and only ever touches: unpinned, non-active prefabs whose
directory looks like a prefab (contains *.model3.json). The active model comes
from [wall] model in the host config, so the running wallpaper can never evict
itself.
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
import time
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import l2d_ledger  # noqa: E402

PREFAB_RE = re.compile(r"^[a-z0-9_]+$")
DEFAULT_HOME = Path.home()
MANIFEST_NAME = ".mizu-manifest.json"


def human(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} TB"


def parse_args():
    ap = argparse.ArgumentParser(description="mizu-l2d model cache tool")
    ap.add_argument("--l2d-dir", default=str(DEFAULT_HOME / ".local/share/mizu/l2d"))
    ap.add_argument("--config", default=str(DEFAULT_HOME / ".config/mizu-l2d/config.toml"))
    ap.add_argument("--home", default=str(DEFAULT_HOME), help="override for tests")
    sub = ap.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status")
    st.add_argument("--json", action="store_true")
    st.add_argument("--rescan", action="store_true", help="recompute every size")
    sub.add_parser("scan", help="record every prefab's size and last-used time in the ledger, changing nothing else")
    for name in ("touch", "pin", "unpin", "evict"):
        p = sub.add_parser(name)
        p.add_argument("prefab")
    en = sub.add_parser("enforce")
    en.add_argument("--quota", type=float, help="GB for this run (default: ledger quota or 2)")
    en.add_argument("--dry-run", action="store_true")
    q = sub.add_parser("quota")
    q.add_argument("gb", type=float)
    v = sub.add_parser("verify")
    v.add_argument("prefab", nargs="?", default=None)
    return ap.parse_args()


def active_model(args):
    try:
        with open(args.config, "rb") as f:
            model = tomllib.load(f).get("wall", {}).get("model")
        return model if isinstance(model, str) and PREFAB_RE.fullmatch(model) else None
    except Exception:
        return None


def prefabs_on_disk(l2d):
    out = {}
    if not l2d.is_dir():
        return out
    for d in sorted(l2d.iterdir()):
        if d.is_dir() and PREFAB_RE.fullmatch(d.name) and any(d.glob("*.model3.json")):
            out[d.name] = d
    return out


def entry_bytes(args, data, name, rescan=False):
    entry = data["prefabs"].setdefault(name, {})
    if rescan or not entry.get("bytes"):
        entry["bytes"] = l2d_ledger.dir_size(args.l2d_dir / name)
    # models downloaded before the ledger existed: download time is the
    # closest thing to a last-used time
    if not entry.get("last_used"):
        try:
            entry["last_used"] = int((args.l2d_dir / name).stat().st_mtime)
        except OSError:
            pass
    return entry["bytes"]


def guard_evictable(args, data, name, on_disk):
    """Return a refusal reason, or None if `name` may be evicted."""
    if not PREFAB_RE.fullmatch(name or ""):
        return f"invalid prefab name: {name!r}"
    if name not in on_disk:
        return f"{name} is not an installed prefab"
    if data["prefabs"].get(name, {}).get("pinned"):
        return f"{name} is pinned (unpin it first)"
    if name == active_model(args):
        return f"{name} is the active model (switch first)"
    return None


def do_status(args, data):
    on_disk = prefabs_on_disk(args.l2d_dir)
    rows = []
    total = 0
    active = active_model(args)
    for name in on_disk:
        size = entry_bytes(args, data, name, rescan=args.rescan)
        total += size
        e = data["prefabs"].get(name, {})
        used = int(time.time()) - e.get("last_used", 0)
        rows.append({"prefab": name, "bytes": size, "pinned": bool(e.get("pinned")),
                     "active": name == active,
                     "last_used_age_s": used if e.get("last_used") else None})
    quota = int(args.quota * 1024 ** 3) if getattr(args, "quota", None) else l2d_ledger.quota_bytes(data)
    if args.json:
        print(json.dumps({"total_bytes": total, "quota_bytes": quota,
                          "prefabs": rows, "ledger": data.get("prefabs", {})}, indent=2))
        return
    print(f"{human(total)} / {human(quota)} — {len(on_disk)} models, "
          f"{sum(1 for r in rows if r['pinned'])} pinned")
    for r in sorted(rows, key=lambda r: r["last_used_age_s"] is None, reverse=True):
        flags = (" ACTIVE" if r["active"] else "") + (" pinned" if r["pinned"] else "")
        age = "never" if r["last_used_age_s"] is None else f"{r['last_used_age_s'] // 3600}h ago"
        print(f"  {r['prefab']:<24} {human(r['bytes']):>10}  {age:>10}{flags}")
    if total > quota:
        print(f"over quota by {human(total - quota)} — run 'enforce' to evict the oldest unpinned")


def do_enforce(args, data):
    if args.quota is not None:
        data["quota_bytes"] = int(args.quota * 1024 ** 3)
    quota = l2d_ledger.quota_bytes(data)
    on_disk = prefabs_on_disk(args.l2d_dir)
    total = sum(entry_bytes(args, data, name) for name in on_disk)
    if total <= quota:
        print(f"{human(total)} / {human(quota)} — nothing to evict")
        l2d_ledger.save(args.l2d_dir, data)
        return
    active = active_model(args)
    def sort_key(name):
        return (data["prefabs"].get(name, {}).get("last_used", 0), name)
    victims = [n for n in sorted(on_disk, key=sort_key)
               if not data["prefabs"].get(n, {}).get("pinned") and n != active]
    freed = 0
    for name in victims:
        if total - freed <= quota:
            break
        size = data["prefabs"][name]["bytes"]
        if args.dry_run:
            print(f"would evict {name} ({human(size)})")
        else:
            shutil.rmtree(args.l2d_dir / name)
            data["prefabs"].pop(name, None)
            print(f"evicted {name} ({human(size)})")
        freed += size
    print(f"{human(total - freed)} / {human(quota)} after cleanup" +
          (" (dry run)" if args.dry_run else ""))
    if not args.dry_run:
        l2d_ledger.save(args.l2d_dir, data)


def do_verify(args, data, _l2d):
    on_disk = prefabs_on_disk(args.l2d_dir)
    targets = [args.prefab] if args.prefab else sorted(on_disk)
    if args.prefab and args.prefab not in on_disk:
        print(f"{args.prefab} is not an installed prefab")
        sys.exit(1)
    failures = 0
    for name in targets:
        mf = on_disk[name] / MANIFEST_NAME
        if not mf.is_file():
            print(f"{name}: no manifest (fetch with --force to build one)")
            failures += 1
            continue
        records = json.loads(mf.read_text(encoding="utf-8"))["files"]
        bad = 0
        for rel, rec in records.items():
            p = on_disk[name] / rel
            if not p.is_file():
                bad += 1
            else:
                h = hashlib.sha256(p.read_bytes()).hexdigest()
                bad += h != rec["sha256"]
        print(f"{name}: {len(records)} files, {bad} bad")
        failures += bool(bad)
    if failures:
        sys.exit(2)


def main():
    args = parse_args()
    args.l2d_dir = Path(args.l2d_dir).expanduser()
    data = l2d_ledger.load(args.l2d_dir)
    if args.cmd == "status":
        do_status(args, data)
    elif args.cmd == "scan":
        on_disk = prefabs_on_disk(args.l2d_dir)
        for name in on_disk:
            entry_bytes(args, data, name)
        l2d_ledger.save(args.l2d_dir, data)
        print(f"scanned {len(on_disk)} prefabs -> {l2d_ledger.ledger_path(args.l2d_dir)}")
    elif args.cmd == "touch":
        if not PREFAB_RE.fullmatch(args.prefab):
            sys.exit(f"invalid prefab name: {args.prefab!r}")
        l2d_ledger.touch(args.l2d_dir, args.prefab)
    elif args.cmd in ("pin", "unpin"):
        l2d_ledger.set_pinned(args.l2d_dir, args.prefab, args.cmd == "pin")
        print(f"{args.prefab} {'pinned' if args.cmd == 'pin' else 'unpinned'}")
    elif args.cmd == "evict":
        reason = guard_evictable(args, data, args.prefab, prefabs_on_disk(args.l2d_dir))
        if reason:
            print(f"refusing: {reason}")
            sys.exit(1)
        size = data["prefabs"].get(args.prefab, {}).get("bytes") or \
            l2d_ledger.dir_size(args.l2d_dir / args.prefab)
        shutil.rmtree(args.l2d_dir / args.prefab)
        data["prefabs"].pop(args.prefab, None)
        l2d_ledger.save(args.l2d_dir, data)
        print(f"evicted {args.prefab} ({human(size)})")
    elif args.cmd == "enforce":
        do_enforce(args, data)
    elif args.cmd == "quota":
        data["quota_bytes"] = int(args.gb * 1024 ** 3)
        l2d_ledger.save(args.l2d_dir, data)
        print(f"quota set to {human(data['quota_bytes'])}")
    elif args.cmd == "verify":
        do_verify(args, data, args.l2d_dir)


if __name__ == "__main__":
    main()
