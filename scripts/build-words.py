#!/usr/bin/env python3
"""Build web/data/words/<prefab>.json: L2D dialogue lines + voice clip URLs (R1d).

usage: scripts/build-words.py [--refresh]

Inputs are downloaded once into ~/.local/share/mizu/words/ (outside git):
  voiceline.json           Fernando2603/AzurLane: per skin id, EN line + .ogg link
  skin.json                same repo: skin id -> gid (ship), EN name
  lua/ship_skin_template_sublist/*.lua
                           AzurLaneLuaScripts EN: skin id -> prefab (painting)
Output: web/data/words/<prefab>.json = { key: { "line": str, "audio": url } }
for the L2D keys below. web/data is gitignored: game-derived text and audio
links are never committed.

Prefab -> skin id resolution, in order:
  1. Lua record whose prefab matches case-insensitively (the Lua data has
     mixed-case names such as "yuekechengII_3").
  2. Name join: catalog skin EN name == skin.json name within the same ship
     (gid == ship key). Used for skins absent from the Lua chunks.
When several ids remain, the one whose EN name matches wins; if they still
tie, the lowest id is taken and the prefab is listed as ambiguous.
"""
import glob
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "web" / "data" / "l2d_mapping.json"
OUT = ROOT / "web" / "data" / "words"
CACHE = Path.home() / ".local" / "share" / "mizu" / "words"
VOICELINE_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/voiceline.json"
SKIN_URL = "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/skin.json"
LUA_LIST_URL = ("https://api.github.com/repos/AzurLaneTools/AzurLaneLuaScripts/contents/"
                "EN/sharecfg/ship_skin_template_sublist")
UA = "mizu-l2d-words/0.1"
# Coverage audit 2026-11: upstream voiceline.json carries ~60 keys per skin
# (unlock, detail, feeling5, win_mvp, expedition, battle, lose, upgrade, skill,
# feeling1-4, propose, profile, headtouch, gift_prefer, hp_warning,
# couple_encourage1-6, *_ex event variants, plus L2D touch/main/login/home).
# Thorough fix: do not whitelist 12 keys — copy every upstream entry that has a
# line, so skins like lisailiu_2 stop collapsing drag/idle zones onto one generic
# touch line. The old KEYS list is kept only for stats ordering.
KEYS = ["touch", "touch2", "headtouch", "main1", "main2", "main3", "main4",
        "login", "home", "mission", "mission_complete", "mail"]
# canonical order for deterministic output; uncovered upstream keys sort after
PREFERRED_ORDER = KEYS
RECORD_START = re.compile(r"^\s*\[(\d+)\]\s*=\s*\{\s*$")
FIELD = re.compile(r"^\s*(\w+)\s*=\s*(.*?),?\s*$")


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        f.write(resp.read())


def ensure(url, dest, refresh):
    if refresh or not dest.exists():
        print(f"download {dest.name}")
        fetch(url, dest)
    return dest


def ensure_lua(refresh):
    lua_dir = CACHE / "lua"
    lua_dir.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(LUA_LIST_URL, headers={"User-Agent": UA}),
                                timeout=60) as resp:
        listing = json.load(resp)
    # only the chunks listed in the sublist folder: the sibling
    # ship_skin_template.lua is an index of plain numbers, not records
    paths = []
    for entry in listing:
        dest = lua_dir / entry["name"]
        if refresh or not dest.exists():
            print(f"download {entry['name']}")
            fetch(entry["download_url"], dest)
        paths.append(dest)
    return sorted(paths)


def parse_lua(paths):
    """skin id -> {prefab, name} from the record blocks of the Lua chunks."""
    records = {}
    for path in paths:
        current, depth = None, 0
        for line in path.read_text(encoding="utf-8").splitlines():
            if current is None:
                m = RECORD_START.match(line)
                if m:
                    current, depth = {"id": int(m.group(1))}, 1
                continue
            depth += line.count("{") - line.count("}")
            if depth == 1:
                m = FIELD.match(line)
                if m and m.group(1) in ("prefab", "name"):
                    current[m.group(1)] = m.group(2).strip().strip('"')
            if depth <= 0:
                records[current["id"]] = current
                current = None
    return records


def norm_name(s):
    return re.sub(r"\s+", " ", re.sub(r"\{namecode:\d+\}", "", s or "")).strip().casefold()


def main():
    refresh = "--refresh" in sys.argv
    CACHE.mkdir(parents=True, exist_ok=True)
    voiceline = json.loads(ensure(VOICELINE_URL, CACHE / "voiceline.json", refresh).read_text(encoding="utf-8"))
    skins = json.loads(ensure(SKIN_URL, CACHE / "skin.json", refresh).read_text(encoding="utf-8"))
    lua = parse_lua(ensure_lua(refresh))
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    # skin.json: id -> (gid, name); the file wraps each record in "value"
    skin_info = {}
    for rec in skins.values():
        v = rec.get("value", rec)
        skin_info[int(v["id"])] = (str(v.get("gid")), v.get("name") or "")

    lua_by_prefab = defaultdict(list)
    for sid, rec in lua.items():
        if rec.get("prefab"):
            lua_by_prefab[rec["prefab"].lower()].append(sid)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()

    stats = defaultdict(int)
    key_counts = defaultdict(int)
    ambiguous = []
    unmatched = []
    for ship_id, ship in catalog.items():
        for skin in ship.get("skins", []):
            prefab = skin["prefab"]
            en = norm_name(skin.get("names", {}).get("EN"))
            candidates = list(lua_by_prefab.get(prefab.lower(), []))
            source = "lua"
            if not candidates:
                candidates = [sid for sid, (gid, name) in skin_info.items()
                              if gid == ship_id and norm_name(name) == en]
                source = "name"
            if len(candidates) > 1:
                by_name = [sid for sid in candidates
                           if norm_name(lua.get(sid, {}).get("name") or skin_info.get(sid, ("", ""))[1]) == en]
                if by_name:
                    candidates = by_name
            if not candidates:
                unmatched.append(prefab)
                continue
            if len(candidates) > 1:
                ambiguous.append((prefab, sorted(candidates)))
            sid = min(candidates)
            stats[source] += 1
            line_map = voiceline.get(str(sid), {})
            words = {}
            for key, entry in line_map.items():
                if entry and entry.get("line"):
                    words[key] = {"line": entry["line"], "audio": entry.get("link")}
                    key_counts[key] += 1
            if not words:
                stats["no_voice"] += 1
                continue
            stats["written"] += 1
            (OUT / f"{prefab}.json").write_text(
                json.dumps(words, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(len(s.get("skins", [])) for s in catalog.values())
    print(f"\ncoverage: {total} skins in catalog")
    print(f"  prefab->skin id via Lua: {stats['lua']}, via name join: {stats['name']}, unmatched: {len(unmatched)}")
    print(f"  words files written: {stats['written']} (no L2D voice: {stats['no_voice']})")
    print("  lines per key: " + ", ".join(f"{k}={key_counts[k]}" for k in KEYS))
    if ambiguous:
        print(f"  ambiguous prefabs ({len(ambiguous)}), lowest id taken:")
        for prefab, ids in ambiguous:
            print(f"    {prefab}: {ids}")
    if unmatched:
        print(f"  unmatched prefabs: {', '.join(unmatched)}")


if __name__ == "__main__":
    main()
