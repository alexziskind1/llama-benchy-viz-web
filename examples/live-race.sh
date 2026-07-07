#!/usr/bin/env bash
# Concurrent multi-model race → live-race web dashboard.
# Uses the sibling _merge_benchys.py to namespace per-producer
# request_ids, dedup bench_complete, and log producer stderr to a
# per-run file (silent failures surface after the dashboard exits).
#
# Usage:
#   ./examples/live-race.sh                      # 2 models (defaults below)
#   MODEL_A=… MODEL_B=… ./examples/live-race.sh  # override
#   MODEL_C=… MODEL_D=… ./examples/live-race.sh  # extend to 3 or 4
#
# Set MODEL_C="" or MODEL_D="" to leave them off (default).

set -euo pipefail

BENCHY=/Users/alex/Code/youtube/llama-benchy/.venv/bin/llama-benchy
VIZ=/Users/alex/Code/youtube/llama-benchy-viz-web/.venv/bin/llama-benchy-viz-web
HERE=$(cd "$(dirname "$0")" && pwd)
MERGE="$HERE/_merge_benchys.py"

MODEL_A="${MODEL_A:-qwen/qwen3-4b-2507}"
TOKENIZER_A="${TOKENIZER_A:-Qwen/Qwen3-4B}"
BASE_URL_A="${BASE_URL_A:-http://localhost:1234/v1}"

MODEL_B="${MODEL_B:-qwen/qwen3-4b}"
TOKENIZER_B="${TOKENIZER_B:-${MODEL_B}}"
BASE_URL_B="${BASE_URL_B:-http://localhost:1234/v1}"

MODEL_C="${MODEL_C:-}"
TOKENIZER_C="${TOKENIZER_C:-${MODEL_C}}"
BASE_URL_C="${BASE_URL_C:-http://localhost:1234/v1}"

MODEL_D="${MODEL_D:-}"
TOKENIZER_D="${TOKENIZER_D:-${MODEL_D}}"
BASE_URL_D="${BASE_URL_D:-http://localhost:1234/v1}"

PORT="${PORT:-8000}"
COMMON="--pp 512 2048 --tg 128 256 --runs 1 --no-warmup --skip-coherence --latency-mode none --emit-progress -"

producers=(
  --producer "$BENCHY --base-url $BASE_URL_A --model $MODEL_A --tokenizer $TOKENIZER_A $COMMON"
  --producer "$BENCHY --base-url $BASE_URL_B --model $MODEL_B --tokenizer $TOKENIZER_B $COMMON"
)
[[ -n "$MODEL_C" ]] && producers+=(--producer "$BENCHY --base-url $BASE_URL_C --model $MODEL_C --tokenizer $TOKENIZER_C $COMMON")
[[ -n "$MODEL_D" ]] && producers+=(--producer "$BENCHY --base-url $BASE_URL_D --model $MODEL_D --tokenizer $TOKENIZER_D $COMMON")

python3 "$MERGE" "${producers[@]}" | "$VIZ" --port "$PORT" --name "race"
