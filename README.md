# CaimeoV1
# CaimeoV1

## Why no trades may occur

The auto-trader intentionally skips entries unless several conditions are met:

- **Valid discovery candidates**: `auto_trader.py` only trades symbols present in `discovered_full.json`. If discovery returns an empty list, it logs `"⏸ No trade candidates (empty discovery list)."` and waits for the next cycle.
- **Day-trade cap**: Weekly entries are limited by `MAX_DAY_TRADES_PER_WEEK` (default 65). When the cap is reached, the loop logs `"⏸ Day-trade cap reached ..."` and pauses until the next week.
- **Market window**: Trades are suppressed until the market is open and at least `MINUTES_AFTER_OPEN` minutes have passed (default 15). During this window it logs `"⏸ Waiting for market ..."`. Set `ALLOW_AFTER_HOURS=true` in the environment to bypass the market-open check (useful for paper trading after hours).
- **Position slots and sizing**: If existing positions plus open orders meet `MAX_POSITIONS` (default 3) or sizing results in a 0 quantity, the loop logs `"⏸ Position cap reached"` or `"⚠️ Skipping ... could not size position"` and moves on.

Check `bot_output.log` for these messages to confirm which guardrail prevented entries during a session.
