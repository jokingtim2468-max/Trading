"""Locked session lines for Nasdaq: the regular session and the after-market.

REGULAR (rth): lines locked at the 9:30 New York open for the 9:30-16:00 cash session. Trained on
  10 years of Nasdaq-100 cash index (^NDX) daily bars. At 9:30 the overnight gap is known, and it's
  one of the features. Same median regression as ai/fixed_model.py.

AFTER-MARKET (ah): lines locked at the 16:00 close for 16:00 until 09:00 the next trading morning
  (after-hours, overnight and most of pre-market). Free intraday history only reaches back two
  years (Yahoo hourly NQ=F), so this one trains on ~2 years. Hourly bars can't split 09:00-10:00,
  which is why it stops at 09:00.

Gold trades nearly around the clock, so it keeps the full-day lines (ai/fixed_model.py).
"""

import numpy as np
import pandas as pd

from ai import fixed_model as FM

AH_FEATURES = ["one", "rth_rng", "rth_move", "rth_loc", "day_rng", "r5", "pah_up", "pah_dn", "fri"]


# ---------------------------------------------------------------- regular session (10 years)
def rth_daily(yahoo):
    d = yahoo("^NDX", "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    return d


# FM.train / FM.lines / FM.evaluate work unchanged on ^NDX daily bars (open = 9:30 open).


# ---------------------------------------------------------------- after-market (2 years)
def ah_table(h1, daily):
    """One row per trading day: the 16:00 price, the 16:00 -> 09:00 high/low, and features known at 16:00.
    h1: hourly NQ=F bars in New York time. daily: NQ=F daily bars (for ATR)."""
    tr = np.maximum(daily.h, daily.c.shift()) - np.minimum(daily.l, daily.c.shift())
    atr = tr.rolling(FM.ATR_DAYS).mean().shift()
    r5 = tr.rolling(5).mean().shift() / atr
    h = h1.copy()
    h["date"] = h.index.date
    h["hm"] = h.index.hour * 60 + h.index.minute
    rows = []
    dates = sorted(set(h.date))
    for i, day in enumerate(dates[:-1]):
        g = h[h.date == day]
        rth = g[(g.hm >= 9 * 60) & (g.hm < 16 * 60)]           # 9:00-16:00 hourly bars (9:30 inside the 9:00 bar)
        at16 = g[g.hm == 16 * 60]
        if len(rth) < 6 or at16.empty or day not in atr.index or not np.isfinite(atr.get(day, np.nan)):
            continue
        nxt = dates[i + 1]
        sess = h[((h.date == day) & (h.hm >= 16 * 60)) | ((h.date > day) & (h.date <= nxt) &
                                                           ~((h.date == nxt) & (h.hm >= 9 * 60)))]
        if len(sess) < 8:
            continue
        o = float(at16.o.iloc[0])
        a = float(atr[day])
        day_bars = g[g.hm < 16 * 60]
        rows.append({"day": day, "o": o, "H": float(sess.h.max()), "L": float(sess.l.min()), "atr": a,
                     "rth_rng": (rth.h.max() - rth.l.min()) / a, "rth_move": (o - rth.o.iloc[0]) / a,
                     "rth_loc": (o - rth.l.min()) / max(rth.h.max() - rth.l.min(), 1e-9),
                     "day_rng": (day_bars.h.max() - day_bars.l.min()) / a, "r5": float(r5.get(day, np.nan)),
                     "fri": 1.0 if pd.Timestamp(day).weekday() == 4 else 0.0})
    t = pd.DataFrame(rows).set_index("day")
    t["up"] = (t.H - t.o) / t.atr
    t["dn"] = (t.o - t.L) / t.atr
    t["pah_up"] = t.up.shift()
    t["pah_dn"] = t.dn.shift()
    t["one"] = 1.0
    return t.replace([np.inf, -np.inf], np.nan).dropna()


def ah_train(t, before=None):
    m = t if before is None else t[t.index < before]
    X = m[AH_FEATURES].to_numpy()
    return {"up": FM.fit_lad(X, m.up.to_numpy()).tolist(), "dn": FM.fit_lad(X, m.dn.to_numpy()).tolist(),
            "days": int(len(m)), "from": str(m.index[0]), "to": str(m.index[-1])}


def ah_lines(t, day, coef=None, open_price=None):
    r = t.loc[day]
    o = float(r.o if open_price is None else open_price)
    if coef is None:
        prev = t[t.index < day].tail(250)
        u, v = float(prev.up.median()), float(prev.dn.median())
    else:
        x = r[AH_FEATURES].to_numpy(dtype=float)
        u, v = max(0.0, float(x @ np.array(coef["up"]))), max(0.0, float(x @ np.array(coef["dn"])))
    return o + u * r.atr, o - v * r.atr, float(r.atr)


def ah_evaluate(t, test_days=120):
    cut = t.index[-test_days]
    coef = ah_train(t, before=cut)
    te = t[t.index >= cut]
    X = te[AH_FEATURES].to_numpy()
    au = np.abs(te.up - np.maximum(0, X @ np.array(coef["up"])))
    ad = np.abs(te.dn - np.maximum(0, X @ np.array(coef["dn"])))
    bu = np.abs(te.up - t.up.rolling(250, min_periods=60).median().shift().loc[te.index])
    bd = np.abs(te.dn - t.dn.rolling(250, min_periods=60).median().shift().loc[te.index])
    return {"test_from": str(cut), "days": int(len(te)), "train_days": coef["days"],
            "before": {"high": float(bu.mean()), "low": float(bd.mean())},
            "after": {"high": float(au.mean()), "low": float(ad.mean())}}
