"""aiohttp server that ingests a llama-benchy JSONL stream and pushes
serialized ``ViewModel`` snapshots to connected browsers over SSE.

Server flow:

    JSONL source (file / stdin)
        └── reader thread → queue.Queue
             └── asyncio broadcast loop (throttled to --fps)
                  ├── drain queue → AppState.ingest(env)
                  ├── snapshot → build_view_model(snap, mode) → JSON
                  └── SSE broadcast to every connected client

One shared ``AppState`` is reused for every client (all tabs see the
same live stream). Connecting mid-stream picks up whatever's already
in the ``AppState``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import queue
import signal
import sys
import time
from pathlib import Path
from typing import Optional, Set

from aiohttp import web

from llama_benchy_viz_tui import SUPPORTED_SCHEMA
from llama_benchy_viz_tui.domain import AppState
from llama_benchy_viz_tui.ingest import EOF_SENTINEL
from llama_benchy_viz_tui.ingest import reader as reader_mod
from llama_benchy_viz_tui.view import DashboardMode, build_view_model, detect
from llama_benchy_viz_tui.view import parse as parse_mode

from . import __version__
from .view_model_json import view_model_to_dict

STATIC_DIR = Path(__file__).parent / "static"


class DashboardServer:
    def __init__(
        self,
        source,
        *,
        name: str,
        mode_override: Optional[DashboardMode],
        fps: float,
        show_events: bool,
        auto_exit: bool,
        hold: int,
    ) -> None:
        self.state = AppState(benchmark_name=name, show_events=show_events)
        self.mode_override = mode_override
        self.fps = fps
        self.auto_exit = auto_exit
        self.hold = hold

        self._q: "queue.Queue" = queue.Queue()
        reader_mod.spawn(source, self._q)

        self._clients: Set[web.StreamResponse] = set()
        self._finished_at: Optional[float] = None
        self._stop = asyncio.Event()

    def _drain_queue(self) -> None:
        while True:
            try:
                item = self._q.get_nowait()
            except queue.Empty:
                return
            if item is EOF_SENTINEL:
                continue
            try:
                self.state.ingest(item)
            except Exception as e:
                print(f"ingest error: {e}", file=sys.stderr)

    def _current_snapshot_payload(self) -> bytes:
        snap = self.state.snapshot()
        mode = self.mode_override if self.mode_override is not None else detect(snap)
        vm = build_view_model(snap, mode)
        payload = json.dumps(view_model_to_dict(vm), separators=(",", ":"))
        return f"event: view\ndata: {payload}\n\n".encode()

    async def _broadcast_frame(self, frame: bytes) -> None:
        dead = []
        for client in list(self._clients):
            try:
                await client.write(frame)
            except (ConnectionResetError, asyncio.CancelledError, RuntimeError):
                dead.append(client)
        for d in dead:
            self._clients.discard(d)

    async def _broadcast_loop(self) -> None:
        period = 1.0 / max(self.fps, 1.0)
        while not self._stop.is_set():
            self._drain_queue()

            if self.state.finished and self._finished_at is None:
                self._finished_at = time.monotonic()

            frame = self._current_snapshot_payload()
            await self._broadcast_frame(frame)

            if (
                self.auto_exit
                and self._finished_at is not None
                and (time.monotonic() - self._finished_at) >= self.hold
            ):
                await self._broadcast_frame(b"event: bye\ndata: {}\n\n")
                self._stop.set()
                # Trigger web.run_app's SIGINT handler so it shuts down.
                os.kill(os.getpid(), signal.SIGINT)
                return

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=period)
            except asyncio.TimeoutError:
                pass

    # ─── HTTP handlers ────────────────────────────────────────────────

    async def sse_handler(self, request: web.Request) -> web.StreamResponse:
        resp = web.StreamResponse(
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
            }
        )
        await resp.prepare(request)
        self._clients.add(resp)
        # Push the current frame immediately so late-joiners aren't blank.
        try:
            await resp.write(self._current_snapshot_payload())
        except Exception:
            self._clients.discard(resp)
            return resp
        try:
            # Idle until the client disconnects. Broadcast writes happen
            # from the broadcast loop, not from here.
            while not self._stop.is_set():
                await asyncio.sleep(3600)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            self._clients.discard(resp)
        return resp

    async def index_handler(self, request: web.Request) -> web.FileResponse:
        return web.FileResponse(STATIC_DIR / "index.html")

    async def static_handler(self, request: web.Request) -> web.Response:
        rel = request.match_info["path"]
        p = (STATIC_DIR / rel).resolve()
        if not str(p).startswith(str(STATIC_DIR.resolve())) or not p.is_file():
            return web.Response(status=404, text="not found")
        return web.FileResponse(p)

    async def info_handler(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "viz_web_version": __version__,
                "supported_schema": SUPPORTED_SCHEMA,
                "fps": self.fps,
                "benchmark_name": self.state.benchmark_name,
                "mode_override": self.mode_override.value if self.mode_override else None,
            }
        )

    # ─── App wiring ──────────────────────────────────────────────────

    def build_app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/", self.index_handler)
        app.router.add_get("/info", self.info_handler)
        app.router.add_get("/sse", self.sse_handler)
        app.router.add_get("/static/{path:.*}", self.static_handler)

        async def _on_startup(app: web.Application) -> None:
            app["broadcast_task"] = asyncio.create_task(self._broadcast_loop())

        async def _on_cleanup(app: web.Application) -> None:
            self._stop.set()
            task = app.get("broadcast_task")
            if task is not None:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

        app.on_startup.append(_on_startup)
        app.on_cleanup.append(_on_cleanup)
        return app


def run(
    *,
    source,
    host: str,
    port: int,
    name: str,
    mode_override: Optional[DashboardMode],
    fps: float,
    show_events: bool,
    auto_exit: bool,
    hold: int,
) -> None:
    server = DashboardServer(
        source,
        name=name,
        mode_override=mode_override,
        fps=fps,
        show_events=show_events,
        auto_exit=auto_exit,
        hold=hold,
    )
    print(f"llama-benchy-viz-web {__version__} — http://{host}:{port}", file=sys.stderr)
    web.run_app(server.build_app(), host=host, port=port, print=None)
