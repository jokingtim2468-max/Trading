"""Fixed day lines: one predicted HIGH and one predicted LOW, decided at the 6 PM New York futures
open and never moved. They cover the whole CME day: overnight, the regular session and after-hours
until 5 PM.

The model is a median (least-absolute-error) linear regression on daily features known at the open,
trained on 10 years of daily bars. It predicts how far the day travels up from the open and down
from the open, in daily ATRs. Median regression minimizes the average distance between the line
and the real high/low, which matches the goal of having price come as close as possible to the line.
The "before training" baseline is the median of the last 250 days' moves.
"""

import numpy as np
import pandas as pd

FEATURES = ["one", "prng", "gap", "agap", "r5", "r60", "pup", "pdn", "pup5", "pdn5", "loc", "tr20", "mon", "fri"]
ATR_DAYS = 20


def features(d):
    """d: daily bars (o/h/l/c) indexed by CME trade date. Returns features, up move, down move, ATR."""
    pc = d.c.shift()
    tr = np.maximum(d.h, pc) - np.minimum(d.l, pc)
    atr = tr.rolling(ATR_DAYS).mean().shift()
    up, dn = (d.h - d.o) / atr, (d.o - d.l) / atr
    dow = pd.Series([x.weekday() for x in d.index], index=d.index)
    F = pd.DataFrame({
        "one": 1.0, "prng": tr.shift() / atr, "gap": (d.o - pc) / atr, "agap": (d.o - pc).abs() / atr,
        "r5": tr.rolling(5).mean().shift() / atr, "r60": tr.rolling(60).mean().shift() / atr,
        "pup": up.shift(), "pdn": dn.shift(), "pup5": up.shift().rolling(5).mean(), "pdn5": dn.shift().rolling(5).mean(),
        "loc": ((pc - d.l.shift()) / (d.h.shift() - d.l.shift())).fillna(0.5), "tr20": (d.o - d.c.shift(20)) / atr,
        "mon": (dow == 0) * 1.0, "fri": (dow == 4) * 1.0,
    }, index=d.index).replace([np.inf, -np.inf], np.nan)
    return F[FEATURES], up, dn, atr


def fit_lad(X, y, iters=60, l2=1e-3):
    """Median regression by iteratively reweighted least squares."""
    w = np.zeros(X.shape[1])
    wt = np.ones(len(y))
    for _ in range(iters):
        A = (X * wt[:, None]).T @ X + l2 * np.eye(X.shape[1])
        w = np.linalg.solve(A, (X * wt[:, None]).T @ y)
        wt = 1 / np.maximum(np.abs(y - X @ w), 1e-3)
    return w


def train(d, before=None, years=10):
    """Fit up/down coefficients on up to `years` of days strictly before `before` (default: all days)."""
    F, up, dn, _ = features(d)
    m = pd.concat([F, up.rename("up"), dn.rename("dn")], axis=1).dropna()
    if before is not None:
        m = m[m.index < before]
    m = m[m.index >= m.index[-1] - pd.Timedelta(days=365 * years)]
    return {"up": fit_lad(m[FEATURES].to_numpy(), m.up.to_numpy()).tolist(),
            "dn": fit_lad(m[FEATURES].to_numpy(), m.dn.to_numpy()).tolist(),
            "days": int(len(m)), "from": str(m.index[0]), "to": str(m.index[-1])}


def lines(d, day, coef=None, open_price=None):
    """Predicted high and low for `day`. coef=None gives the untrained baseline (250-day medians).
    open_price: the 6 PM open of the bars the lines are drawn on. Pass it when the chart's data can
    differ from the daily series (e.g. futures roll weeks, or a broker CFD); the moves are in ATRs,
    so they apply to any price level."""
    F, up, dn, atr = features(d)
    o = float(d.o.loc[day]) if open_price is None else float(open_price)
    a = float(atr.loc[day])
    if coef is None:
        u = float(up[up.index < day].tail(250).median())
        v = float(dn[dn.index < day].tail(250).median())
    else:
        x = F.loc[day].to_numpy(dtype=float)
        u = max(0.0, float(x @ np.array(coef["up"])))
        v = max(0.0, float(x @ np.array(coef["dn"])))
    return o + u * a, o - v * a, a


def evaluate(d, test_days=500):
    """Walk-forward check: train on everything before the last `test_days`, score those days."""
    F, up, dn, atr = features(d)
    m = pd.concat([F, up.rename("up"), dn.rename("dn")], axis=1).dropna()
    cut = m.index[-test_days]
    coef = train(d, before=cut)
    te = m[m.index >= cut]
    X = te[FEATURES].to_numpy()
    after_u = np.abs(te.up - np.maximum(0, X @ np.array(coef["up"])))
    after_d = np.abs(te.dn - np.maximum(0, X @ np.array(coef["dn"])))
    base_u = np.abs(te.up - up.rolling(250).median().shift().loc[te.index])
    base_d = np.abs(te.dn - dn.rolling(250).median().shift().loc[te.index])
    return {"test_from": str(cut), "days": int(len(te)),
            "before": {"high": float(base_u.mean()), "low": float(base_d.mean())},
            "after": {"high": float(after_u.mean()), "low": float(after_d.mean())},
            "after_within_025": {"high": float((after_u < 0.25).mean()), "low": float((after_d < 0.25).mean())}}
