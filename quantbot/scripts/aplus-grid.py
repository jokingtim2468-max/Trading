# usage: python3 scripts/aplus-grid.py <XAUUSD M5 export> <NQ M5 export>
# A+ search, widest version: one trade a day (the first setup of a kind before 15:30 ET), every strategy in
# scripts/strategy-lab.py on gold (MGC) and NQ (MNQ), with/without the 200-EMA trend filter, and for EVERY trade:
#   - stop 0.5 / 1 / 1.5 / 2 / 3 x ATR14 and target 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4 / 5 x the stop (40 pairs), flat at 16:40
#   - every size from 1 to 100 micros
#   - the hindsight numbers: how far each trade went for (MFE) and against (MAE) before the close, in stops. A "best
#     TP per trade" is only known after the fact, so it is reported, never used to choose.
# CHOOSE on the years before 2026 (both halves positive, never blown on LucidFlex 150K), the best average week.
# GRADE once on 2026. Costs: slippage (gold $0.20, NQ 0.5 pt) each side + $1.50 per micro.
import sys, itertools, numpy as np, pandas as pd
src = open(__file__.replace('aplus-grid.py', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
ARGS = sys.argv[:]
sys.argv = ['x', ARGS[1], ARGS[2], '/dev/null']
g = {}; exec(src, g)
MLL, DLL = 4500.0, 2700.0
KS = [0.5, 1.0, 1.5, 2.0, 3.0]; RS = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]
SIZES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100]

def entries(x, m, s, p, trend):
    side, _, _ = g['signals'](x, m, s, p)
    if trend: side = np.where(side == np.sign(x.c.values - x.e200.values), side, 0)
    side = np.where(x.mins.values < 15 * 60 + 30, side, 0)
    idx = np.flatnonzero(side); days = x.day.values
    first = {}
    for i in idx:
        d = days[i]
        if d not in first: first[d] = i
    return [(d, i, side[i]) for d, i in first.items()]

def outcomes(x, m, ents):
    """per trade: points result for each (k, R) pair, plus MFE/MAE in ATR units"""
    o, h, l, c, atr, last = x.o.values, x.h.values, x.l.values, x.c.values, x.atr.values, x.last.values
    res = []
    for d, i, s in ents:
        if i + 1 > last[i] or not (atr[i] > 0): continue
        e = o[i + 1] + s * m['slip']; a = atr[i]
        hh, ll = h[i + 1:last[i] + 1], l[i + 1:last[i] + 1]
        fav = np.maximum.accumulate((hh - e) if s > 0 else (e - ll))
        adv = np.maximum.accumulate((e - ll) if s > 0 else (hh - e))
        close_pts = (c[last[i]] - e) * s - m['slip']
        pts = {}
        for k in KS:
            js = np.searchsorted(adv, k * a, side='left')          # first bar where the stop is hit
            for R in RS:
                jt = np.searchsorted(fav, R * k * a, side='left')
                if js < len(adv) and js <= jt: r = -k * a - m['slip']
                elif jt < len(fav): r = R * k * a - m['slip']
                else: r = close_pts
                pts[(k, R)] = r
        res.append((pd.Timestamp(d), pts, a, fav[-1] / a, adv[-1] / a))
    return res

def account(day_pnl):
    eq, floor, blown = 0.0, -MLL, 0
    for p in day_pnl:
        p = max(-DLL, p); eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue
        if eq > 0: floor = max(floor, min(0.0, eq - MLL))
    return blown

results = []; hind = []
for mkt, m in g['MK'].items():
    x = g['prep'](g['load'](m['file']), m); y0 = int(x.year.min()); mid = (y0 + 2025) // 2
    seen = set()
    for s, grid in g['GRID'].items():
        for p in grid:
            q = {k: v for k, v in p.items() if k not in ('k', 'R')}
            for trend in (False, True):
                key = (s, tuple(sorted(q.items())), trend)
                if key in seen: continue
                seen.add(key)
                q2 = dict(q); q2.setdefault('k', 1.0)
                res = outcomes(x, m, entries(x, m, s, q2, trend))
                if len(res) < 150: continue
                hind.append((mkt, s, q, trend, np.median([r[3] for r in res]), np.median([r[4] for r in res])))
                yrs = np.array([r[0].year for r in res])
                for k, R in itertools.product(KS, RS):
                    pts = np.array([r[1][(k, R)] for r in res]); stop_usd = np.array([k * r[2] * m['pv'] for r in res])
                    per_micro = pts * m['pv'] - g['COMM']
                    pre = yrs <= 2025
                    if per_micro[(yrs >= y0) & (yrs <= mid)].mean() <= 0 or per_micro[(yrs > mid) & pre].mean() <= 0: continue
                    for n in SIZES:
                        day_pnl = per_micro * n
                        if account(day_pnl[pre]) > 0: break
                        e = np.cumsum(np.maximum(-DLL, day_pnl[pre])); dd = float(np.max(np.maximum.accumulate(e) - e))
                        if dd > 0.75 * MLL: break
                        weeks_pre = (2025 - y0 + 1) * 52
                        results.append(dict(mkt=mkt, s=s, q=q, trend=trend, k=k, R=R, micros=n, pre_week=day_pnl[pre].sum() / weeks_pre,
                                            risk=float(np.median(stop_usd)) * n, res=res, pm=per_micro, yrs=yrs))
            print(mkt, s, len(results), flush=True)

print(f'\n{len(results)} (setup, stop, target, size) versions positive in both halves before 2026 and never blown')
print('Hindsight (not tradeable): median trade ran this far for / against before the close, in ATRs:')
for h_ in sorted(hind, key=lambda z: -(z[4] - z[5]))[:5]: print(f'   {h_[0]} {h_[1]} {h_[2]} trend={h_[3]}: MFE {h_[4]:.2f} ATR, MAE {h_[5]:.2f} ATR')
results.sort(key=lambda r: -r['pre_week'])
for r in results[:8]:
    print(f"   {r['mkt']} {r['s']} {r['q']} trend={r['trend']} stop {r['k']} ATR, target {r['R']}R, {r['micros']} micros (~${r['risk']:,.0f} risk): before 2026 ${r['pre_week']:,.0f}/week")
if results:
    top = results[0]; t = top['yrs'] == 2026
    dp = pd.Series(top['pm'][t] * top['micros'], index=[r[0] for r, keep in zip(top['res'], t) if keep])
    allw = pd.period_range('2026-01-01', '2026-10-16', freq='W')
    w = dp.groupby(dp.index.to_period('W')).sum().reindex(allw, fill_value=0.0); e = dp.clip(lower=-DLL).cumsum()
    print(f"\nCHOSEN: {top['mkt']} {top['s']} {top['q']} trend={top['trend']} stop {top['k']} ATR target {top['R']}R {top['micros']} micros")
    print(f"2026 (graded once): {len(dp)} trades, win {100 * (dp > 0).mean():.0f}%, avg week ${w.mean():,.0f}, median week ${w.median():,.0f}, "
          f"weeks >= $1k {int((w >= 1000).sum())}/{len(w)}, best day ${dp.max():,.0f}, worst ${dp.min():,.0f}, drawdown ${float((e.cummax() - e).max()):,.0f}, "
          f"blown {account(dp.values)}, total ${dp.sum():,.0f}")
