"""Step 5 (informational - no family qualified): random-entry luck test and 2x costs
on TRAIN for the two closest candidates, frozen at their defaults."""
import datetime as dt
import json
import sys

import numpy as np

import bt

data_dir, out = sys.argv[1], sys.argv[2]
TE = dt.date.fromisoformat(bt.TRAIN_END)
data = {s: bt.load(data_dir, s) for s in ("ES", "NQ")}
news = bt.news_windows(sorted(set(data["NQ"]) | set(data["ES"])))
rng = np.random.default_rng(7)
N_RAND = 500
res = {}
for name in ("ORB", "GAP_FILL"):
    fn, p = bt.FAMILIES[name]
    res[name] = {}
    for s in ("ES", "NQ"):
        days = {d for d in data[s] if d <= TE}
        trades = bt.backtest(data[s], s, fn, p, news, days)
        real = bt.stats(trades, len(days))
        x2 = bt.stats(bt.backtest(data[s], s, fn, p, news, days, cost_mult=2.0), len(days))
        # random entries: same days, same count, same stop distance and 2R target,
        # random direction; time random in the family's entry window
        nets = []
        for _ in range(N_RAND):
            tot = []
            for tr in trades:
                rec = data[s][tr["date"]]
                dist = abs(tr["entry"] - tr["stop"])
                t = tr["t_in"] if name == "GAP_FILL" else int(rng.integers(585 // 5, 690 // 5)) * 5
                side = 1 if rng.random() < 0.5 else -1
                f5 = rec["f5"]
                row = f5[f5.t + 5 == t]
                if not len(row):
                    continue
                px = float(row.c.iloc[0])
                st = px - side * dist
                sig = [dict(t=t, side=side, px=px, stop=st, tp=px + side * p.get("tp_r", 1.0) * dist, kind="mkt")]
                tot += bt.run_day(rec, sig, s, news.get(tr["date"], []), 1)
            nets.append(sum(z["pnl"] for z in tot))
        nets = np.array(nets)
        pval = float((nets >= real["net"]).mean())
        res[name][s] = dict(real=real, cost2x=x2, rand_mean=float(nets.mean()), rand_p95=float(np.percentile(nets, 95)),
                            p_value=pval)
        print(f"{name:9s} {s}: real net ${real['net']:7.0f} PF {real['pf']:.2f} | 2x costs net ${x2['net']:7.0f} "
              f"PF {x2['pf']:.2f} | random mean ${nets.mean():7.0f}, 95th pct ${np.percentile(nets, 95):7.0f}, "
              f"p-value {pval:.2f}", flush=True)
json.dump(res, open(out, "w"), indent=1, default=str)
