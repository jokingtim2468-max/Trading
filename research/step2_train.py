"""Step 2: every strategy family with its a-priori default parameters, TRAIN only."""
import datetime as dt
import json
import sys

import bt

data_dir = sys.argv[1]
TE = dt.date.fromisoformat(bt.TRAIN_END)
data = {s: bt.load(data_dir, s) for s in ("ES", "NQ")}
cal = sorted(set(data["NQ"]) | set(data["ES"]))
news = bt.news_windows(cal)
rows = []
for name, (fn, p) in bt.FAMILIES.items():
    row = dict(family=name)
    ok = True
    for s in ("ES", "NQ"):
        days = {d for d in data[s] if d <= TE}
        st = bt.stats(bt.backtest(data[s], s, fn, p, news, days), len(days))
        row[s] = st
        ok &= st["net"] > 0 and st["trades"] >= 40 and st["pf"] > 1.3
    row["passes"] = bool(ok)
    rows.append(row)
    print(f"{name:14s}", "  ".join(
        f"{s}: n={row[s]['trades']:4d} win={row[s]['win']:5.1f}% PF={row[s]['pf']:4.2f} net=${row[s]['net']:8.0f} "
        f"DD=${row[s]['maxdd']:6.0f} $/wk={row[s]['per_week']:6.1f} micros={row[s]['micros']:4.1f}"
        for s in ("ES", "NQ")), " PASS" if ok else " fail", flush=True)
json.dump(rows, open(sys.argv[2], "w"), indent=1, default=str)
