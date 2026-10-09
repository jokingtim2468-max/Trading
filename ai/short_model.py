"""Short-term (quick trade) model shared by the trainer and the AI service.

Features are computed on 5-minute bars and are scale-free (moves divided by ATR), so the same
coefficients work in Python, the MT5 EA and the TradingView script. A logistic regression turns
them into the probability that price is higher 12 bars (1 hour) from now. The TP and SL distances
are multiples of the 5-minute ATR chosen by the trainer.
"""

import numpy as np
import pandas as pd

FEATURES = ["r1", "r3", "r12", "r48", "rsi", "vwap", "pos", "rngx", "tod_s", "tod_c", "toHi", "toLo"]
HOLD_BARS = 12      # 12 x 5 min = 1 hour max hold
ATR_LEN = 14


def rsi(c, n=14):
    d = c.diff()
    g = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    l_ = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + g / l_)


def features(b, day_atr, live):
    """b: 5-minute bars indexed in New York time with o/h/l/c/v columns.
    day_atr: mapping CME trade date -> daily ATR known at the open.
    live: dict with the trained 'up' and 'dn' tables (24 hours x 3 range positions).
    Returns (features DataFrame, 5-minute ATR Series)."""
    c = b.c
    tr = np.maximum(b.h, c.shift()) - np.minimum(b.l, c.shift())
    atr = tr.rolling(ATR_LEN).mean()
    day = pd.Series((b.index + pd.Timedelta(hours=6)).date, index=b.index)       # CME trade date
    tp = (b.h + b.l + c) / 3
    v = b.v.replace(0, np.nan).fillna(1)
    vw = (tp * v).groupby(day).cumsum() / v.groupby(day).cumsum()
    hs = b.h.groupby(day).cummax()
    ls = b.l.groupby(day).cummin()
    idx = pd.Series(b.index, index=b.index)
    t0 = idx.groupby(day).transform("first")
    hr = ((idx - t0).dt.total_seconds() // 3600).clip(0, 23).astype(int).to_numpy()
    frac = ((c - ls) / (hs - ls)).where(hs > ls, 0.5)
    pos3 = np.clip(frac * 3, 0, 2.999).astype(int).to_numpy()
    A = day.map(day_atr).astype(float)
    lh = hs + np.take(live["up"], hr * 3 + pos3) * A
    ll = ls - np.take(live["dn"], hr * 3 + pos3) * A
    mins = b.index.hour * 60 + b.index.minute
    F = pd.DataFrame({
        "r1": (c - c.shift(1)) / atr, "r3": (c - c.shift(3)) / atr,
        "r12": (c - c.shift(12)) / atr, "r48": (c - c.shift(48)) / atr,
        "rsi": (rsi(c) - 50) / 50, "vwap": (c - vw) / atr, "pos": frac - 0.5,
        "rngx": (b.h - b.l) / atr - 1,
        "tod_s": np.sin(2 * np.pi * mins / 1440), "tod_c": np.cos(2 * np.pi * mins / 1440),
        "toHi": (lh - c) / A, "toLo": (c - ll) / A,
    }, index=b.index)
    return F[FEATURES], atr


def fit_logistic(X, y, l2=10.0, iters=25):
    """Newton's method with an L2 penalty (intercept unpenalised). X already standardised."""
    X1 = np.c_[np.ones(len(X)), X]
    w = np.zeros(X1.shape[1])
    R = l2 * np.eye(X1.shape[1])
    R[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X1 @ w))
        W = p * (1 - p)
        g = X1.T @ (p - y) + R @ w
        H = (X1 * W[:, None]).T @ X1 + R
        w -= np.linalg.solve(H, g)
    return w


def predict(F, m):
    """Probability that price is higher HOLD_BARS from now, for each row of F."""
    z = (F[FEATURES].to_numpy() - np.array(m["mu"])) / np.array(m["sd"])
    return 1 / (1 + np.exp(-(m["coef"][0] + z @ np.array(m["coef"][1:]))))


def simulate(b, atr, dirs, tpm, slm, cost):
    """Walk forward: enter at the close in `dirs` direction, exit at TP, SL or after HOLD_BARS.
    Stop is checked first when both are touched in one bar. Results are in ATR multiples after cost."""
    h, l, c, a = b.h.to_numpy(), b.l.to_numpy(), b.c.to_numpy(), atr.to_numpy()
    res = []
    i, n = 0, len(c)
    while i < n - HOLD_BARS - 1:
        d = dirs[i]
        if d == 0 or not np.isfinite(a[i]) or a[i] <= 0:
            i += 1
            continue
        e = c[i]
        tp, sl = e + d * tpm * a[i], e - d * slm * a[i]
        out, j = None, i
        for j in range(i + 1, i + HOLD_BARS + 1):
            if (d > 0 and l[j] <= sl) or (d < 0 and h[j] >= sl):
                out = -slm * a[i]
                break
            if (d > 0 and h[j] >= tp) or (d < 0 and l[j] <= tp):
                out = tpm * a[i]
                break
        if out is None:
            out = d * (c[i + HOLD_BARS] - e)
        res.append((out - cost) / a[i])
        i = j + 1
    r = np.array(res)
    return {"n": int(len(r)), "win": float((r > 0).mean()) if len(r) else 0.0, "ev": float(r.mean()) if len(r) else 0.0}


def levels(price, atr5, p, m):
    """TP / SL for the side the model leans to. Returns a dict the UI layers can draw."""
    d = 1 if p >= 0.5 else -1
    return {
        "dir": "LONG" if d > 0 else "SHORT",
        "conf": float(max(p, 1 - p)),
        "setup": bool(max(p, 1 - p) >= m["thr"]),
        "tp_dist": float(m["tpm"] * atr5), "sl_dist": float(m["slm"] * atr5),
        "tp": float(price + d * m["tpm"] * atr5), "sl": float(price - d * m["slm"] * atr5),
    }
