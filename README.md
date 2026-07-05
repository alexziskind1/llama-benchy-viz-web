# llama-benchy-viz-web

Web dashboard for [llama-benchy](https://github.com/eugr/llama-benchy)
benchmark runs. Consumes the `--emit-progress` JSONL stream and pushes
live ViewModel snapshots over Server-Sent Events to a browser dashboard.

Sister project to the terminal version:
[`llama-benchy-viz-tui`](https://github.com/alexziskind1/llama-benchy-viz-tui).
Both share the same domain and view layers — the web renderer is just
a different adapter at the ViewModel boundary.

The dashboard auto-adapts to four modes (same as the TUI):

|             | one model      | 2-4 models       |
|-------------|----------------|------------------|
| **live**    | `live-single`  | `live-race`      |
| **static**  | `static-single`| `static-race`    |

## Schema

Consumes the
[`llama-benchy-progress.v1`](https://github.com/eugr/llama-benchy/blob/main/docs/progress-schema.md)
JSONL stream produced by `llama-benchy --emit-progress`.

## Install

The web viz depends on the TUI viz for its `ingest` / `domain` / `view`
layers. With `uv` (recommended), the sibling path is resolved via
`[tool.uv.sources]`:

```bash
uv venv
uv pip install -e .
source .venv/bin/activate
```

With plain `pip`, install the sibling first:

```bash
python -m venv .venv
.venv/bin/pip install -e ../llama-benchy-viz-tui
.venv/bin/pip install -e .
source .venv/bin/activate
```

## Use

```bash
# Tail-follow a JSONL file that llama-benchy is writing
llama-benchy-viz-web /tmp/progress.jsonl
# open http://127.0.0.1:8000

# Pipe straight from a live benchmark
llama-benchy --emit-progress - --base-url http://localhost:1234/v1 --model … \
  | llama-benchy-viz-web

# Replay a finished JSONL fixture with auto-exit
llama-benchy-viz-web --auto-exit /tmp/progress.jsonl

# Force a specific mode
llama-benchy-viz-web --mode live-race /tmp/progress.jsonl
```

Open the printed URL in a browser. Multiple browser tabs can connect
simultaneously and receive the same live stream.

## Flags

- `[PATH]` — JSONL path or `-` / omitted for stdin.
- `--host HOST` — bind address (default: `127.0.0.1`).
- `--port PORT` — HTTP port (default: `8000`).
- `--mode {static-single,static-race,live-single,live-race}` — override
  the auto-detected mode.
- `--auto-exit` — exit `--hold N` seconds after `bench_complete`.
- `--hold N` — with `--auto-exit`: seconds to hold the final frame (default: 10).
- `--name NAME` — header label (default: `benchmark`).
- `--fps HZ` — server-side broadcast frequency (default: 8).
- `--show-events` — include the rolling events panel even when uninteresting.

## Architecture

Two-layer split:

```
Python side (server.py)
   └── ingest → domain → view      (reused from llama-benchy-viz-tui)
        └── ViewModel → JSON       (view_model_json.py)
             └── SSE broadcast     (aiohttp)

Browser side (static/*.js)
   └── EventSource → render()      (vanilla ES modules)
        └── layout + module renderers
             └── uPlot for charts
```

The Python view layer runs on the server; the browser is a pure
renderer that consumes serialized ModuleSpecs.

## License

MIT — see [LICENSE](LICENSE).
