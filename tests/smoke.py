"""End-to-end smoke test for the web dashboard.

Launches ``llama-benchy-viz-web`` on a random free port against a
synthetic JSONL fixture, connects to ``/sse``, reads one ``view`` frame,
parses the ViewModel payload, and asserts:

  - ``mode`` matches the expected (auto or --mode-forced) value.
  - Every expected ModuleSpec ``kind`` for that mode is present.
  - Layout regions parse as a non-empty tuple.

Covers auto-detection (static-vs-live by ``bench_complete``,
single-vs-race by stream count) plus explicit ``--mode`` overrides.

Usage:
    python -m tests.smoke

Exit code is 0 only when every check passes.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VIZ = REPO / ".venv" / "bin" / "llama-benchy-viz-web"

LANDMARKS: dict[str, list[str]] = {
    "static-single": [
        "header", "summary_strip", "model_metrics_card", "chart",
        "cells_table", "run_metadata", "footer",
    ],
    "static-race": [
        "header", "summary_strip", "stream_grid", "chart",
        "ranking_table", "run_metadata", "footer",
    ],
    "live-single": [
        "header", "summary_strip", "model_metrics_card", "chart",
        "cells_table", "footer",
    ],
    "live-race": [
        "header", "summary_strip", "stream_grid", "chart",
        "ranking_table", "event_log", "footer",
    ],
}


def gen_fixture(scenario: str, out: Path, *, in_flight: bool = False) -> None:
    cmd = [sys.executable, "-m", "tests.gen", scenario, str(out)]
    if in_flight:
        cmd.append("--in-flight")
    subprocess.run(cmd, check=True, cwd=REPO)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_port(port: int, timeout: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def fetch_sse_view(port: int, timeout: float = 6.0) -> dict:
    """Connect to /sse, read exactly one ``event: view`` frame, return the
    parsed JSON payload. Raises if no frame arrives within ``timeout``."""
    url = f"http://127.0.0.1:{port}/sse"
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        deadline = time.monotonic() + timeout
        buffer = ""
        while time.monotonic() < deadline:
            chunk = resp.read(8192)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", errors="replace")
            while "\n\n" in buffer:
                raw_event, buffer = buffer.split("\n\n", 1)
                event_type, data = "", ""
                for line in raw_event.split("\n"):
                    if line.startswith("event: "):
                        event_type = line[7:].strip()
                    elif line.startswith("data: "):
                        data = line[6:]
                if event_type == "view" and data:
                    return json.loads(data)
    raise TimeoutError("no view frame arrived on /sse within timeout")


def run_check(
    label: str,
    fixture: Path,
    expected_mode: str,
    force_mode: str | None = None,
) -> bool:
    port = find_free_port()
    cmd = [str(VIZ), "--port", str(port)]
    if force_mode:
        cmd += ["--mode", force_mode]
    cmd.append(str(fixture))

    proc = subprocess.Popen(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO,
    )
    try:
        if not wait_for_port(port, timeout=8.0):
            print(f"  [FAIL] {label}: server never bound to :{port}")
            return False
        try:
            frame = fetch_sse_view(port, timeout=6.0)
        except Exception as e:
            print(f"  [FAIL] {label}: {type(e).__name__}: {e}")
            return False

        problems = []
        mode = frame.get("mode")
        if mode != expected_mode:
            problems.append(f"mode={mode!r} (want {expected_mode!r})")

        modules = frame.get("modules") or {}
        kinds_present = {m.get("kind") for m in modules.values()}
        missing = [k for k in LANDMARKS[expected_mode] if k not in kinds_present]
        if missing:
            problems.append(f"missing kinds {missing}")

        regions = (frame.get("layout") or {}).get("regions")
        if not isinstance(regions, list) or len(regions) == 0:
            problems.append("layout.regions empty or malformed")

        if problems:
            print(f"  [FAIL] {label}: {' ; '.join(problems)}")
            return False
        print(f"  [PASS] {label}")
        return True
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def main() -> int:
    if not VIZ.exists():
        print(f"ERROR: viz-web not installed at {VIZ}", file=sys.stderr)
        print("Run: uv pip install -e . (from repo root)", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        single_done = d / "single-complete.jsonl"
        single_live = d / "single-inflight.jsonl"
        race2_done = d / "race-2-complete.jsonl"
        race2_live = d / "race-2-inflight.jsonl"

        gen_fixture("single", single_done)
        gen_fixture("single", single_live, in_flight=True)
        gen_fixture("race-2", race2_done)
        gen_fixture("race-2", race2_live, in_flight=True)

        results: list[bool] = []

        print("auto-detect")
        results.append(run_check("static-single  (1 model, complete)",  single_done, "static-single"))
        results.append(run_check("static-race    (2 models, complete)", race2_done,  "static-race"))
        results.append(run_check("live-single    (1 model, in-flight)", single_live, "live-single"))
        results.append(run_check("live-race      (2 models, in-flight)", race2_live, "live-race"))

        print("\n--mode override")
        for mode in ("static-single", "static-race", "live-single", "live-race"):
            fixture = single_done if "single" in mode else race2_done
            results.append(run_check(f"{mode:<14} (forced)", fixture, mode, force_mode=mode))

    total = len(results)
    passed = sum(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
