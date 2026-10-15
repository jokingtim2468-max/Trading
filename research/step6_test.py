"""Step 6/7: open the held-out test period ONCE for the frozen candidates (parameters
fixed by step 4), print the train/validation/test table, and simulate 20,000 Lucid 25K
evaluations by bootstrapping test-period trading days.

Lucid 25K eval model: start $25,000; EOD trailing max-loss $1,000 that follows the
highest end-of-day balance and stops trailing at $25,100; intraday breach checked with
each trade's MAE; target +$1,250 with the 50% consistency rule (largest day <= 50% of
total profit); capped at 250 trading days."""
import datetime as dt
import hashlib
import json
import os
import sys

import numpy as np

import bt

data_dir, vault, out = sys.argv[1], sys.argv[2], sys.argv[3]
meta = json.load(open(os.path.join(data_dir, "meta.json")))
for s in ("ES", "NQ"):
    h = hashlib.sha256(open(os.path.join(vault, f"{s}_test.pkl"), "rb").read()).hexdigest()
    assert h == meta["hashes"][s], f"{s} test file changed!"
    print(f"{s} test file sha256 verified: {h[:16]}...")

TE = dt.date.fromisoformat(bt.TRAIN_END)
tv = {s: bt.load(data_dir, s) for s in ("ES", "NQ")}
te = {s: bt.load(vault, s, "test") for s in ("ES", "NQ")}
news = bt.news_windows(sorted(set(tv["NQ"]) | set(te["NQ"]) | set(tv["ES"]) | set(te["ES"])))
FROZEN = json.load(open(os.path.join(os.path.dirname(out), "step4_tune.json")))


def daily(trades, days):
    """per day: (pnl, intraday worst equity relative to start of day)."""
    by = {d: [] for d in days}
    for t in trades:
        by[t["date"]].append(t)
    res = []
    for d in sorted(by):
        cum, worst = 0.0, 0.0
        for t in sorted(by[d], key=lambda x: x["t_in"]):
            worst = min(worst, cum - t["mae"])
            cum += t["pnl"]
            worst = min(worst, cum)
        res.append((cum, worst))
    return np.array(res) if res else np.zeros((0, 2))


def simulate(dd, n=20000, max_days=250, seed=11):
    rng = np.random.default_rng(seed)
    passed, blown, days_to_pass = 0, 0, []
    for _ in range(n):
        bal, hw, best_day, profit = 25000.0, 25000.0, 0.0, 0.0
        floor = 24000.0
        for k in range(1, max_days + 1):
            pnl, worst = dd[rng.integers(len(dd))]
            if bal + worst <= floor:
                blown += 1
                break
            bal += pnl
            if bal <= floor:
                blown += 1
                break
            hw = max(hw, bal)
            floor = min(hw - 1000.0, 25100.0) if hw - 1000.0 > floor else floor
            profit = bal - 25000.0
            best_day = max(best_day, pnl)
            if profit >= 1250.0 and best_day <= 0.5 * profit:
                passed += 1
                days_to_pass.append(k)
                break
    return dict(pass_pct=100 * passed / n, blowup_pct=100 * blown / n,
                timeout_pct=100 * (n - passed - blown) / n,
                median_days=float(np.median(days_to_pass)) if days_to_pass else None)


report = {}
for name in ("GAP_FILL", "ORB"):
    fn = bt.FAMILIES[name][0]
    p = FROZEN[name]["final"]
    report[name] = {"params": p}
    print(f"\n== {name} {p}  (did NOT pass the train gate - informational only)")
    print(f"{'':4s}{'period':11s}{'trades':>7s}{'win%':>7s}{'PF':>6s}{'net $':>9s}{'maxDD $':>9s}{'$/week':>8s}")
    for s in ("ES", "NQ"):
        for per, src, days in (("train", tv[s], {d for d in tv[s] if d <= TE}),
                               ("validation", tv[s], {d for d in tv[s] if d > TE}),
                               ("TEST", te[s], set(te[s]))):
            trades = bt.backtest(src, s, fn, p, news, days)
            st = bt.stats(trades, len(days))
            report[name][f"{s}_{per}"] = st
            print(f"{s:4s}{per:11s}{st['trades']:7d}{st['win']:7.1f}{st['pf']:6.2f}{st['net']:9.0f}{st['maxdd']:9.0f}"
                  f"{st['per_week']:8.1f}")
            if per == "TEST":
                mc = simulate(daily(trades, sorted(days)))
                report[name][f"{s}_lucid_mc"] = mc
                print(f"    Lucid 25K x20,000 on {s} test days: pass {mc['pass_pct']:.1f}%  blow-up {mc['blowup_pct']:.1f}%  "
                      f"unresolved after 250 days {mc['timeout_pct']:.1f}%  median days to pass {mc['median_days']}")
json.dump(report, open(out, "w"), indent=1, default=str)
