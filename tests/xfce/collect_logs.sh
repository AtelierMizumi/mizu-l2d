#!/usr/bin/env bash
# Task 4: log bot — read-only evidence bundle for XFCE runs.
# Usage: collect_logs.sh <evidence/logs>
# Copies wall.log, journal warnings, env, tokens and wallpaper state into
# $OUT. Every copy has a fallback and the script always exits 0.
set -u
OUT="${1:?usage: collect_logs.sh <evidence/logs>}"
mkdir -p "$OUT"
cp ~/.local/state/mizu-l2d/wall.log "$OUT/wall.log" 2>/dev/null || echo missing > "$OUT/wall.log"
journalctl --user -b -p warning --no-pager 2>&1 | tail -200 > "$OUT/journal.txt" || true
[ -f "$OUT/journal.txt" ] || echo missing > "$OUT/journal.txt"
env | grep -E '^(DISPLAY|XDG_|WAYLAND_)' | sort > "$OUT/env.txt" 2>/dev/null || true
[ -f "$OUT/env.txt" ] || echo missing > "$OUT/env.txt"
cp ~/.cache/mizu/tokens.json "$OUT/tokens.json" 2>/dev/null || echo missing > "$OUT/tokens.json"
cat ~/.cache/mizu/state/wallpaper 2>/dev/null > "$OUT/wallpaper" || echo missing > "$OUT/wallpaper"
exit 0
