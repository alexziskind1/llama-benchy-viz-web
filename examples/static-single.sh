#!/usr/bin/env bash
# Run a single-model benchmark, save the JSONL to fixtures/, then
# replay it through the web dashboard (auto-detects "static-single").
#
# Usage:
#   ./examples/static-single.sh
#   MODEL=foo TOKENIZER=bar BASE_URL=http://h:1234/v1 PORT=8000 ./examples/static-single.sh

set -euo pipefail

BENCHY=/Users/alex/Code/youtube/llama-benchy/.venv/bin/llama-benchy
VIZ=/Users/alex/Code/youtube/llama-benchy-viz-web/.venv/bin/llama-benchy-viz-web
DIR=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DIR/fixtures"

MODEL="${MODEL:-qwen/qwen3-4b-2507}"
TOKENIZER="${TOKENIZER:-Qwen/Qwen3-4B}"
BASE_URL="${BASE_URL:-http://localhost:1234/v1}"
PORT="${PORT:-8000}"
TS=$(date +%Y%m%d_%H%M%S)
OUT="$DIR/fixtures/single-${TS}.jsonl"

"$BENCHY" \
  --base-url "$BASE_URL" --model "$MODEL" --tokenizer "$TOKENIZER" \
  --pp 512 1024 2048 --tg 128 256 --runs 1 \
  --no-warmup --skip-coherence --latency-mode none \
  --emit-progress "$OUT"

echo
echo "captured: $OUT"
echo "replaying through web dashboard on port $PORT (Ctrl+C to exit)…"
echo
"$VIZ" --port "$PORT" --name "$(basename "$OUT" .jsonl)" "$OUT"
