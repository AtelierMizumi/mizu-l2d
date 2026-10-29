#!/usr/bin/env bash
# fetch-web-deps.sh — vendor the MIT web libraries into web/vendor/ (PLAN §8 R0.2).
# Only MIT-licensed libraries pass through here. The Cubism Core (Live2D
# proprietary) and nagami/Azur Lane data stay out of the repo (SPEC §12 D-L2)
# and are mirrored under ~/.local/share/mizu/ instead.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$REPO_ROOT/web/vendor"
UA="mizu-l2d-fetch/0.2"

mkdir -p "$VENDOR"

# name|version|bundle-url|license-url — pinned; jsDelivr serves npm verbatim.
# The minified bundles carry no embedded license notice, so the package
# LICENSE text is vendored alongside each bundle (MIT requires it).
DEPS=(
    "pixi.min.js|6.5.10|https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js|https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/LICENSE"
    "pixi-live2d-display.min.js|0.4.0|https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/index.min.js|https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/LICENSE"
)

entries=""
for dep in "${DEPS[@]}"; do
    IFS='|' read -r name version url license_url <<<"$dep"
    out="$VENDOR/$name"
    echo "fetch $name@$version"
    curl -fsSL --retry 3 -A "$UA" -o "$out" "$url"
    [ -s "$out" ] || { echo "empty download: $name" >&2; exit 1; }
    curl -fsSL --retry 3 -A "$UA" -o "$out.LICENSE" "$license_url"
    grep -q "Permission is hereby granted, free of charge" "$out.LICENSE" \
        || { echo "$out.LICENSE does not look like an MIT license" >&2; exit 1; }
    sha="$(sha256sum "$out" | cut -d' ' -f1)"
    # informational: pixi embeds a banner, pixi-live2d-display 0.4.0 does not
    if head -c 800 "$out" | grep -qi 'MIT'; then
        banner="bundle banner ok"
    else
        banner="no banner in bundle (LICENSE file vendored)"
    fi
    echo "  sha256=$sha ($banner)"
    entries+="| $name | $version | $url | $sha | $(date -u +%F) |"$'\n'
done

cat > "$VENDOR/SOURCES.md" <<EOF
# Vendored web libraries

Pinned and fetched by scripts/fetch-web-deps.sh (PLAN §8 R0.2); re-run the
script to refresh. Both libraries are MIT; each bundle ships with its package
LICENSE text as <file>.LICENSE (the pixi-live2d-display 0.4.0 bundle carries
no embedded notice).

Not vendored here (SPEC §12 D-L2): the Live2D Cubism Core (proprietary) and
all nagami/Azur Lane data. They are mirrored under ~/.local/share/mizu/ and
referenced by path at runtime; web/vendor/live2dcubismcore.min.js, web/data/
and web/assets are gitignored.

| file | version | source URL | sha256 | fetched |
|---|---|---|---|---|
$entries
EOF

echo "done -> $VENDOR"
