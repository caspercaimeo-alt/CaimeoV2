"""
Auto-trading loop for CAIMEO.
Reads discovered symbols, sizes trades by fixed % risk, and places Alpaca bracket orders.
Controlled by the server start/stop (threading.Event) rather than env flags.
"""

import json
import math
import os
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

try:
    from alpaca_trade_api.rest import REST, APIError
except Exception:  # alpaca may be missing in some envs
    REST = None  # type: ignore
    APIError = Exception  # type: ignore

import trade_logger


LOG_FILE = os.getenv("LOG_FILE", "bot_output.log")
DISCOVERED_FILE = os.getenv("DISCOVERED_FILE", "discovered_full.json")
BASE_URL = os.getenv("APCA_API_BASE_URL", "https://paper-api.alpaca.markets")
TRADE_POLL_SEC = int(os.getenv("TRADE_POLL_SEC", "60"))
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS", "3"))
MIN_TRADE_CONFIDENCE = os.getenv("MIN_TRADE_CONFIDENCE", "B").upper()
RISK_PER_TRADE_PCT = float(os.getenv("RISK_PER_TRADE_PCT", "1.0"))  # % of equity
STOP_LOSS_PCT = float(os.getenv("STOP_LOSS_PCT", "3.0"))
TRAIL_STOP_PCT = float(os.getenv("TRAIL_STOP_PCT", "6.0"))  # trailing exit for attached stops
MAX_DAY_TRADES_PER_WEEK = int(os.getenv("MAX_DAY_TRADES_PER_WEEK", "65"))
ENTRY_SLIPPAGE_PCT = float(os.getenv("ENTRY_SLIPPAGE_PCT", "0.3"))  # % above last price for limit
MINUTES_AFTER_OPEN = int(os.getenv("MINUTES_AFTER_OPEN", "15"))  # wait N minutes after market open
ALLOW_AFTER_HOURS = os.getenv("ALLOW_AFTER_HOURS", "false").lower() == "true"

# Symbols that already have protective exits attached in this session
ATTACHED_EXITS = set()


def _log(msg: str) -> None:
    """Append a log line to bot_output.log and stdout."""
    ts = time.strftime("[%Y-%m-%d %H:%M:%S]")
    line = f"{ts} {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", buffering=1) as f:
            f.write(line + "\n")
    except Exception:
        pass


def _confidence_ok(value) -> bool:
    """Return True if confidence meets the configured minimum."""
    if value is None:
        return False
    if isinstance(value, str):
        letter = value.strip().upper()
    elif isinstance(value, (int, float)):
        if value >= 0.75:
            letter = "A"
        elif value >= 0.55:
            letter = "B"
        elif value >= 0.35:
            letter = "C"
        else:
            letter = "F"
    else:
        return False

    order = ["A", "B", "C", "D", "F"]
    try:
        return order.index(letter) <= order.index(MIN_TRADE_CONFIDENCE)
    except ValueError:
        return False


def _load_discovered(path: str) -> List[Dict]:
    """Load discovered symbols from JSON file; supports dict or list payloads."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except Exception as e:
        _log(f"⚠️ Failed to read discovered file {path}: {e}")
        return []

    if isinstance(data, dict):
        symbols = data.get("symbols", [])
    elif isinstance(data, list):
        symbols = data
    else:
        symbols = []

    cleaned = []
    for row in symbols:
        if not isinstance(row, dict):
            continue
        sym = row.get("symbol")
        price = row.get("last_price") or row.get("last")
        conf = row.get("confidence")
        if not sym or price is None:
            continue
        if not _confidence_ok(conf):
            continue
        cleaned.append(
            {
                "symbol": sym,
                "price": float(price),
                "confidence": conf,
                "score": row.get("score", 0),
                "strategy": row.get("strategy"),
            }
        )

    cleaned.sort(key=lambda x: x.get("score", 0), reverse=True)
    return cleaned


def _init_api(key: str, secret: str, base_url: str) -> Optional[REST]:
    if REST is None:
        _log("⚠️ alpaca-trade-api not installed; auto-trading disabled.")
        return None
    try:
        api = REST(key, secret, base_url, api_version="v2")
        _ = api.get_account()
        _log("✅ Alpaca trading client initialized.")
        return api
    except Exception as e:
        _log(f"❌ Failed to authenticate Alpaca API: {e}")
        return None


def _current_state(api: REST) -> Tuple[float, List[str], List[str], List]:
    """Return (equity, open_position_symbols, open_order_symbols, position_objects)."""
    acct = api.get_account()
    equity = float(getattr(acct, "equity", 0))
    position_objs = api.list_positions() if hasattr(api, "list_positions") else []
    positions = [p.symbol for p in position_objs]
    orders = [o.symbol for o in api.list_orders(status="open")] if hasattr(api, "list_orders") else []
    return equity, positions, orders, position_objs


def _calc_qty(last_price: float, equity: float) -> int:
    """Position size using fixed risk per trade and stop distance."""
    if last_price <= 0 or equity <= 0:
        return 0
    per_share_risk = last_price * (STOP_LOSS_PCT / 100)
    allowed_risk = equity * (RISK_PER_TRADE_PCT / 100)
    if per_share_risk <= 0:
        return 0
    qty = math.floor(allowed_risk / per_share_risk)
    return max(qty, 1) if qty > 0 else 0


def _submit_bracket(api: REST, symbol: str, last_price: float, qty: int, strategy: Optional[str]) -> bool:
    """
    Place a market buy, then a separate trailing-stop sell to let spikes run.
    Using two orders avoids Alpaca OTO validation on missing stop_price.
    """
    trail_pct = TRAIL_STOP_PCT
    try:
        limit_price = round(last_price * (1 + ENTRY_SLIPPAGE_PCT / 100), 2)
        api.submit_order(
            symbol=symbol,
            side="buy",
            type="limit",
            qty=qty,
            limit_price=limit_price,
            time_in_force="day",
        )
        _log(
            f"🟢 Limit buy {symbol} qty={qty} @<= {limit_price} (last={last_price}) "
            f"with trailing exit {trail_pct}%"
        )

        # Submit a separate trailing-stop sell so profits can run.
        api.submit_order(
            symbol=symbol,
            side="sell",
            type="trailing_stop",
            qty=qty,
            trail_percent=trail_pct,
            time_in_force="gtc",
        )
        trade_logger.append_event(
            {
                "event": "entry_submitted",
                "symbol": symbol,
                "strategy": strategy,
                "price": last_price,
                "qty": qty,
                "take_profit": None,
                "stop_loss": None,
                "trail_percent": trail_pct,
            }
        )
        return True
    except APIError as e:
        _log(f"⚠️ Alpaca API error placing {symbol}: {e}")
    except Exception as e:
        _log(f"⚠️ Unexpected error placing {symbol}: {e}")
    return False


def _attach_exit_orders(api: REST, positions: List, open_order_symbols: List[str]) -> None:
    """
    For any existing position lacking an open order, attach a trailing-stop exit
    so legacy holdings get protection even if the bot did not open them.
    """
    global ATTACHED_EXITS
    for pos in positions:
        sym = getattr(pos, "symbol", None)
        if not sym:
            continue
        if sym in open_order_symbols or sym in ATTACHED_EXITS:
            continue

        try:
            qty_raw = getattr(pos, "qty", None)
            qty = abs(int(float(qty_raw))) if qty_raw is not None else 0
        except Exception:
            qty = 0
        if qty <= 0:
            continue

        side = "sell" if float(getattr(pos, "qty", 0)) >= 0 else "buy"
        trail_pct = TRAIL_STOP_PCT

        try:
            api.submit_order(
                symbol=sym,
                side=side,
                type="trailing_stop",
                qty=qty,
                trail_percent=trail_pct,
                time_in_force="gtc",
            )
            ATTACHED_EXITS.add(sym)
            _log(f"🛡️ Attached trailing stop for existing position {sym} qty={qty} trail={trail_pct}%")
            trade_logger.append_event(
                {
                    "event": "exit_attached",
                    "symbol": sym,
                    "qty": qty,
                    "trail_percent": trail_pct,
                }
            )
        except APIError as e:
            _log(f"⚠️ Alpaca API error attaching exit for {sym}: {e}")
        except Exception as e:
            _log(f"⚠️ Unexpected error attaching exit for {sym}: {e}")


def _count_entries_this_week(path: str) -> int:
    """Count trade entries in the current ISO week from trade_events.jsonl."""
    if not os.path.exists(path):
        return 0
    try:
        now = datetime.now(timezone.utc)
        iso_year, iso_week, _ = now.isocalendar()
        count = 0
        with open(path, "r") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    ts = rec.get("ts")
                    if not ts:
                        continue
                    dt = datetime.fromisoformat(ts).astimezone(timezone.utc)
                    y, w, _ = dt.isocalendar()
                    if y == iso_year and w == iso_week and rec.get("event") == "entry_submitted":
                        count += 1
                except Exception:
                    continue
        return count
    except Exception:
        return 0


def _market_ready(api: REST) -> bool:
    """Return True if market is open and past the post-open delay."""
    try:
        clock = api.get_clock()
        if ALLOW_AFTER_HOURS:
            return True

        if not getattr(clock, "is_open", False):
            return False
        now = datetime.now(timezone.utc)
        open_time_str = getattr(clock, "last_open", None) or getattr(clock, "next_open", None)
        if open_time_str:
            open_time = datetime.fromisoformat(str(open_time_str)).astimezone(timezone.utc)
            if (now - open_time).total_seconds() < MINUTES_AFTER_OPEN * 60:
                return False
        return True
    except Exception:
        return True


def run(stop_event, api_key: str, api_secret: str, base_url: str = BASE_URL) -> None:
    """Blocking trading loop; meant to run inside a daemon thread."""
    api = _init_api(api_key, api_secret, base_url)
    if api is None:
        return

    _log(
        f"🤖 Auto-trader running | poll={TRADE_POLL_SEC}s | min_conf={MIN_TRADE_CONFIDENCE} | "
        f"max_pos={MAX_POSITIONS} | risk={RISK_PER_TRADE_PCT}% | "
        f"size_sl={STOP_LOSS_PCT}% trail_stop={TRAIL_STOP_PCT}%"
    )

    while not stop_event.is_set():
        try:
            symbols = _load_discovered(DISCOVERED_FILE)
            if not symbols:
                _log("⏸ No trade candidates (empty discovery list).")
                time.sleep(TRADE_POLL_SEC)
                continue

            # Day-trade cap guardrail (per calendar ISO week)
            week_entries = _count_entries_this_week(trade_logger.TRADE_EVENTS_LOG)
            if week_entries >= MAX_DAY_TRADES_PER_WEEK:
                _log(f"⏸ Day-trade cap reached ({week_entries}/{MAX_DAY_TRADES_PER_WEEK} this week).")
                time.sleep(TRADE_POLL_SEC)
                continue

            equity, positions, open_orders, position_objs = _current_state(api)

            # Always try to attach exits even if we're waiting for market open.
            try:
                to_remove = set(ATTACHED_EXITS) - set(positions)
                for sym in to_remove:
                    ATTACHED_EXITS.discard(sym)
                _attach_exit_orders(api, position_objs, open_orders)
            except Exception as e:
                _log(f"⚠️ Exit attachment step failed: {e}")

            if not _market_ready(api):
                _log(f"⏸ Waiting for market + {MINUTES_AFTER_OPEN}m post-open window before entries.")
                time.sleep(TRADE_POLL_SEC)
                continue

            active_count = len(positions) + len(open_orders)
            slots = max(0, MAX_POSITIONS - active_count)
            if slots <= 0:
                _log("⏸ Position cap reached; waiting for slots to free up.")
                time.sleep(TRADE_POLL_SEC)
                continue

            placed = 0
            for row in symbols:
                if stop_event.is_set() or placed >= slots:
                    break
                sym = row["symbol"]
                price = row["price"]

                if sym in positions or sym in open_orders:
                    continue

                qty = _calc_qty(price, equity)
                if qty <= 0:
                    _log(f"⚠️ Skipping {sym}: could not size position (price={price}, equity={equity}).")
                    continue

                if _submit_bracket(api, sym, price, qty, row.get("strategy")):
                    placed += 1

            if placed == 0:
                _log("⏸ No trade action this cycle.")

        except Exception as e:
            _log(f"❌ Trading loop error: {e}")

        time.sleep(TRADE_POLL_SEC)

    _log("🟥 Auto-trader stopped.")
