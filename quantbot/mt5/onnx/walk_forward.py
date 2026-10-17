#!/usr/bin/env python3
"""Walk-forward test of the gold model, and of the ideas meant to strengthen it.

    python walk_forward.py XAUUSD_M5_....csv

Each year Y from 2011 on: train on the 5 years before Y-1, pick the threshold on Y-1, trade Y. Every traded year is
unseen by its model. Variants: broker-time vs UTC hour inputs, with and without a volatility regime filter (only trade
while ATR(100) is above its 500-bar average), flat 0.5% risk vs confidence tiers (0.25 / 0.5 / 1.0%).
"""
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
import train_gold_model as T


def utc_hours(index):
    """MT5 gold brokers mostly run New York close = 00:00 (UTC+2 winter, UTC+3 in US summer time)."""
    ny = index.tz_localize("UTC").tz_convert("America/New_York")
    off = np.where(ny.map(lambda t: t.dst() != pd.Timedelta(0)), 3, 2)
    return (index.hour.to_numpy() - off) % 24


def sim(idx, p, lr, sr, lx, sx, thr, tiers=False):
    eq, peak, dd, i, rs, n = 1.0, 1.0, 0.0, 0, [], len(idx)
    while i < n:
        k = idx[i]
        side = 1 if p[i, 1] > thr and p[i, 1] >= p[i, 2] else (-1 if p[i, 2] > thr else 0)
        if side == 0:
            i += 1; continue
        conf = p[i, 1] if side == 1 else p[i, 2]
        risk = (0.0025 if conf < 0.45 else 0.005 if conf < 0.55 else 0.01) if tiers else 0.005
        r = lr[k] if side == 1 else sr[k]
        rs.append(r); eq *= 1 + risk * r
        peak = max(peak, eq); dd = max(dd, 1 - eq / peak)
        ex = lx[k] if side == 1 else sx[k]
        while i < n and idx[i] <= ex:
            i += 1
    return np.array(rs), eq, dd


def main(path):
    h = T.load_h1(path)
    X, atr = T.features(h)
    lr, sr, lx, sx = T.outcomes(h, atr)
    y = np.where(lr > 0.5, 1, np.where(sr > 0.5, 2, 0))
    ok = ~np.isnan(X).any(axis=1) & ~np.isnan(lr) & ~np.isnan(sr)
    yr = h.index.year.to_numpy()
    hu = utc_hours(h.index)
    Xu = X.copy(); Xu[:, 10] = np.sin(2 * np.pi * hu / 24); Xu[:, 11] = np.cos(2 * np.pi * hu / 24)
    a100 = pd.Series(atr).rolling(100).mean()  # atr is ATR(14); use the 100-bar mean as ATR(100)
    regime = (a100 > a100.rolling(500).mean()).to_numpy()

    variants = {"broker hours": (X, False), "UTC hours": (Xu, False), "UTC + regime filter": (Xu, True)}
    for name, (XX, use_regime) in variants.items():
        allr, flat_eq, tier_eq, flat_dd, tier_dd, rows = [], 1.0, 1.0, 0.0, 0.0, []
        peak_f = peak_t = 1.0
        for Y in range(2011, 2027):
            tr = ok & (yr >= Y - 6) & (yr <= Y - 2); va = ok & (yr == Y - 1); te = ok & (yr == Y)
            if use_regime:
                va, te = va & regime, te & regime
            clf = GradientBoostingClassifier(n_estimators=200, learning_rate=0.05, max_depth=3, min_samples_leaf=200,
                                             subsample=0.5, random_state=7).fit(XX[tr], y[tr])
            best, vi = (0.45, -1e9), np.where(va)[0]
            pv = clf.predict_proba(XX[vi])
            for thr in (0.35, 0.40, 0.45, 0.50):
                rs, _, _ = sim(vi, pv, lr, sr, lx, sx, thr)
                if len(rs) >= 20 and rs.sum() > best[1]:
                    best = (thr, rs.sum())
            ti = np.where(te)[0]
            pt = clf.predict_proba(XX[ti])
            rs, e1, d1 = sim(ti, pt, lr, sr, lx, sx, best[0])
            _, e2, d2 = sim(ti, pt, lr, sr, lx, sx, best[0], tiers=True)
            allr.extend(rs); rows.append(f"{Y} {rs.sum():+.0f}R")
            # Chain the yearly equity curves (drawdown inside a year, plus losing years in a row)
            for eq_y, which in ((e1, "f"), (e2, "t")):
                if which == "f":
                    flat_eq *= eq_y; peak_f = max(peak_f, flat_eq); flat_dd = max(flat_dd, d1, 1 - flat_eq / peak_f)
                else:
                    tier_eq *= eq_y; peak_t = max(peak_t, tier_eq); tier_dd = max(tier_dd, d2, 1 - tier_eq / peak_t)
        r = np.array(allr)
        pf = r[r > 0].sum() / -r[r < 0].sum()
        print(f"{name:22s} 2011-2026 unseen: {len(r)} trades, win {100*(r>0).mean():.1f}%, PF {pf:.2f}, {r.sum():+.0f}R | "
              f"0.5% flat {100*(flat_eq-1):+.0f}% DD~{100*flat_dd:.1f}% | tiers {100*(tier_eq-1):+.0f}% DD~{100*tier_dd:.1f}%")
        print("   by year: " + "  ".join(rows))


if __name__ == "__main__":
    main(sys.argv[1])
