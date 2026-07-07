#!/usr/bin/env bash
# Replay a captured JSONL fixture through the web dashboard.
#
# Usage:
#   ./examples/replay.sh path/to/fixture.jsonl
#   PORT=8001 ./examples/replay.sh /tmp/progress.jsonl
#
# The dashboard auto-exits 5 seconds after bench_complete; press
# Ctrl+C to skip the hold and quit early.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <fixture.jsonl> [--name LABEL] [extra viz-web flags…]" >&2
  exit 1
fi

VIZ=/Users/alex/Code/youtube/llama-benchy-viz-web/.venv/bin/llama-benchy-viz-web
FIXTURE="$1"
shift

PORT="${PORT:-8000}"
NAME=$(basename "$FIXTURE" .jsonl)

"$VIZ" --auto-exit --hold 5 --port "$PORT" --name "$NAME" "$@" "$FIXTURE"
