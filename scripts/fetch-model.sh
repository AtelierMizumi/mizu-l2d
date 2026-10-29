#!/usr/bin/env bash
# fetch-model.sh <model-name> [dest-dir]
# Download one Azur Lane Live2D model + its interaction data.
#
# Primary source: nagami.moe public CDNs (same extraction lineage as
# MilkyLan/AzurLane-Live2d, plus animator.json and the per-skin interaction
# config when the site has one). Assets are Manjuu/Yongshi / Yostar / Bilibili
# IP — personal, local use only.
set -euo pipefail

MODEL="${1:?usage: fetch-model.sh <model-name> [dest-dir]}"
DEST="${2:-$HOME/.local/share/mizu/l2d/$MODEL}"
UA="mizu-l2d-fetch/0.2"
ASSETS="https://azlassets.nagami.moe/EN"
DATA="https://data.nagami.moe/live2d/EN"

mkdir -p "$DEST"

fetch() { # fetch <url> <dest-file>
    echo "fetch $2"
    curl -fsSL --retry 3 -A "$UA" -o "$2" "$1"
}

fetch "$ASSETS/live2d/$MODEL/$MODEL.model3.json" "$DEST/$MODEL.model3.json"

# enumerate every file the model settings reference (moc, textures, motions, physics)
python3 - "$DEST/$MODEL.model3.json" "$DEST" "$ASSETS/live2d/$MODEL" "$UA" <<'EOF'
import json, pathlib, subprocess, sys

settings_path, dest, base, ua = sys.argv[1:5]
s = json.load(open(settings_path))
ref = s["FileReferences"]

def get(rel):
    # model3.json comes from a third-party CDN: never write outside the model dir
    rp = pathlib.PurePosixPath(rel)
    if not rel or rp.is_absolute() or ".." in rp.parts:
        sys.exit(f"refusing unsafe path in model3.json: {rel!r}")
    p = pathlib.Path(dest) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    url = f"{base}/{rel}"
    print(f"fetch {rel}")
    subprocess.run(["curl", "-fsSL", "--retry", "3", "-A", ua, "-o", str(p), url], check=True)

if ref.get("Moc"):
    get(ref["Moc"])
for t in ref.get("Textures", []):
    get(t)
for group in (ref.get("Motions") or {}).values():
    for m in group:
        get(m["File"])
if ref.get("Physics"):
    get(ref["Physics"])
if ref.get("Pose"):
    get(ref["Pose"])
EOF

# interaction/animation data from the site's data layer (optional — older
# models have none of these)
curl -fsSL -A "$UA" -o "$DEST/$MODEL.animator.json" \
    "$ASSETS/live2d/$MODEL/$MODEL.animator.json" 2>/dev/null \
    || { rm -f "$DEST/$MODEL.animator.json"; echo "no animator.json"; }
curl -fsSL -A "$UA" -o "$DEST/skins.json" \
    "$DATA/skins/$MODEL.json?v=1" 2>/dev/null \
    || { rm -f "$DEST/skins.json"; echo "no skins.json"; }

echo "done -> $DEST"
