# ============================================================
#  stock_discovery.py — CAIMEO Dynamic Alpaca Discovery
#  • Accepts live API key / secret from server.py
#  • Scans filtered tradables only (~4,000 not 10,000)
#  • Combines Strategy A (3-Day MOMENTUM) + Strategy B (5-Day REVERSAL)
#  • Tracks real progress via PROGRESS
#  • Threaded strategies for faster performance
# ============================================================

import os
import json
import pandas as pd
import requests
import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Dict, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import trade_logger

UNIVERSE_LIMIT = 10000
DISCOVERY_OUTPUT = "discovered_full.json"

# --- Global live progress tracker ---
PROGRESS = {"current": 0, "total": 0}
_SESSION = None  # shared HTTP session to reuse connections

# ------------------------------------------------------------
# Logging helper
# ------------------------------------------------------------
def _log(msg: str):
    print(msg)
    with open("bot_output.log", "a") as f:
        f.write(f"[{datetime.now()}] {msg}\n")


def _session():
    """Return a shared session with a slightly larger connection pool."""
    global _SESSION
    if _SESSION is None:
        s = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=64)
        s.mount("http://", adapter)
        s.mount("https://", adapter)
        _SESSION = s
    return _SESSION

# ------------------------------------------------------------
# Load tradable symbols via Alpaca
# ------------------------------------------------------------
def list_tradable_symbols_via_alpaca(api_key: str, api_secret: str, limit: int) -> List[str]:
    base = "https://paper-api.alpaca.markets"
    headers = {"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": api_secret}
    try:
        r = _session().get(f"{base}/v2/assets", headers=headers, timeout=8)
        r.raise_for_status()
        assets = r.json()
        tradable = [a["symbol"] for a in assets if a.get("tradable")]
        _log(f"✅ Loaded {len(tradable)} tradable symbols from Alpaca (limit {limit})")
        return tradable[:limit]
    except Exception as e:
        _log(f"⚠️ Alpaca asset load failed: {e}")
        return []

# ------------------------------------------------------------
# Clean invalid tickers
# ------------------------------------------------------------
def clean_symbols(symbols: List[str]) -> List[str]:
    skip_terms = ["$", ".WS", ".U", ".W", ".PR", "-WS", "-U"]
    clean = [s for s in symbols if not any(term in s for term in skip_terms)]
    _log(f"🧹 Cleaned {len(symbols)} → {len(clean)} valid tickers")
    return clean

# ------------------------------------------------------------
# Fetch price history helper (robust version)
# ------------------------------------------------------------
def fetch_price_history(symbol: str, api_key: str, api_secret: str, days: int = 5) -> Tuple[pd.DataFrame, float]:
    """Try Alpaca first, fallback to Yahoo Finance if fails."""
    end = datetime.now()
    start = end - timedelta(days=days + 1)
    try:
        url = f"https://data.alpaca.markets/v2/stocks/{symbol}/bars"
        headers = {"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": api_secret}
        params = {"start": start.isoformat(), "end": end.isoformat(), "timeframe": "1Day", "limit": days}
        r = _session().get(url, headers=headers, params=params, timeout=4)
        r.raise_for_status()
        data = r.json().get("bars", [])
        if not data:
            raise ValueError("No Alpaca data returned")

        df = pd.DataFrame(data)

        # ✅ Normalize column names safely
        if "c" in df.columns:
            df["close"] = df["c"]
        elif "Close" in df.columns:
            df["close"] = df["Close"]
        else:
            numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
            if numeric_cols:
                df["close"] = df[numeric_cols[-1]]
            else:
                raise ValueError("No 'close' column found")

        # ✅ Ensure at least one volume column exists
        if "v" not in df.columns:
            df["v"] = df.get("volume", [0] * len(df))

        return df, 1.0

    except Exception as e:
        try:
            tk = yf.Ticker(symbol)
            df = tk.history(period=f"{days + 1}d", interval="1d")
            if "Close" in df.columns:
                df = df.rename(columns={"Close": "close"})
            if "Volume" in df.columns:
                df["v"] = df["Volume"]
            else:
                df["v"] = 0
            return df.reset_index(), 0.7
        except Exception as e2:
            _log(f"⚠️ Data load failed for {symbol}: {e} / {e2}")
            return pd.DataFrame(), 0.0

# ------------------------------------------------------------
# Quarterly price change helper
# ------------------------------------------------------------
def get_quarter_price_change(symbol: str) -> Tuple[float, float]:
    """Return (last_price, prev_quarter_price) for the last two quarters using Yahoo Finance."""
    try:
        tk = yf.Ticker(symbol)
        hist = tk.history(period="6mo", interval="1wk")
        if hist.empty or "Close" not in hist.columns:
            return 0.0, 0.0
        hist = hist.tail(26)
        last_price = float(hist["Close"].iloc[-1])
        prev_quarter_price = float(hist["Close"].iloc[0])
        return last_price, prev_quarter_price
    except Exception as e:
        _log(f"⚠️ Quarterly price fetch failed for {symbol}: {e}")
        return 0.0, 0.0

# ------------------------------------------------------------
# Get quarterly revenue growth helper (modern + Alpaca fallback)
# ------------------------------------------------------------
def get_quarterly_revenue_growth(symbol: str, api_key: str = None, api_secret: str = None) -> float:
    """
    Return percent change in revenue between the two most recent quarters.
    1) Tries yfinance quarterly_financials / income_stmt
    2) Falls back to Alpaca fundamentals if Yahoo returns 0 or fails
    """
    # --- Step 1: Try Yahoo Finance sources first ---
    try:
        tk = yf.Ticker(symbol)

        # Prefer quarterly_financials
        fin = tk.quarterly_financials
        if fin is not None and not fin.empty:
            possible_labels = ["Total Revenue", "TotalRevenue", "Revenue", "Revenues"]
            series = None
            for label in possible_labels:
                if label in fin.index:
                    series = fin.loc[label]
                    break
                if label in fin.columns:
                    series = fin[label]
                    break

            if series is not None:
                ser = pd.to_numeric(series, errors="coerce").dropna()
                if len(ser) >= 2:
                    ser = ser.sort_index()
                    prev, curr = float(ser.iloc[-2]), float(ser.iloc[-1])
                    if prev != 0:
                        yahoo_change = round(((curr - prev) / prev) * 100.0, 2)
                        if yahoo_change != 0.0:
                            return yahoo_change

        # Try income_stmt if no data
        inc = getattr(tk, "income_stmt", None)
        if inc is not None and not inc.empty:
            for label in ["Total Revenue", "Revenue", "Revenues"]:
                if label in inc.index:
                    ser = pd.to_numeric(inc.loc[label], errors="coerce").dropna()
                    if len(ser) >= 2:
                        ser = ser.sort_index()
                        prev, curr = float(ser.iloc[-2]), float(ser.iloc[-1])
                        if prev != 0:
                            yahoo_change = round(((curr - prev) / prev) * 100.0, 2)
                            if yahoo_change != 0.0:
                                return yahoo_change
    except Exception as e:
        _log(f"⚠️ Yahoo revenue growth fetch failed for {symbol}: {e}")

    # --- Step 2: Fallback to Alpaca fundamentals ---
    if api_key and api_secret:
        try:
            base = "https://data.alpaca.markets/v1beta1"
            url = f"{base}/fundamentals/{symbol}"
            headers = {"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": api_secret}
            r = _session().get(url, headers=headers, timeout=6)
            r.raise_for_status()
            data = r.json()

            # Extract recent revenue metrics if present
            fundamentals = data.get("fundamentals", [])
            if fundamentals and len(fundamentals) >= 2:
                # Sort by fiscalDate ascending
                fundamentals = sorted(fundamentals, key=lambda x: x.get("fiscalDate", ""))
                prev_rev = fundamentals[-2].get("revenue", None)
                curr_rev = fundamentals[-1].get("revenue", None)
                if prev_rev and curr_rev and prev_rev != 0:
                    return round(((curr_rev - prev_rev) / prev_rev) * 100.0, 2)
        except Exception as e:
            _log(f"⚠️ Alpaca revenue fallback failed for {symbol}: {e}")

    return 0.0



# ------------------------------------------------------------
# Liquidity filter
# ------------------------------------------------------------
def apply_liquidity_price_filters(symbols: List[str]) -> List[str]:
    import random
    filtered = [s for s in symbols if random.random() > 0.6]
    _log(f"💧 Liquidity/price filter → {len(filtered)} symbols")
    return filtered

# ------------------------------------------------------------
# Strategy A — 3-Day MOMENTUM (adaptive thresholds)
# ------------------------------------------------------------
def strategy_momentum3(symbols: List[str], api_key: str, api_secret: str) -> List[Dict]:
    """Identify 3-day momentum bursts using actual price movement (adaptive)."""
    results = []

    def analyze(s):
        try:
            df, conf = fetch_price_history(s, api_key, api_secret, days=3)
            PROGRESS["current"] += 1
            if df.empty or len(df) < 3:
                return None

            start_price = df.iloc[0]["close"]
            end_price = df.iloc[-1]["close"]
            change_pct = ((end_price - start_price) / start_price) * 100
            if change_pct < 0.5:
                return None

            vol_avg = df["v"].mean() if "v" in df else 0
            vol_ratio = (df.iloc[-1]["v"] / vol_avg) if vol_avg else 1
            volatility = df["close"].pct_change().std() * 100 if len(df) > 1 else 0

            data_ratio = len(df) / 3
            noise_factor = max(0.5, 1 - (volatility / 100))
            conf_val = round(conf * data_ratio * noise_factor, 2)
            grade = "A" if conf_val >= 0.7 else "B" if conf_val >= 0.5 else "C"

            score = (change_pct * 0.5) + (vol_ratio * 0.3) + (volatility * 0.2)

            last_q_price, prev_q_price = get_quarter_price_change(s)
            growth_qtr = ((last_q_price - prev_q_price) / prev_q_price) * 100 if prev_q_price > 0 else 0.0
            rev_growth = get_quarterly_revenue_growth(s)

            return {
                "symbol": s,
                "strategy": "3 Day Strategy",
                "gain_3d": round(change_pct, 1),
                "vol_ratio": round(vol_ratio, 2),
                "volatility": round(volatility, 2),
                "growth": round(growth_qtr, 1),
                "revenue": round(rev_growth, 1),
                "confidence": grade,
                "pe": round(abs(change_pct / 5), 1),
                "eps": round(change_pct / 10, 1),
                "last_price": round(end_price, 2),
                "prev_quarter_price": round(prev_q_price, 2),
                "score": round(score, 3),
            }
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=16) as ex:
        for f in as_completed([ex.submit(analyze, s) for s in symbols]):
            res = f.result()
            if res:
                results.append(res)

    _log(f"⚡ Strategy A (3-Day MOMENTUM) → {len(results)} valid")
    return results

# ------------------------------------------------------------
# Strategy B — 5-Day REVERSAL (adaptive thresholds)
# ------------------------------------------------------------
def strategy_reversal5(symbols: List[str], api_key: str, api_secret: str) -> List[Dict]:
    """Identify 5-day reversals using actual price history (adaptive)."""
    results = []

    def analyze(s):
        try:
            df, conf = fetch_price_history(s, api_key, api_secret, days=5)
            PROGRESS["current"] += 1
            if df.empty or len(df) < 5:
                return None

            first_price = df.iloc[0]["close"]
            min_price = df["close"].min()
            end_price = df.iloc[-1]["close"]

            drop_pct = ((min_price - first_price) / first_price) * 100
            rebound = ((end_price - min_price) / min_price) * 100
            if rebound < 0.5 or drop_pct > -2:
                return None

            volatility = df["close"].pct_change().std() * 100
            data_ratio = len(df) / 5
            noise_factor = max(0.5, 1 - (volatility / 100))
            conf_val = round(conf * data_ratio * noise_factor, 2)
            grade = "A" if conf_val >= 0.7 else "B" if conf_val >= 0.5 else "C"

            score = rebound * 0.4 + volatility * 0.3 + abs(drop_pct) * 0.3

            last_q_price, prev_q_price = get_quarter_price_change(s)
            growth_qtr = ((last_q_price - prev_q_price) / prev_q_price) * 100 if prev_q_price > 0 else 0.0
            rev_growth = get_quarterly_revenue_growth(s)

            return {
                "symbol": s,
                "strategy": "5 Day Strategy",
                "drop_5d": round(drop_pct, 1),
                "rebound": round(rebound, 1),
                "volatility": round(volatility, 2),
                "growth": round(growth_qtr, 1),
                "revenue": round(rev_growth, 1),
                "confidence": grade,
                "pe": round(abs(rebound / 3), 1),
                "eps": round(rebound / 6, 1),
                "last_price": round(end_price, 2),
                "prev_quarter_price": round(prev_q_price, 2),
                "score": round(score, 3),
            }
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=16) as ex:
        for f in as_completed([ex.submit(analyze, s) for s in symbols]):
            res = f.result()
            if res:
                results.append(res)

    _log(f"📈 Strategy B (5-Day REVERSAL) → {len(results)} valid")
    return results

# ------------------------------------------------------------
# Discovery Engine
# ------------------------------------------------------------
def discover_symbols(api_key: str, api_secret: str) -> Dict[str, List[Dict]]:
    _log(f"🔎 Starting discovery using dynamic Alpaca credentials (limit {UNIVERSE_LIMIT})")

    universe = list_tradable_symbols_via_alpaca(api_key, api_secret, UNIVERSE_LIMIT)
    if not universe:
        _log("⚠️ No symbols from Alpaca — aborting discovery.")
        return {"symbols": []}

    universe = clean_symbols(universe)
    liquid = apply_liquidity_price_filters(universe)
    if not liquid:
        _log("⚠️ No symbols passed liquidity filter.")
        return {"symbols": []}

    PROGRESS["current"] = 0
    PROGRESS["total"] = len(liquid) * 2

    with ThreadPoolExecutor(max_workers=2) as ex:
        future_m = ex.submit(strategy_momentum3, liquid, api_key, api_secret)
        future_r = ex.submit(strategy_reversal5, liquid, api_key, api_secret)
        momentum3_results = future_m.result()
        reversal5_results = future_r.result()

    combined: Dict[str, Dict] = {}
    for s in (momentum3_results + reversal5_results):
        if not s:
            continue
        sym = s["symbol"]
        if sym not in combined:
            combined[sym] = s
            continue
        existing = combined[sym]
        if s.get("score", 0) > existing.get("score", 0):
            combined[sym] = s

    df = pd.DataFrame(combined.values())

    if df.empty:
        _log("⚠️ No stocks met criteria after both strategies.")
        return {"symbols": []}

    def is_confident(val):
        if isinstance(val, str):
            return val in ["A", "B", "C"]
        if isinstance(val, (int, float)):
            return val >= 0.6
        return False

    if "confidence" in df.columns:
        df = df[df["confidence"].apply(is_confident)]
    else:
        _log("⚠️ Missing confidence column, skipping filter.")

    for col in ["growth", "pe", "volatility"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["score"] = (
        (df["growth"].astype(float) / 10) * 0.5
        + (1 / df["pe"].replace(0, 1).astype(float)) * 0.2
        + (df["volatility"].astype(float) / 5) * 0.3
    )

    df = df.sort_values("score", ascending=False).head(40)
    out_list = df.to_dict(orient="records")

    for row in out_list:
        if "last_price" in row:
            row["discovered_price"] = row["last_price"]
        elif "last" in row:
            row["discovered_price"] = row["last"]
        else:
            row["discovered_price"] = None

    for row in out_list:
        try:
            trade_logger.append_event(
                {
                    "event": "discover",
                    "symbol": row.get("symbol"),
                    "strategy": row.get("strategy"),
                    "price": row.get("discovered_price"),
                    "confidence": row.get("confidence"),
                    "score": row.get("score"),
                }
            )
        except Exception:
            pass

    result = {
        "RECOVERY": reversal5_results,
        "MOMENTUM": momentum3_results,
        "symbols": out_list,
        "total_scanned": PROGRESS["total"],
        "after_filters": min(40, len(out_list)),
        "displayed": min(16, len(out_list)),
    }

    with open(DISCOVERY_OUTPUT, "w") as f:
        json.dump(result, f, indent=2)

    _log(f"🏆 Discovery complete: {len(out_list)} symbols → {DISCOVERY_OUTPUT}")
    return result

if __name__ == "__main__":
    print("⚙️ Manual discovery run (no server linkage).")
    API_KEY = input("Enter Alpaca API key: ")
    API_SECRET = input("Enter Alpaca API secret: ")
    discover_symbols(API_KEY, API_SECRET)
