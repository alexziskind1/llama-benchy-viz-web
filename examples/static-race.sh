#!/usr/bin/env bash
# Run TWO models concurrently, capture the merged JSONL to fixtures/,
# then replay it through the web dashboard (auto-detects "static-race"
# once bench_complete arrives).
#
# Pass --watch to also pipe the live merge into the dashboard while
# capturing (dashboard runs in live-race until finish, then flips to
# static-race).
#
# Usage:
#   ./examples/static-race.sh
#   ./examples/static-race.sh --watch
#   MODEL_A=… MODEL_B=… ./examples/static-race.sh

set -euo pipefail

BENCHY=/Users/alex/Code/youtube/llama-benchy/.venv/bin/llama-benchy
VIZ=/Users/alex/Code/youtube/llama-benchy-viz-web/.venv/bin/llama-benchy-viz-web
HERE=$(cd "$(dirname "$0")" && pwd)
MERGE="$HERE/_merge_benchys.py"
mkdir -p "$HERE/fixtures"

WATCH=0
if [[ "${1:-}" == "--watch" ]]; then WATCH=1; fi

MODEL_A="${MODEL_A:-qwen/qwen3-4b-2507}"
TOKENIZER_A="${TOKENIZER_A:-Qwen/Qwen3-4B}"
BASE_URL_A="${BASE_URL_A:-http://localhost:1234/v1}"

MODEL_B="${MODEL_B:-qwen/qwen3-4b}"
TOKENIZER_B="${TOKENIZER_B:-${MODEL_B}}"
BASE_URL_B="${BASE_URL_B:-http://localhost:1234/v1}"

PORT="${PORT:-8000}"
COMMON="--pp 512 2048 --tg 128 256 --runs 1 --no-warmup --skip-coherence --latency-mode none --emit-progress -"

PRODUCER_A="$BENCHY --base-url $BASE_URL_A --model $MODEL_A --tokenizer $TOKENIZER_A $COMMON"
PRODUCER_B="$BENCHY --base-url $BASE_URL_B --model $MODEL_B --tokenizer $TOKENIZER_B $COMMON"

TS=$(date +%Y%m%d_%H%M%S)
OUT="$HERE/fixtures/race-${TS}.jsonl"

if [[ $WATCH -eq 1 ]]; then
  python3 "$MERGE" --producer "$PRODUCER_A" --producer "$PRODUCER_B" \
    | tee "$OUT" \
    | "$VIZ" --port "$PORT" --name "race-${TS}"
  echo
  echo "captured: $OUT"
else
  python3 "$MERGE" --producer "$PRODUCER_A" --producer "$PRODUCER_B" > "$OUT"
  echo "captured: $OUT"
  echo "replaying through web dashboard on port $PORT (Ctrl+C to exit)…"
  echo
  "$VIZ" --port "$PORT" --name "race-${TS}" "$OUT"
fi
