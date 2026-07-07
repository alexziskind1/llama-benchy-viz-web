#!/usr/bin/env bash
# Pipe a single-model llama-benchy run into the web dashboard.
# Auto-detects "live-single" from the in-flight stream. Open the
# printed URL in a browser.
#
# Usage:
#   ./examples/live-single.sh
#   MODEL=foo TOKENIZER=bar BASE_URL=http://h:1234/v1 PORT=8000 ./examples/live-single.sh

set -euo pipefail

BENCHY=/Users/alex/Code/youtube/llama-benchy/.venv/bin/llama-benchy
VIZ=/Users/alex/Code/youtube/llama-benchy-viz-web/.venv/bin/llama-benchy-viz-web

MODEL="${MODEL:-qwen/qwen3-4b-2507}"
TOKENIZER="${TOKENIZER:-Qwen/Qwen3-4B}"
BASE_URL="${BASE_URL:-http://localhost:1234/v1}"
PORT="${PORT:-8000}"

"$BENCHY" \
  --base-url "$BASE_URL" \
  --model "$MODEL" \
  --tokenizer "$TOKENIZER" \
  --pp 512 1024 2048 --tg 128 256 --runs 1 \
  --no-warmup --skip-coherence --latency-mode none \
  --emit-progress - \
  | "$VIZ" --port "$PORT" --name "$MODEL · live"
