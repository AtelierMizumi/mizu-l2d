#!/usr/bin/env bash
# fetch-model.sh <model-name> [dest-dir] [--bg] [--force] [--verify] [--jobs N]
# Download one Azur Lane Live2D model + its interaction data.
#
# Thin wrapper kept because serve.py and the mizu shell call this path. The
# implementation lives in fetch-model.py (manifest-driven, sha256-verified,
# atomic install — remote-model-sources.md M1). Assets are Manjuu/Yongshi /
# Yostar / Bilibili IP — personal, local use only.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -I -B "$DIR/fetch-model.py" "$@"
