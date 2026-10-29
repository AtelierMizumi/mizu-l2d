#!/usr/bin/env bash
# S0-perf: native daemon cost. Side B of the A/B (see webkit_bench_gtk4.py for side A).
#
# Usage (from anywhere; run on an EMPTY niri workspace, see CLAUDE.md rule 7):
#   bash spikes/s0-perf/native_measure.sh model        # real Cubism model (config default)
#   bash spikes/s0-perf/native_measure.sh placeholder  # no model: WebKit-free floor
#
# Keep the mouse still: the daemon ramps to idle_fps after quiet_time_s without input,
# and that ramp is part of what is measured.
set -euo pipefail

MODE=${1:-model}
WARM=${WARM:-8}      # seconds before sampling (past quiet_time_s = 5 s)
SAMPLE=${SAMPLE:-8}  # seconds of CPU sampling

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BIN=$ROOT/build/mizu-l2d
CTL=$ROOT/build/mizu-l2d-ctl
CLK_TCK=$(getconf CLK_TCK)

[ -x "$BIN" ] && [ -x "$CTL" ] || { echo "build first: ninja -C $ROOT/build" >&2; exit 1; }
case "$MODE" in
  model|placeholder) ;;
  *) echo "mode must be 'model' or 'placeholder'" >&2; exit 2 ;;
esac

TMP=$(mktemp -d)
PID=""
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill -INT "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

ARGS=()
if [ "$MODE" = placeholder ]; then
  printf '[model]\npath = ""\n' > "$TMP/config.toml"
  ARGS=(--config "$TMP/config.toml")
fi

"$BIN" "${ARGS[@]}" >"$TMP/daemon.log" 2>&1 &
PID=$!

# Wait for IPC, but fail fast if the daemon exits (for example, no Wayland session).
for _ in $(seq 1 40); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "daemon exited early; log:" >&2; cat "$TMP/daemon.log" >&2; exit 1
  fi
  "$CTL" ping >/dev/null 2>&1 && break
  sleep 0.5
done
"$CTL" ping >/dev/null 2>&1 || { echo "IPC never answered; log:" >&2; cat "$TMP/daemon.log" >&2; exit 1; }

sleep "$WARM"

ticks() { awk '{print $14 + $15}' "/proc/$PID/stat"; }
pss_mb() { awk '/^Pss:/ {print $2/1024}' "/proc/$PID/smaps_rollup" 2>/dev/null || echo 0; }

T0=$(ticks)
sleep "$SAMPLE"
T1=$(ticks)
CPU=$(awk -v d=$((T1 - T0)) -v hz="$CLK_TCK" -v s="$SAMPLE" 'BEGIN {printf "%.2f", 100.0 * d / hz / s}')
PSS=$(pss_mb)

echo "=== side B native, mode=$MODE ==="
echo "cpu_pct_daemon=$CPU  pss_mb=$(printf '%.1f' "$PSS")  threads=$(ls /proc/$PID/task | wc -l)"
echo "--- daemon perf (cumulative since start; fps includes warm-up) ---"
"$CTL" perf
echo "--- daemon log (last 5 lines) ---"
tail -5 "$TMP/daemon.log"
