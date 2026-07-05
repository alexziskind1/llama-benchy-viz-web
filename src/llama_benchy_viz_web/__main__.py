"""CLI entry point for llama-benchy-viz-web.

Mirrors ``llama-benchy-viz-tui``'s CLI where it makes sense, plus web-only
knobs (``--host``, ``--port``). Auto-detection of the dashboard mode is
identical to the TUI — same domain + view layers are running underneath.
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from llama_benchy_viz_tui import SUPPORTED_SCHEMA
from llama_benchy_viz_tui.ingest import reader as reader_mod
from llama_benchy_viz_tui.view import DashboardMode
from llama_benchy_viz_tui.view import parse as parse_mode

from . import __version__
from .server import run as run_server

DEFAULT_FPS = 8.0
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="llama-benchy-viz-web",
        description=(
            "Web dashboard for llama-benchy benchmarks. Consumes the "
            f"--emit-progress JSONL stream (schema: {SUPPORTED_SCHEMA}) and "
            "serves a live browser dashboard via Server-Sent Events."
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "path", nargs="?", default="-", metavar="PATH",
        help="JSONL file to tail-follow, or '-' / omitted to read stdin.",
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"bind address (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"HTTP port (default: {DEFAULT_PORT})")
    parser.add_argument("--name", default="benchmark", help="header label (default: 'benchmark')")
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS, help=f"broadcast frequency (default: {DEFAULT_FPS})")
    parser.add_argument(
        "--auto-exit", action="store_true",
        help="exit --hold seconds after bench_complete.",
    )
    parser.add_argument("--hold", type=int, default=10, help="seconds to hold final frame with --auto-exit (default: 10)")
    parser.add_argument("--show-events", action="store_true", help="always show the events panel.")
    parser.add_argument(
        "--mode", default=None,
        choices=[m.value for m in DashboardMode],
        help="dashboard mode (auto-detected when omitted).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    source = reader_mod.make_source(args.path)
    mode_override = parse_mode(args.mode) if args.mode else None
    try:
        run_server(
            source=source,
            host=args.host,
            port=args.port,
            name=args.name,
            mode_override=mode_override,
            fps=args.fps,
            show_events=args.show_events,
            auto_exit=args.auto_exit,
            hold=args.hold,
        )
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
