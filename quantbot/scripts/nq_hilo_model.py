#!/usr/bin/env python3
"""Train and test the NQ daily high/low model behind strategies/qb-nq-daily-high-low-model.pine.

    python nq_hilo_model.py <NQ=F daily json> <NQ=F 1h json>     (Yahoo Finance chart API, free)

Median quantile regression predicts the distance from the session open to the high and to the low; each year is
predicted by a model trained on the 6 years before it. Prints the accuracy against "open +/- half the 20-day average
range", the 2026 model coefficients (paste them into the Pine script) and fade / breakout results on 1h bars.
"""
import sys
import json, numpy as np, pandas as pd, warnings
from sklearn.linear_model import QuantileRegressor
warnings.filterwarnings("ignore")
def yahoo(f):
    d = json.load(open(f))["chart"]["result"][0]; q = d["indicators"]["quote"][0]
    return pd.DataFrame({k: q[k] for k in ("open", "high", "low", "close")}, index=pd.to_datetime(d["timestamp"], unit="s")).dropna()
D = yahoo(sys.argv[1]); D.index = D.index.normalize(); D = D[~D.index.duplicated()]
o, h, l, c = D.open, D.high, D.low, D.close; rng = (h - l) / o
F = pd.DataFrame({"rng1": rng.shift(1), "rng5": rng.rolling(5).mean().shift(1), "rng20": rng.rolling(20).mean().shift(1),
                  "up1": ((h - o) / o).shift(1), "dn1": ((o - l) / o).shift(1), "ret1": (c / c.shift(1) - 1).shift(1),
                  "gap": o / c.shift(1) - 1}, index=D.index)
F["absgap"] = F.gap.abs()
yU, yD = (h - o) / o, (o - l) / o
ok = F.notna().all(axis=1) & (yU >= 0) & (yD >= 0); F, yU, yD, D = F[ok], yU[ok], yD[ok], D[ok]
pred = pd.DataFrame(index=D.index, columns=["up", "dn"], dtype=float); coefs = {}
for Y in range(2008, 2027):
    tr = (D.index.year < Y) & (D.index.year >= Y - 6); te = D.index.year == Y
    for col, y in (("up", yU), ("dn", yD)):
        m = QuantileRegressor(quantile=0.5, alpha=0.0, solver="highs").fit(F[tr], y[tr]); pred.loc[te, col] = m.predict(F[te])
        if Y == 2026: coefs[col] = (m.intercept_, dict(zip(F.columns, m.coef_)))
pred = pred.dropna(); i = pred.index
err = ((yU[i] - pred.up).abs().mean() + (yD[i] - pred.dn).abs().mean()) / 2
base = ((yU[i] - F.rng20[i] / 2).abs().mean() + (yD[i] - F.rng20[i] / 2).abs().mean()) / 2
print(f"NQ futures daily 2008-2026 (each year unseen): {len(i)} days")
print(f"  model off by {100*err:.3f}% of price on average, simple guess {100*base:.3f}%  ({100*(1-err/base):.1f}% better)")
print(f"  price reached the predicted high {100*(yU[i] >= pred.up).mean():.0f}% / low {100*(yD[i] >= pred.dn).mean():.0f}% of days\n")
print("2026 model coefficients:", json.dumps({k: [v[0], v[1]] for k, v in coefs.items()}))
# Trade on real NQ futures 1h bars, 2024-2026
H1 = yahoo(sys.argv[2]); et = H1.index.tz_localize("UTC").tz_convert("America/New_York")
H1["session"] = (et + pd.Timedelta(hours=6)).normalize().tz_localize(None)
COST = 0.75; rows = {}
for mode in ("fade", "breakout"):
    for s in (0.1, 0.25, 0.5):
        pnl = []
        for sess, b in H1.groupby("session"):
            if sess not in pred.index: continue
            o0 = b.open.iloc[0]; up, dn = pred.up[sess] * o0, pred.dn[sess] * o0; r = F.rng20[sess] * o0
            Hh, Ll = b.high.to_numpy(), b.low.to_numpy()
            for side0, lvl in ((-1, o0 + up), (1, o0 - dn)):
                side = side0 if mode == "fade" else -side0
                stop = lvl - side * s * r; tp = o0 if mode == "fade" else lvl + side * abs(lvl - stop) * 2
                f = None; res = None
                for k in range(len(b)):
                    touched = Hh[k] >= lvl if side0 == -1 else Ll[k] <= lvl
                    hs = Ll[k] <= stop if side == 1 else Hh[k] >= stop
                    if f is None:
                        if touched:
                            f = k
                            if hs: res = -abs(lvl - stop); break
                        continue
                    if hs: res = -abs(lvl - stop); break
                    if (side == 1 and Hh[k] >= tp) or (side == -1 and Ll[k] <= tp): res = abs(tp - lvl); break
                if f is not None:
                    if res is None: res = side * (b.close.iloc[-1] - lvl)
                    pnl.append((res - COST) * 20)
        p = np.array(pnl); rows[(mode, s)] = p
        print(f"{mode:8s} stop {s:.2f}x range: {len(p):4d} trades, win {100*(p>0).mean():4.1f}%, PF {p[p>0].sum()/-p[p<0].sum():.2f}, total ${p.sum():+,.0f} on 1 NQ (May 2024-Oct 2026)")
