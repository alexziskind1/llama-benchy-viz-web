# Example scripts

Shell wrappers that drive real `llama-benchy` runs against an
OpenAI-compatible endpoint and pipe the JSONL into
`llama-benchy-viz-web`. Same shape as the scripts in
[`llama-benchy-viz-tui/examples/`](https://github.com/alexziskind1/llama-benchy-viz-tui/tree/main/examples)
— the only difference is that these launch the browser dashboard
instead of the terminal one.

Defaults assume LM Studio (or any OpenAI-compatible server) at
`http://localhost:1234/v1` with `qwen/qwen3-4b-2507` loaded. Every
knob is overridable via env vars.

## One dashboard per shape

| Script | Mode | What it does |
|---|---|---|
| `live-single.sh` | live-single | Pipe one model live into the dashboard |
| `live-race.sh` | live-race | Concurrent 2–4 model race, merged via `_merge_benchys.py` |
| `static-single.sh` | static-single | Capture one model to `fixtures/`, then replay |
| `static-race.sh` | static-race | Capture merged multi-model run, then replay (or `--watch` to do both at once) |
| `replay.sh` | (auto) | Replay any saved JSONL through the dashboard, auto-exits 5 s after bench_complete |

## Run one

```bash
# single model
./examples/live-single.sh

# concurrent race (2 models by default; MODEL_C / MODEL_D extend to 3–4)
MODEL_A=foo MODEL_B=bar ./examples/live-race.sh

# replay a fixture your TUI sibling already captured
./examples/replay.sh ../llama-benchy-viz-tui/examples/fixtures/sweep-pp-*.jsonl
```

Open the printed URL (default `http://127.0.0.1:8000`). Multiple
browser tabs can connect at once — the server broadcasts the same
live stream to all of them.

## Env-var knobs

Common to every script:

- `PORT` — HTTP port for the dashboard (default `8000`)
- `BASE_URL` / `BASE_URL_A` / `BASE_URL_B` / … — endpoint(s)
- `MODEL` / `MODEL_A` / `MODEL_B` / … — model name(s)
- `TOKENIZER` / `TOKENIZER_A` / … — HF tokenizer id(s)

## The `_merge_benchys.py` helper

Race scripts spawn N `llama-benchy` processes in parallel. Each
producer numbers its `request_id`s from 0, so a raw concatenation
would collide inside viz-web's request map. The merger:

- Namespaces every producer's `request_id` by a large stride
- Suppresses per-producer `bench_complete`s and emits one synthetic
  event at the very end (across all producers)
- Redirects each producer's stderr to a per-run log file — silent
  failures (broken chat template, unloaded model, unreachable host)
  surface as a summary line after the dashboard exits

## Notes

- Fixtures are git-ignored. Safe to keep around indefinitely.
- Fixtures captured by the TUI's `examples/` scripts are 1:1
  compatible — same schema, same replay path. Point `replay.sh` at
  those files.
- If port `8000` is in use (e.g. a stale viz-web from a prior run),
  either `lsof -ti tcp:8000 | xargs kill` or set `PORT=8001` on any
  script.
