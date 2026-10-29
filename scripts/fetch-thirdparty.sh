#!/usr/bin/env bash
# fetch-thirdparty.sh — download the pieces we may not redistribute.
#
# 1. Live2D Cubism SDK for Native (Core is proprietary; the Framework carries
#    Live2D license headers). Downloading and using it means you accept the
#    Live2D Cubism SDK agreements: https://www.live2d.com/en/sdk/license/
#    Nothing under third_party/cubism/ is ever committed to git.
# 2. Nothing else yet — stb/toml++/ImGui arrive when their features do
#    (toml++ comes from the system package on Arch).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TP="$REPO_ROOT/third_party"
CUBISM_VER="${CUBISM_VER:-5-r.3}"
CUBISM_URL="https://cubism.live2d.com/sdk-native/bin/CubismSdkForNative-$CUBISM_VER.zip"
CUBISM_DIR="$TP/cubism"

mkdir -p "$TP"

if [ -d "$CUBISM_DIR/Core" ]; then
    echo "cubism: $CUBISM_DIR/Core already present"
else
    echo "cubism: downloading $CUBISM_URL"
    echo "        (by using the SDK you accept the Live2D SDK license terms)"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    curl -fSL --retry 3 -o "$tmp/sdk.zip" "$CUBISM_URL"
    unzip -q "$tmp/sdk.zip" -d "$tmp/sdk"
    src=$(find "$tmp/sdk" -maxdepth 1 -type d -name "CubismSdkForNative*" | head -1)
    [ -n "$src" ] || { echo "unexpected zip layout"; exit 1; }
    mkdir -p "$CUBISM_DIR"
    cp -r "$src/Core" "$CUBISM_DIR/"
    cp -r "$src/Framework" "$CUBISM_DIR/"
    echo "cubism: Core + Framework -> $CUBISM_DIR"
fi

"$REPO_ROOT/scripts/patch-cubism.sh"
echo "done."
