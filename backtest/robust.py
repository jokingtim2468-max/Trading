"""Stress-test the top candidates: neighbour settings, double costs, monthly P&L, losing streaks."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from engine import load, Market, stats, rma
from strategies import Feats

path, sym = sys.argv[1], sys.argv[2]
COST = {"US100": 1.5, "XAUUSD": 0.4}[sym]; USD = {"US100": 2.0, "XAUUSD": 10.0}[sym]
df = load(path); mk = Market(df, COST); mk.cut = int(len(df) * 0.7); f = Feats(mk)
o, h, l, c = mk.o, mk.h, mk.l, mk.c
ny = mk.window(570, 930)


def supertrend(n, mult):
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1)))); tr[0] = h[0] - l[0]
    a = rma(tr, n); hl2 = (h + l) / 2; up = hl2 - mult * a; dn = hl2 + mult * a
    fu = up.copy(); fd = dn.copy(); d = np.ones(len(c))
    for i in range(1, len(c)):
        fu[i] = max(up[i], fu[i - 1]) if c[i - 1] > fu[i - 1] else up[i]
        fd[i] = min(dn[i], fd[i - 1]) if c[i - 1] < fd[i - 1] else dn[i]
        d[i] = 1 if c[i] > fd[i - 1] else -1 if c[i] < fu[i - 1] else d[i - 1]
    fl = np.r_[0, np.diff(d)]
    return np.where(fl > 0, 1, np.where(fl < 0, -1, 0))


def vwapfade(k):
    v = f.vwap
    dev = pd.Series(c - v).groupby(mk.tday).transform(lambda x: x.expanding().std()).to_numpy()
    lo, hi = v - k * dev, v + k * dev
    s = ((c < lo) & (np.roll(c, 1) >= np.roll(lo, 1))).astype(int) - ((c > hi) & (np.roll(c, 1) <= np.roll(hi, 1))).astype(int)
    return s, (c >= v).astype(int) - (c <= v).astype(int)


def streak(p):
    m = cur = 0
    for x in p:
        cur = cur + 1 if x < 0 else 0; m = max(m, cur)
    return m


def report(tag, t):
    a, i_, s = stats(t, mk), stats(t, mk, "is"), stats(t, mk, "oos")
    print(f"{tag:<44} n={a['n']:4d} IS PF {i_['pf']:.2f}  OOS PF {s['pf']:.2f}  all PF {a['pf']:.2f}  net ${a['net']*USD:8.0f}  maxDD ${a['dd']*USD:6.0f}  worst streak {streak(t.pts)}")


cache = {}
print("== Supertrend flip + ADX filter (stop 1 ATR, no target, exit on opposite flip / 4.5h / 16:35) ==")
for n_, m_ in ((10, 3), (10, 2.5), (10, 3.5), (14, 3), (7, 3)):
    st = cache.setdefault((n_, m_), supertrend(n_, m_))
    for th in (15, 18, 20, 22, 25):
        sg = np.where(f.adx < th, st, 0)
        for sl in (1.0, 1.5):
            t = mk.run(sg, ny, sl, 0, 54, -st)
            if (n_, m_) == (10, 3) or (th == 20 and sl == 1.0):
                report(f"ST {n_}/{m_} ADX<{th} SL {sl}ATR", t)
mk.cost = COST * 2
report("ST 10/3 ADX<20 SL1 with DOUBLE costs", mk.run(np.where(f.adx < 20, cache[(10, 3)], 0), ny, 1.0, 0, 54, -cache[(10, 3)]))
mk.cost = COST

print("\n== VWAP 2sd fade + ADX>25 (stop 1.5 ATR, target 1.5R, exit at VWAP / 4.5h / 16:35) ==")
for k in (1.5, 2.0, 2.5):
    s, ex = vwapfade(k)
    for th in (20, 25, 30):
        for sl, rr in ((1.5, 1.5), (1.5, 1.0), (2.0, 1.5), (1.0, 1.5)):
            if k == 2.0 or (th == 25 and (sl, rr) == (1.5, 1.5)):
                report(f"VWAP {k}sd ADX>{th} SL{sl} R{rr}", mk.run(np.where(f.adx > th, s, 0), ny, sl, rr, 54, ex))
s, ex = vwapfade(2.0)
mk.cost = COST * 2
report("VWAP 2sd ADX>25 with DOUBLE costs", mk.run(np.where(f.adx > 25, s, 0), ny, 1.5, 1.5, 54, ex))
mk.cost = COST

# monthly P&L of both, and run together
t1 = mk.run(np.where(f.adx < 20, cache[(10, 3)], 0), ny, 1.0, 0, 54, -cache[(10, 3)])
t2 = mk.run(np.where(f.adx > 25, s, 0), ny, 1.5, 1.5, 54, ex)
mon = lambda t: (t.assign(mo=df.ny[t.i].dt.strftime("%Y-%m").to_numpy()).groupby("mo").pts.sum() * USD).round(0)
M = pd.DataFrame({"Supertrend+ADX<20": mon(t1), "VWAP fade+ADX>25": mon(t2)}).fillna(0)
M["both"] = M.sum(axis=1)
print("\n== Monthly $ on 1 micro contract ==")
print(M.to_string())
print("months positive:", (M > 0).sum().to_dict(), "of", len(M))
both = pd.concat([t1, t2]).sort_values("i")
report("BOTH together (1 micro each)", both)
for name, t in (("supertrend", t1), ("vwapfade", t2)):
    t.assign(time=df.ny[t.i].to_numpy()).to_csv(os.path.join(os.path.dirname(os.path.abspath(__file__)), f"trades_{sym}_{name}.csv"), index=False)
print("avg stop size (pts): ST", round(float(np.nanmean(mk.atr[t1.i])) * 1.0, 1), " VWAP", round(float(np.nanmean(mk.atr[t2.i])) * 1.5, 1))
