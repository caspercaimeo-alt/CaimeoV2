"""
Shared event logger for discovery/trading.
Writes JSON lines to a single file to keep storage minimal.
"""

import json
import os
import time
from typing import Dict, Any

TRADE_EVENTS_LOG = os.getenv("TRADE_EVENTS_LOG", "trade_events.jsonl")


def append_event(payload: Dict[str, Any], path: str = None) -> None:
    """Append one JSON line; best-effort (never raises)."""
    log_path = path or TRADE_EVENTS_LOG
    try:
        record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), **payload}
        with open(log_path, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass
