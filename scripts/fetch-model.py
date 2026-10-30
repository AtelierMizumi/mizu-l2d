#!/usr/bin/env python3
"""fetch-model.py — manifest-driven model downloader (remote-model-sources.md M1).

usage: fetch-model.py <prefab> [dest-dir] [--bg] [--force] [--verify] [--jobs N]

Downloads one Azur Lane Live2D model + its interaction data into a temporary
directory, verifies every file, then swaps the directory into place atomically.
A `.mizu-manifest.json` (relative path → sha256 + bytes) is written into the
installed prefab so `--verify` and the cache tool can check integrity later.

Sources: nagami.moe public CDNs (same extraction lineage as
MilkyLan/AzurLane-Live2d, plus animator.json and the per-skin interaction
config when the site has one). Assets are Manjuu/Yongshi / Yostar / Bilibili
IP — personal, local use only.

Files already present in the destination are reused (hash recorded, no
re-download) unless `--force` is given. Interrupted runs leave the old model
untouched. On success the cache ledger (l2d_ledger.py) is updated with the
prefab's size and last-used time.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import l2d_ledger  # noqa: E402

PREFAB_RE = re.compile(r"^[a-z0-9_]+$")
UA = "mizu-l2d-fetch/0.3"
ASSETS = "https://azlassets.nagami.moe/EN"
DATA = "https://data.nagami.moe/live2d/EN"
MANIFEST_NAME = ".mizu-manifest.json"


def die(msg, code=1):
    print(msg)
    sys.exit(code)


def safe_rel(rel):
    """model3.json comes from a third-party CDN: never write outside the model dir."""
    rp = Path(rel)
    if not rel or rp.is_absolute() or ".." in rp.parts:
        die(f"refusing unsafe path in model3.json: {rel!r}")
    return Path(rel)


def fetch_args():
    ap = argparse.ArgumentParser(description="download one Live2D model prefab")
    ap.add_argument("prefab")
    ap.add_argument("dest", nargs="?",
                    default=None, help="default ~/.local/share/mizu/l2d/<prefab>")
    ap.add_argument("--bg", action="store_true", help="also fetch the skin background")
    ap.add_argument("--force", action="store_true", help="re-download files already present")
    ap.add_argument("--verify", action="store_true", help="check an installed prefab against its manifest")
    ap.add_argument("--jobs", type=int, default=3, help="parallel downloads (default 3)")
    return ap.parse_args()


def http_get(url, dest, resume=False):
    cmd = ["curl", "-fsSL", "--retry", "3", "-A", UA]
    if resume:
        cmd += ["-C", "-"]
    cmd += ["-o", str(dest), url]
    subprocess.run(cmd, check=True)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def model_files(model3_path):
    """Relative paths referenced by the model settings (moc, textures, motions, physics)."""
    ref = json.loads(model3_path.read_text(encoding="utf-8"))["FileReferences"]
    rels = []
    if ref.get("Moc"):
        rels.append(ref["Moc"])
    rels.extend(ref.get("Textures", []))
    for group in (ref.get("Motions") or {}).values():
        for m in group:
            rels.append(m["File"])
    if ref.get("Physics"):
        rels.append(ref["Physics"])
    if ref.get("Pose"):
        rels.append(ref["Pose"])
    return [str(safe_rel(r)) for r in rels if r]


def resolve_bg(prefab):
    """Skin background id from the cached mapping, or None."""
    mapping = Path.home() / ".local/share/mizu/data/l2d_mapping.json"
    if not mapping.is_file():
        mapping.parent.mkdir(parents=True, exist_ok=True)
        http_get(f"{DATA}/l2d_mapping.json", mapping)
    with open(mapping, encoding="utf-8") as f:
        data = json.load(f)
    for ship in data.values():
        for skin in ship.get("skins", []):
            if skin.get("prefab") == prefab and skin.get("bg"):
                return str(skin["bg"])
    return None


def download_one(job):
    url, dest = job
    partial = dest.is_file() and dest.stat().st_size > 0
    try:
        http_get(url, dest, resume=partial)
    except subprocess.CalledProcessError:
        if not (partial and dest.is_file() and dest.stat().st_size > 0):
            raise
        # a resume attempt failed but a complete file survived; curl -f deletes
        # only what it wrote, so trust the pre-existing bytes
    if not dest.is_file() or dest.stat().st_size == 0:
        raise RuntimeError(f"empty download: {url}")


def fetch_optional(plan, tmp, reuse_from):
    """Interaction data the site only has for some models: fetch, tolerate 404."""
    for key, path in plan["optional"].items():
        src = reuse_from / path if reuse_from else None
        target = tmp / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if src is not None and src.is_file():
            shutil.copy2(src, target)
            plan["files"][path] = plan["optional_urls"][key]
            print(f"reuse {path}")
            continue
        try:
            print(f"fetch {path}")
            http_get(plan["optional_urls"][key], target)
            plan["files"][path] = plan["optional_urls"][key]
        except subprocess.CalledProcessError:
            target.unlink(missing_ok=True)
            print(f"no {key}")


def install_atomic(dest, plan, reuse_from):
    """Build the full prefab in dest.tmp-<pid>, then swap it in. Returns the manifest."""
    tmp = dest.parent / f"{dest.name}.tmp-{os.getpid()}"
    old = dest.parent / f"{dest.name}.old"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(old, ignore_errors=True)
    tmp.mkdir(parents=True)
    manifest = {"v": 1, "prefab": plan["prefab"], "files": {}}
    try:
        jobs = []
        for rel, url in plan["files"].items():
            target = tmp / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            src = reuse_from / rel if reuse_from else None
            if src is not None and src.is_file():
                shutil.copy2(src, target)
                print(f"reuse {rel}")
            else:
                print(f"fetch {rel}")
                jobs.append((url, target))
        if jobs:
            workers = max(1, min(plan["jobs"], len(jobs)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for _ in pool.map(download_one, jobs):
                    pass
        fetch_optional(plan, tmp, reuse_from)
        for rel in plan["files"]:
            p = tmp / rel
            manifest["files"][rel] = {"sha256": sha256_of(p), "bytes": p.stat().st_size}
        (tmp / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if dest.exists():
            dest.rename(old)
        tmp.rename(dest)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        if old.exists() and not dest.exists():
            old.rename(dest)
        raise
    shutil.rmtree(old, ignore_errors=True)
    return manifest


def verify_prefab(dest):
    mf = dest / MANIFEST_NAME
    if not mf.is_file():
        die(f"no {MANIFEST_NAME} in {dest}; re-fetch with --force to build one", 2)
    records = json.loads(mf.read_text(encoding="utf-8"))["files"]
    bad = 0
    for rel, rec in sorted(records.items()):
        p = dest / rel
        if not p.is_file():
            print(f"missing {rel}")
            bad += 1
        elif sha256_of(p) != rec["sha256"]:
            print(f"corrupt {rel}")
            bad += 1
    print(f"checked {len(records)} files, {bad} bad")
    if bad:
        sys.exit(2)


def main():
    args = fetch_args()
    prefab = args.prefab
    if not PREFAB_RE.fullmatch(prefab):
        die(f"invalid prefab name: {prefab!r}")
    dest = Path(args.dest or (Path.home() / ".local/share/mizu/l2d" / prefab))
    dest.parent.mkdir(parents=True, exist_ok=True)
    if args.verify:
        verify_prefab(dest)
        return

    reuse_from = dest if dest.is_dir() and not args.force else None
    plan = {"prefab": prefab, "jobs": args.jobs, "files": {}, "optional": {}, "optional_urls": {}}

    # model3.json first: everything else is enumerated from it
    model3_rel = f"{prefab}.model3.json"
    model3_tmp = dest.parent / f"{dest.name}.tmp-model3.json"
    try:
        http_get(f"{ASSETS}/live2d/{prefab}/{model3_rel}", model3_tmp)
    except subprocess.CalledProcessError:
        die(f"model3.json not found for {prefab} (404)")
    plan["files"][model3_rel] = f"{ASSETS}/live2d/{prefab}/{model3_rel}"
    rels = model_files(model3_tmp)
    model3_tmp.unlink()
    for rel in rels:
        plan["files"][rel] = f"{ASSETS}/live2d/{prefab}/{rel}"

    # interaction/animation data from the site's data layer (optional)
    plan["optional"]["animator.json"] = f"{prefab}.animator.json"
    plan["optional_urls"]["animator.json"] = f"{ASSETS}/live2d/{prefab}/{prefab}.animator.json"
    plan["optional"]["skins.json"] = "skins.json"
    plan["optional_urls"]["skins.json"] = f"{DATA}/skins/{prefab}.json?v=1"

    manifest = install_atomic(dest, plan, reuse_from)

    # scene background (shared by all models; lives outside the prefab dir)
    if args.bg:
        bg = resolve_bg(prefab)
        if bg:
            bg_dir = dest.parent / "bg"
            bg_dir.mkdir(parents=True, exist_ok=True)
            bg_file = bg_dir / f"{bg}.png"
            if not bg_file.is_file():
                tmp_bg = bg_file.with_suffix(".png.tmp")
                http_get(f"{ASSETS}/bg/star_level_bg_{bg}.png", tmp_bg)
                os.replace(tmp_bg, bg_file)
            bg_manifest = bg_dir / MANIFEST_NAME
            try:
                records = json.loads(bg_manifest.read_text(encoding="utf-8"))
            except Exception:
                records = {}
            records[f"{bg}.png"] = {"sha256": sha256_of(bg_file), "bytes": bg_file.stat().st_size}
            bg_manifest.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
        else:
            print(f"no bg in mapping for {prefab}")

    l2d_ledger.set_bytes(dest.parent, prefab, l2d_ledger.dir_size(dest))
    print(f"done -> {dest} ({len(manifest['files'])} files)")


if __name__ == "__main__":
    main()
