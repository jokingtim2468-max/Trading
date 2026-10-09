"""Measure the AI service's logged calls against what price did next.

For every row in ai/logs/predictions.csv that is at least an hour old, replays the TP/SL on Yahoo
5-minute bars (stop first if both are touched in one bar, exit after 1 hour otherwise) and reports
the win rate and average result, split by whether the news agreed with the call. Use it after a
few weeks of running ai/service.py to decide how much weight news deserves (ai/config.json →
news_weight).

    python ai/evaluate.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import train_drp as T  # noqa: E402

HOLD = pd.Timedelta(hours=1)


def outcome(bars, t, d, tp_dist, sl_dist, atr5):
    after = bars[bars.index > t]
    if after.empty:
        return None
    entry = bars[bars.index <= t].c.iloc[-1] if (bars.index <= t).any() else after.o.iloc[0]
    tp, sl = entry + d * tp_dist, entry - d * sl_dist
    for ts, b in after[after.index <= t + HOLD].iterrows():
        if (d > 0 and b.l <= sl) or (d < 0 and b.h >= sl):
            return -sl_dist / atr5
        if (d > 0 and b.h >= tp) or (d < 0 and b.l <= tp):
            return tp_dist / atr5
    end = after[after.index <= t + HOLD]
    return d * (end.c.iloc[-1] - entry) / atr5 if len(end) else None


def main():
    path = ROOT / "ai/logs/predictions.csv"
    if not path.exists():
        raise SystemExit("No log yet. Run ai/service.py for a while first.")
    log = pd.read_csv(path, parse_dates=["bar_time"])
    log["bar_time"] = pd.to_datetime(log.bar_time, utc=True).dt.tz_convert("America/New_York")
    # one call per symbol per 5-minute bar is enough
    log = log.drop_duplicates(["symbol", "bar_time"], keep="last")
    now = pd.Timestamp.now(tz="America/New_York")
    log = log[log.bar_time < now - HOLD - pd.Timedelta(minutes=15)]
    if log.empty:
        raise SystemExit("No calls older than an hour yet.")
    rows = []
    for key, g in log.groupby("symbol"):
        bars = T.yahoo(T.MARKETS[key]["yahoo"], "60d", "5m")
        cost = T.MARKETS[key]["cost"]
        for r in g.itertuples():
            d = 1 if r.dir == "LONG" else -1
            res = outcome(bars, r.bar_time, d, r.tp_dist, r.sl_dist, r.atr5)
            if res is not None:
                rows.append({"symbol": key, "setup": bool(r.setup), "news": r.news, "dir": d,
                             "agree": np.sign(r.news) == d and abs(r.news) >= 0.2, "r": res - cost / r.atr5})
    df = pd.DataFrame(rows)
    if df.empty:
        raise SystemExit("Nothing to score yet.")
    print(f"Scored {len(df)} calls (results in multiples of the 5-minute ATR, after costs)\n")
    for key, g in df.groupby("symbol"):
        print(f"{key}:")
        for name, part in (("all calls", g), ("setups only", g[g.setup]), ("news agreed (|news| >= 0.2)", g[g.agree]),
                           ("news neutral or against", g[~g.agree])):
            if len(part):
                print(f"  {name:30s} n={len(part):4d}  win {100 * (part.r > 0).mean():5.1f}%  avg {part.r.mean():+.3f}")
        print()
    print("If 'news agreed' isn't clearly better than 'news neutral or against' over a few hundred calls,\n"
          "lower news_weight in ai/config.json (0 turns news off).")


if __name__ == "__main__":
    main()
