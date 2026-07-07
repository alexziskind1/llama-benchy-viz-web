"""Slow JSONL emitter for visually verifying the live web dashboard modes.

Pipe into viz-web to watch a synthetic benchmark progress in real time:

    python -m tests.live_demo race-2 | \
        .venv/bin/llama-benchy-viz-web --mode live-race
    # open http://127.0.0.1:8000

    python -m tests.live_demo single | \
        .venv/bin/llama-benchy-viz-web --mode live-single

    python -m tests.live_demo race-4 --per-token-ms 5 | \
        .venv/bin/llama-benchy-viz-web --mode live-race

By default no ``bench_complete`` is emitted, so the dashboard stays
"live" — pass ``--end`` to finish with a transition into the static
final frame.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from .gen import gen


def main() -> int:
    p = argparse.ArgumentParser(prog="tests.live_demo")
    p.add_argument("scenario", help="single | race-2 | race-4")
    p.add_argument(
        "--per-token-ms", type=float, default=15.0,
        help="real-time gap between token events (default 15)",
    )
    p.add_argument(
        "--inter-request-ms", type=float, default=200.0,
        help="real-time gap after each request_end (default 200)",
    )
    p.add_argument(
        "--end", action="store_true",
        help="emit bench_complete at the end (default: stay live)",
    )
    args = p.parse_args()

    try:
        for ev in gen(args.scenario, in_flight=not args.end):
            sys.stdout.write(json.dumps(ev) + "\n")
            sys.stdout.flush()
            t = ev["type"]
            if t == "tokens":
                time.sleep(args.per_token_ms / 1000.0)
            elif t == "request_end":
                time.sleep(args.inter_request_ms / 1000.0)
            elif t == "request_start":
                time.sleep(0.05)
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
