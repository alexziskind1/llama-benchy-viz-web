"""Serialize a ``ViewModel`` (frozen dataclass tree) into a JSON-friendly
dict for transport over Server-Sent Events.

Design:

- The renderer-agnostic ModuleSpec catalog uses frozen dataclasses.
- ``dataclasses.asdict`` almost works, but doesn't touch enum values and
  turns tuples into lists (fine for us).
- We do a small recursive walk so we can normalise enum values, keep
  ``kind`` fields, and add compact wire tweaks (e.g. shorten hex colors).

Consumers on the browser side dispatch on the ``kind`` field of each
ModuleSpec — same way the TUI renderer does.
"""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from enum import Enum
from typing import Any

from llama_benchy_viz_tui.view.compose import ViewModel


def _encode(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, Enum):
        return obj.value
    if is_dataclass(obj):
        return {f.name: _encode(getattr(obj, f.name)) for f in fields(obj)}
    if isinstance(obj, (list, tuple)):
        return [_encode(x) for x in obj]
    if isinstance(obj, dict):
        return {str(k): _encode(v) for k, v in obj.items()}
    # Fall back to string representation for unknown types so we never
    # break the SSE frame with a JSON-unserialisable value.
    return str(obj)


def view_model_to_dict(vm: ViewModel) -> dict:
    """Return the wire-format dict for one ``ViewModel``.

    Structure:

        {
          "mode":    "live-race",
          "layout":  { "mode": "...", "regions": [...], "flex_regions": [...] },
          "modules": { "<module_id>": { "kind": "...", "id": "...", ... }, ... },
          "extras":  { ... }
        }
    """
    return {
        "mode": vm.mode.value,
        "layout": _encode(vm.layout),
        "modules": {mid: _encode(spec) for mid, spec in vm.modules.items()},
        "extras": _encode(vm.extras) if getattr(vm, "extras", None) else {},
    }
