"""Gold checkpoint locks: the day's HIGH/LOW re-predicted at fixed times of the CME day and then held.

The 6 PM open lines (ai/fixed_model.py) can only use yesterday's data, and no extra input (gold
volatility index, dollar, yields, silver, stocks, calendar) moved their walk-forward miss below about
0.31 daily ATR. What does help is what the day has already done. At each checkpoint below, the high
and low are predicted again from the range made so far and then locked until the next checkpoint:

    8 PM (Asia), 3 AM (London), 8 AM (COMEX), 10 AM (New York), 12 PM   - New York time

Prediction at a checkpoint: high = high so far + u * ATR, low = low so far - v * ATR, where u and v are
the median (least-absolute-error) estimates of how much further the day still goes. Inputs (all known
at the checkpoint): range made up/down from the 6 PM open, where price is now, the range so far and
how it compares with a normal day at that hour, the last 5 days' range and yesterday's range.
"""

import numpy as np
import pandas as pd

from ai import fixed_model as FM

CHECKPOINTS = [(2, "8 PM"), (9, "3 AM"), (14, "8 AM"), (16, "10 AM"), (18, "12 PM")]   # hours after 6 PM NY
FEATURES = ["one", "upd", "dnd", "pos", "rngs", "rngfrac", "r5", "prng"]


def rows(h1, daily):
    """One row per (trade date, checkpoint). h1: hourly bars (NY time), daily: o/h/l/c by trade date."""
    F, _, _, atr = FM.features(daily)
    h1 = h1[h1.h >= h1.l]
    td = (h1.index + pd.Timedelta(hours=6)).normalize()
    el = ((h1.index - td + pd.Timedelta(hours=6)) / pd.Timedelta(hours=1)).astype(int)
    h1 = h1.assign(td=td.date, el=el)
    out = []
    for d, b in h1.groupby("td"):
        a = atr.get(d, np.nan)
        if len(b) < 20 or b.el.iloc[0] != 0 or not np.isfinite(a) or a <= 0:
            continue
        o, H, L = b.o.iloc[0], b.h.max(), b.l.min()
        for k, name in CHECKPOINTS:
            s = b[b.el < k]
            hs, ls = max(o, s.h.max()), min(o, s.l.min())
            out.append(dict(td=d, k=k, ck=name, o=o, H=H, L=L, a=a, hs=hs, ls=ls,
                            upd=(hs - o) / a, dnd=(o - ls) / a, pos=(s.c.iloc[-1] - o) / a, rngs=(hs - ls) / a,
                            r5=F.r5.get(d, np.nan), prng=F.prng.get(d, np.nan),
                            y_up=(H - hs) / a, y_dn=(ls - L) / a))
    R = pd.DataFrame(out).dropna()
    R["one"] = 1.0
    return R


def _fit(tr):
    """LAD per checkpoint; returns raw-unit coefficients (so the EA just takes a dot product)."""
    med = tr.groupby("k").rngs.median()
    res = {}
    for k, _ in CHECKPOINTS:
        q = tr[tr.k == k].copy()
        q["rngfrac"] = q.rngs / med[k]
        X = q[FEATURES].to_numpy(float)
        mu, sd = X.mean(0), X.std(0)
        mu[0], sd[0] = 0.0, 1.0
        sd[sd == 0] = 1.0
        co = {}
        for y in ("y_up", "y_dn"):
            w = FM.fit_lad((X - mu) / sd, q[y].to_numpy(float), iters=80, l2=1e-2)
            raw = w / sd
            raw[0] = w[0] - float((w[1:] * mu[1:] / sd[1:]).sum())
            co[y] = raw
        res[k] = {"med": float(med[k]), "up": co["y_up"], "dn": co["y_dn"]}
    return res


def _predict(m, q):
    k = q.k.iloc[0]
    X = q.assign(rngfrac=q.rngs / m[k]["med"])[FEATURES].to_numpy(float)
    return np.maximum(0, X @ m[k]["up"]), np.maximum(0, X @ m[k]["dn"])


def train(h1, daily):
    R = rows(h1, daily)
    m = _fit(R)
    return {"hours": [k for k, _ in CHECKPOINTS], "names": [n for _, n in CHECKPOINTS],
            "med": [round(m[k]["med"], 6) for k, _ in CHECKPOINTS],
            "up": [round(float(x), 6) for k, _ in CHECKPOINTS for x in m[k]["up"]],
            "dn": [round(float(x), 6) for k, _ in CHECKPOINTS for x in m[k]["dn"]],
            "days": int(R.td.nunique()), "from": str(R.td.min()), "to": str(R.td.max())}


def evaluate(h1, daily, test_days=250, step=21):
    """Walk-forward: refit every `step` days on earlier days only; score the last `test_days` days.
    Also scores the 6 PM open lines on the same days for comparison."""
    R = rows(h1, daily)
    days = sorted(R.td.unique())
    test = days[-test_days:]
    parts = []
    for i in range(0, len(test), step):
        blk = test[i:i + step]
        m = _fit(R[R.td < blk[0]])
        for k, _ in CHECKPOINTS:
            q = R[(R.k == k) & R.td.isin(blk)]
            if len(q):
                pu, pd_ = _predict(m, q)
                parts.append(q.assign(ph=q.hs + pu * q.a, pl=q.ls - pd_ * q.a))
        coef = FM.train(daily, before=blk[0])
        for d in blk:
            hi, lo, a = FM.lines(daily, d, coef)
            r = R[(R.td == d)].iloc[0]
            parts.append(pd.DataFrame([dict(td=d, k=0, ck="6 PM", a=a, H=r.H, L=r.L, hs=r.o, ls=r.o, ph=hi, pl=lo)]))
    P = pd.concat(parts)
    out = {"days": len(test), "from": str(test[0]), "to": str(test[-1]), "checkpoints": []}
    for k, name in [(0, "6 PM")] + CHECKPOINTS:
        q = P[P.k == k]
        eh, el = (q.H - q.ph).abs(), (q.L - q.pl).abs()
        later = pd.concat([(eh / q.a)[q.H > q.hs], (el / q.a)[q.L < q.ls]])
        out["checkpoints"].append({
            "name": name, "miss_hi": round(float(eh.mean()), 2), "miss_lo": round(float(el.mean()), 2),
            "miss_atr": round(float(((eh + el) / 2 / q.a).mean()), 3),
            "within5": round(float(((eh <= 5).mean() + (el <= 5).mean()) / 2), 3),
            "within10": round(float(((eh <= 10).mean() + (el <= 10).mean()) / 2), 3),
            "still_hi": round(float((q.H > q.hs).mean()), 3), "still_lo": round(float((q.L < q.ls).mean()), 3),
            "miss_still_atr": round(float(later.mean()), 3) if len(later) else 0.0})
    out["avg_atr"] = round(float(P[P.k == 0].a.mean()), 2)
    return out
