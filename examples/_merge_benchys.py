"""Run N llama-benchy producers concurrently, merge their JSONL output.

Each producer is a single shell command (parsed with shlex). This helper
namespaces every producer's ``request_id`` field with a stride offset so
overlapping ids from independent llama-benchy processes don't collide
inside viz-tui's request map. Per-producer ``bench_complete`` events are
suppressed; one synthetic ``bench_complete`` is emitted after ALL
producers exit.

Used by examples/live-race.sh and examples/static-race.sh — invoke
directly only if you want a different multi-model topology.

    python _merge_benchys.py \\
        --producer "llama-benchy --base-url … --model A --emit-progress -" \\
        --producer "llama-benchy --base-url … --model B --emit-progress -" \\
        > merged.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time
from typing import IO

REQUEST_ID_STRIDE = 1_000_000_000


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--producer", action="append", required=True,
        help="producer cmdline (repeat for each model)",
    )
    p.add_argument(
        "--log-dir", default=None,
        help="directory for per-producer stderr logs (default: a tempdir)",
    )
    args = p.parse_args()

    log_dir = args.log_dir or tempfile.mkdtemp(prefix="merge-benchys-")
    os.makedirs(log_dir, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")

    procs: list[subprocess.Popen | None] = []
    log_paths: list[str] = []
    spawn_errors: list[str | None] = []
    for i, cmd in enumerate(args.producer):
        log_path = os.path.join(log_dir, f"producer-{i}-{ts}.log")
        log_paths.append(log_path)
        log_fh = open(log_path, "w", encoding="utf-8")
        log_fh.write(f"# {cmd}\n")
        log_fh.flush()
        try:
            procs.append(subprocess.Popen(
                shlex.split(cmd),
                stdout=subprocess.PIPE,
                stderr=log_fh,
                bufsize=1,
                text=True,
            ))
            spawn_errors.append(None)
        except (FileNotFoundError, PermissionError) as e:
            log_fh.write(f"spawn failed: {e}\n")
            log_fh.close()
            procs.append(None)
            spawn_errors.append(str(e))

    out: IO[str] = sys.stdout
    write_lock = threading.Lock()
    last_ts = [0.0]
    pipe_broken = threading.Event()

    def pump(idx: int, proc: subprocess.Popen) -> None:
        offset = idx * REQUEST_ID_STRIDE
        assert proc.stdout is not None
        for line in proc.stdout:
            if pipe_broken.is_set():
                break
            line = line.rstrip("\n")
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(ev.get("ts"), (int, float)):
                last_ts[0] = max(last_ts[0], float(ev["ts"]))
            if ev.get("type") == "bench_complete":
                continue
            if isinstance(ev.get("request_id"), int):
                ev["request_id"] += offset
            with write_lock:
                try:
                    out.write(json.dumps(ev) + "\n")
                    out.flush()
                except BrokenPipeError:
                    pipe_broken.set()
                    return

    threads = [
        threading.Thread(target=pump, args=(i, p), daemon=True)
        for i, p in enumerate(procs) if p is not None
    ]
    for t in threads:
        t.start()

    rc = 0
    try:
        for proc in procs:
            if proc is not None:
                proc.wait()
        for t in threads:
            t.join(timeout=2.0)
    except KeyboardInterrupt:
        rc = 130
    finally:
        if rc == 130 or pipe_broken.is_set():
            for proc in procs:
                if proc is not None and proc.poll() is None:
                    proc.send_signal(signal.SIGINT)
            for proc in procs:
                if proc is None:
                    continue
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        if not pipe_broken.is_set():
            with write_lock:
                try:
                    out.write(json.dumps({
                        "schema": "llama-benchy-progress.v1",
                        "type": "bench_complete",
                        "ts": last_ts[0],
                    }) + "\n")
                    out.flush()
                except BrokenPipeError:
                    pass

    # Post-run summary on the real terminal (after viz-tui has restored
    # the main screen). Highlights producers that exited nonzero so
    # silent failures stop being silent.
    print("\nproducer summary:", file=sys.stderr)
    any_failed = False
    for i, (proc, log_path, spawn_err) in enumerate(
        zip(procs, log_paths, spawn_errors)
    ):
        if spawn_err is not None:
            tag = f"SPAWN-FAILED ({spawn_err})"
            any_failed = True
        else:
            assert proc is not None
            ec = proc.returncode
            tag = "ok" if ec == 0 else f"FAILED (exit {ec})"
            if ec != 0:
                any_failed = True
        print(f"  [{i}] {tag:<24} stderr → {log_path}", file=sys.stderr)
    if any_failed:
        print(
            "\nOne or more producers failed — check the log path(s) above.",
            file=sys.stderr,
        )

    return rc


if __name__ == "__main__":
    raise SystemExit(main())
