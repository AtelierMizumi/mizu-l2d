#!/usr/bin/env bash
# Measures total RSS memory across all mizu-l2d wallpaper processes.
# Budget: < 400 MB on dual-monitor setup.

set -euo pipefail

PIDS=$(pgrep -f "mizu-l2d-wall\.py|WebKitWebProcess|WebKitNetworkProcess" || true)

if [ -z "$PIDS" ]; then
    echo "No running mizu-l2d wallpaper processes found."
    exit 0
fi

echo "=== Mizu-L2D Process Memory (RSS) ==="
ps -o pid,rss,comm,args -p $PIDS

TOTAL_RSS_KB=$(ps -o rss= -p $PIDS | awk '{s+=$1} END {print s}')
TOTAL_RSS_MB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_RSS_KB / 1024}")

echo "---------------------------------------"
echo "Total Combined RSS: ${TOTAL_RSS_MB} MB"
if (( $(awk "BEGIN {print ($TOTAL_RSS_MB < 400.0) ? 1 : 0}") )); then
    echo "STATUS: PASS (< 400 MB budget)"
    exit 0
else
    echo "STATUS: FAIL (>= 400 MB budget exceeded)"
    exit 1
fi
