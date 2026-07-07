"""Synthetic JSONL fixture generator for llama-benchy-viz-tui smoke tests.

Produces deterministic event streams that match the
``llama-benchy-progress.v1`` schema, without needing a real LLM endpoint.

CLI:
    python -m tests.gen single  OUT.jsonl
    python -m tests.gen race-2  OUT.jsonl
    python -m tests.gen race-4  OUT.jsonl
    python -m tests.gen race-2  -          # stdout
    python -m tests.gen race-2  OUT.jsonl --in-flight
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Iterator

SCHEMA = "llama-benchy-progress.v1"

PP_GRID = [256, 1024, 4096]
TG_GRID = [32, 128]

MODEL_PROFILES = {
    "single": [("qwen-4b", "http://a", 180.0)],
    "race-2": [
        ("fast", "http://a", 200.0),
        ("slow", "http://b", 100.0),
    ],
    "race-4": [
        ("alpha", "http://a", 200.0),
        ("beta",  "http://b", 150.0),
        ("gamma", "http://c", 120.0),
        ("delta", "http://d",  90.0),
    ],
}


def gen(scenario: str, in_flight: bool = False) -> Iterator[dict]:
    """Yield envelopes for one synthetic benchmark.

    ``in_flight=True`` omits the final ``bench_complete`` so auto-detect
    classifies the run as live rather than static.
    """
    if scenario not in MODEL_PROFILES:
        raise ValueError(f"unknown scenario: {scenario!r}")

    yield {
        "schema": SCHEMA, "type": "header", "ts": 1000.0,
        "llama_benchy_version": "0.3.8",
    }

    rid = 0
    t = 1000.0
    for model, base_url, decode_tps in MODEL_PROFILES[scenario]:
        for pp in PP_GRID:
            for tg in TG_GRID:
                yield {
                    "schema": SCHEMA, "type": "request_start", "ts": t,
                    "request_id": rid, "model": model, "base_url": base_url,
                    "prompt_size": pp, "response_size": tg,
                    "context_size": 0, "concurrency": 1, "run_index": 0,
                }
                ttft = pp / 2000.0
                yield {
                    "schema": SCHEMA, "type": "request_first_token",
                    "ts": t + ttft, "request_id": rid, "ttft_s": ttft,
                }
                step = 1.0 / decode_tps
                for i in range(tg):
                    yield {
                        "schema": SCHEMA, "type": "tokens",
                        "ts": t + ttft + i * step,
                        "request_id": rid, "count": 1,
                    }
                decode_s = tg * step
                yield {
                    "schema": SCHEMA, "type": "request_end",
                    "ts": t + ttft + decode_s, "request_id": rid,
                    "total_tokens": tg, "prompt_tokens": pp,
                    "decode_seconds": decode_s,
                }
                rid += 1
                t += ttft + decode_s + 0.05

    if not in_flight:
        yield {"schema": SCHEMA, "type": "bench_complete", "ts": t}


def main() -> int:
    p = argparse.ArgumentParser(prog="tests.gen")
    p.add_argument("scenario", choices=list(MODEL_PROFILES))
    p.add_argument("out", help="output path, or '-' for stdout")
    p.add_argument(
        "--in-flight", action="store_true",
        help="omit bench_complete (auto-detect picks a live mode)",
    )
    args = p.parse_args()

    if args.out == "-":
        f = sys.stdout
        close = False
    else:
        f = open(args.out, "w", encoding="utf-8")
        close = True
    try:
        for ev in gen(args.scenario, in_flight=args.in_flight):
            f.write(json.dumps(ev) + "\n")
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except BrokenPipeError:
            pass
    finally:
        if close:
            f.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
