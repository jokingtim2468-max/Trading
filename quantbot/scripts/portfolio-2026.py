# usage: python3 scripts/portfolio-2026.py <XAUUSD M5 export> <NQ M5 export>
# Builds a LucidFlex 150K bot from every strategy version in scripts/strategy-lab.py (180 versions, gold + NQ):
#   1. daily $ P&L per micro for each version (costs included, flat by 16:40 ET)
#   2. CHOOSE on 2022-2025 only: keep versions positive in 2022-2025 AND in 2012/2004-2021, then greedily add the one that
#      raises the combined 2022-2025 average week most, sizing each so the combined 2022-2025 drawdown stays under 75% of
#      the $4,500 max loss and total micros stay under 100
#   3. GRADE once on 2026 (Jan 1 - mid Oct), LucidFlex 150K rules (EOD trailing $4,500, DLL $2,700)
import sys, pickle, os, numpy as np, pandas as pd
src = open(__file__.replace('portfolio-2026.py', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
ARGS = sys.argv[:]
sys.argv = ['x', ARGS[1], ARGS[2], '/dev/null']
g = {}; exec(src, g)
# The cache is written by this script itself (never a downloaded file), so loading it with pickle is safe
CACHE = os.path.join(os.path.dirname(ARGS[1]), 'lab-daily.pkl')
if os.path.exists(CACHE):
    series = pickle.load(open(CACHE, 'rb'))
else:
    series = {}
    for mkt, m in g['MK'].items():
        x = g['prep'](g['load'](m['file']), m)
        for s, grid in g['GRID'].items():
            for p in grid:
                side, stop, tgt = g['signals'](x, m, s, p)
                d = g['per_contract_days'](g['simulate'](x, m, side, stop, tgt), m)
                d.index = pd.DatetimeIndex(d.index)
                series[f'{mkt} {s} {p}'] = d
            print(mkt, s, flush=True)
    pickle.dump(series, open(CACHE, 'wb'))
print(len(series), 'versions', flush=True)

days = pd.DatetimeIndex(sorted(set().union(*[set(v.index) for v in series.values()])))
M = pd.DataFrame({k: v.reindex(days, fill_value=0.0) for k, v in series.items()})
TR = (M.index.year >= 2022) & (M.index.year <= 2025)
EARLY = M.index.year <= 2021
TEST = M.index.year == 2026
MLL, DLL = 4500.0, 2700.0

def weekly(x): return x.groupby(x.index.to_period('W')).sum()
def dd(x): e = x.cumsum(); return float((e.cummax() - e).max())

cand = [k for k in M.columns if M.loc[TR, k].mean() > 0 and M.loc[EARLY, k].mean() > 0]
print(len(cand), 'versions positive in both 2022-2025 and the earlier years')
port = {}; base = pd.Series(0.0, index=M.index)
for step in range(8):
    best = None
    for k in cand:
        if k in port: continue
        for q in (1, 2, 3, 5, 8, 12, 20, 30, 50):
            if sum(port.values()) + q > 100: break
            x = (base + M[k] * q).clip(lower=-DLL)
            if dd(x[TR]) > 0.75 * MLL: break
            wk = weekly(x[TR]).mean()
            if best is None or wk > best[0]: best = (wk, k, q)
    if not best or best[0] <= weekly(base[TR].clip(lower=-DLL)).mean() + 1: break
    port[best[1]] = best[2]; base = base + M[best[1]] * best[2]
    print(f'add {best[1]} x{best[2]} micros -> 2022-2025 avg week ${best[0]:,.0f}', flush=True)

def grade(x, label):
    x = x.clip(lower=-DLL)
    eq, floor, blown = 0.0, -MLL, 0
    for p in x.values:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue
        if eq > 0: floor = max(floor, min(0.0, eq - MLL))
    w = weekly(x)
    print(f'{label}: avg week ${w.mean():,.0f}, median week ${w.median():,.0f}, winning weeks {100 * (w > 0).mean():.0f}%, weeks >= $1k {int((w >= 1000).sum())}/{len(w)}, '
          f'best day ${x.max():,.0f}, worst day ${x.min():,.0f}, max drawdown ${dd(x):,.0f}, 150K blown {blown}, total ${x.sum():,.0f}')
print('\nPORTFOLIO:', port)
grade(base[TR], 'CHOSEN ON 2022-2025')
grade(base[EARLY & (M.index.year >= 2012)], 'CHECK 2012-2021')
grade(base[TEST], 'UNSEEN 2026 (graded once)')
