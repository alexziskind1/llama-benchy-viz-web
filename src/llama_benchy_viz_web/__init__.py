"""Web dashboard for llama-benchy benchmark runs.

Reuses the domain + view layers from ``llama-benchy-viz-tui`` and adds a
Server-Sent Events adapter that pushes ``ViewModel`` snapshots to browser
clients.
"""

__version__ = "0.1.0"
