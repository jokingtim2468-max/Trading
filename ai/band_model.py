"""Short-term 80% band and projected candle shapes (shared by the trainer, the EA tables and the videos).

For horizons of 1..12 five-minute bars it stores the 10th, 50th and 90th percentile of past moves,
measured in 5-minute ATRs (ATR = 14-bar average true range), separately for the regular session
(9:30-16:00 New York) and off-hours. That's the standard volatility-cone method: the band widens with
volatility and with the square root of time, and it's calibrated so price lands inside it about 80% of
the time. Candle shapes are the median body, upper wick and lower wick (in ATRs) for each hour of
the day, so projected candles look like the candles that hour usually prints.
"""

import numpy as np
import pandas as pd

H = 12
Q_LO, Q_HI = 0.10, 0.90


def is_rth(ts):
    m = ts.hour * 60 + ts.minute
    return 570 <= m < 960


def calibrate(m5, before=None):
    """m5: 5-minute bars in New York time. Uses only days before `before` when given."""
    b = m5 if before is None else m5[m5.index.date < before]
    b = b.copy()
    tr = np.maximum(b.h, b.c.shift()) - np.minimum(b.l, b.c.shift())
    b["atr"] = tr.rolling(14).mean()
    b["rth"] = [is_rth(t) for t in b.index]
    out = {}
    for name, mask in (("rth", b.rth), ("off", ~b.rth)):
        q = {}
        for h in range(1, H + 1):
            mv = ((b.c.shift(-h) - b.c) / b.atr)[mask].dropna()
            q[h] = (float(mv.quantile(Q_LO)), float(mv.quantile(0.5)), float(mv.quantile(Q_HI)))
        out[name] = q
    hr = b.index.hour
    body = (b.c - b.o).abs() / b.atr
    top = (b.h - b[["o", "c"]].max(axis=1)) / b.atr
    bot = (b[["o", "c"]].min(axis=1) - b.l) / b.atr
    out["shape"] = {h: (float(body[hr == h].median()), float(top[hr == h].median()), float(bot[hr == h].median()))
                    for h in range(24)}
    days = sorted(set(b.index.date))
    test = b[b.index.date >= days[int(len(days) * 0.8)]]
    hits = n = 0
    for name, mask in (("rth", test.rth), ("off", ~test.rth)):
        lo, _, hi = out[name][H]
        mv = ((test.c.shift(-H) - test.c) / test.atr)[mask].dropna()
        hits += int(((mv >= lo) & (mv <= hi)).sum())
        n += len(mv)
    out["test_cover"] = hits / max(n, 1)
    out["test_days"] = len(set(test.index.date))
    return out


def flat(cal):
    """Arrays for the EA: band rth/off as 12 x (lo, mid, hi), shape as 24 x (body, top, bottom)."""
    band = {k: [round(v, 4) for h in range(1, H + 1) for v in cal[k][h]] for k in ("rth", "off")}
    shape = [round(v if np.isfinite(v) else 0.0, 4) for h in range(24) for v in cal["shape"][h]]
    return band["rth"], band["off"], shape
