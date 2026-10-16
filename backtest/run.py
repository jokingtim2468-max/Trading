"""Usage: python -I run.py <csv> <symbol: US100|XAUUSD>
Tunes each strategy on the first 70% of the data (in-sample), reports the last 30% (out-of-sample)."""
import sys, os, itertools, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from engine import load, Market, stats
from strategies import Feats, strategies, FILTERS

path, sym = sys.argv[1], sys.argv[2]
COST = {"US100": 1.5, "XAUUSD": 0.4}[sym]           # round-trip points: commission + slippage (MNQ / MGC)
USD = {"US100": 2.0, "XAUUSD": 10.0}[sym]           # $ per point for 1 micro (MNQ / MGC)
WIN = {"ny": (570, 930), "lon": (120, 300), "lonny": (120, 930)}
GRID = list(itertools.product((1.0, 1.5, 2.0), (0, 1.0, 1.5, 2.0, 3.0), (24, 54)))  # SL xATR, R target (0=none), max bars

t0 = time.time()
df = load(path)
mk = Market(df, COST)
mk.cut = int(len(df) * 0.7)
f = Feats(mk)
S = strategies(f)
cut_date = df.ny[mk.cut].date()
print(f"{sym}: {len(df)} bars {df.ny.iloc[0].date()} -> {df.ny.iloc[-1].date()}, out-of-sample from {cut_date}; features {time.time()-t0:.0f}s", flush=True)
weeks_is = (df.ny[mk.cut] - df.ny.iloc[0]).days / 7; weeks_oos = (df.ny.iloc[-1] - df.ny[mk.cut]).days / 7

rows = []
for name, par, sig, ex, w in S:
    ok = mk.window(*WIN[w])
    best = []
    for sl, rr, hold in GRID:
        t = mk.run(sig, ok, sl, rr, hold, ex)
        si = stats(t, mk, "is")
        if si["n"] >= 60:
            best.append((si["net"], (sl, rr, hold), si))
    best.sort(key=lambda x: -x[0])
    for flt in FILTERS:
        cand = []
        for _, (sl, rr, hold), _s in best[:3]:
            sg = FILTERS[flt](f, sig)
            t = mk.run(sg, ok, sl, rr, hold, ex)
            si = stats(t, mk, "is")
            if si["n"] >= 40:
                cand.append((si["net"], (sl, rr, hold), t, si))
        if not cand:
            continue
        cand.sort(key=lambda x: -x[0])
        _, (sl, rr, hold), t, si = cand[0]
        so = stats(t, mk, "oos")
        rows.append(dict(strategy=name, params=par, filter=flt, sl=sl, rr=rr, hold=hold,
                         is_n=si["n"], is_net=si["net"], is_pf=si["pf"],
                         oos_n=so["n"], oos_net=so["net"], oos_pf=so["pf"], oos_win=so["win"], oos_dd=so["dd"],
                         oos_wk=so["n"] / weeks_oos))
    print(f"  {name} {par}: done ({time.time()-t0:.0f}s)", flush=True)

R = pd.DataFrame(rows)
R["oos_$"] = R.oos_net * USD; R["oos_dd_$"] = R.oos_dd * USD
R.to_csv(os.path.join(os.path.dirname(path) if False else os.path.dirname(os.path.abspath(__file__)), f"results_{sym}.csv"), index=False)
pd.set_option("display.width", 250)
cols = ["strategy", "params", "filter", "sl", "rr", "hold", "is_n", "is_net", "is_pf", "oos_n", "oos_wk", "oos_net", "oos_pf", "oos_win", "oos_$", "oos_dd_$"]
alone = R[R["filter"] == "none"].sort_values("oos_net", ascending=False)
print("\n=== ALONE (best in-sample settings, judged out-of-sample) ===")
print(alone[cols].round(2).to_string(index=False))
comb = R[R["filter"] != "none"].sort_values("oos_net", ascending=False)
print("\n=== COMBINED with a filter (top 15 by out-of-sample) ===")
print(comb[cols].head(15).round(2).to_string(index=False))
valid = R[(R.is_pf > 1.1) & (R.oos_n >= 20)].sort_values("oos_net", ascending=False)
print("\n=== WINNER candidates (in-sample PF>1.1, >=20 OOS trades) ===")
print(valid[cols].head(8).round(2).to_string(index=False))
