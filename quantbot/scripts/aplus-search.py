# usage: python3 scripts/aplus-search.py <XAUUSD M5 export> <NQ M5 export>
# "A+ only" search for a LucidFlex 150K: at most ONE trade a day, waiting as long as needed (until 15:30 ET) for the
# first setup of a kind, sized as big as the account can survive.
#   setups: every strategy in scripts/strategy-lab.py (ICT silver bullet, FVG/gap, ORB, VWAP, opening drive, sweeps of
#   yesterday's high/low, RSI(2), Bollinger, MACD, EMA, Supertrend, Donchian, inside bar, overnight range, ...) on gold and
#   NQ, each with targets 0.5R / 1R / 2R / 3R and with or without a trend filter (only with the 200-EMA direction)
#   per trade: R multiple after slippage and commission (stop first when both are hit in a bar)
#   CHOOSE on 2012-2025 (gold 2004-2025): needs >= 150 trades and a positive average R in BOTH halves; ranked by the worse
#   half. Size: $ risk so the 2012-2025 drawdown uses at most 75% of the $4,500 max loss (capped by 100 micros).
#   GRADE once on 2026: win rate, average R, weekly $, best/worst day, drawdown, blown 150Ks, and the risk that $1k a week
#   would need.
import sys, itertools, numpy as np, pandas as pd
src = open(__file__.replace('aplus-search.py', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
ARGS = sys.argv[:]
sys.argv = ['x', ARGS[1], ARGS[2], '/dev/null']
g = {}; exec(src, g)
MLL, DLL = 4500.0, 2700.0

def trades_R(x, m, s, p, trend):
    side, stop, tgt = g['signals'](x, m, s, p)
    if trend:
        tdir = np.sign(x.c.values - x.e200.values)
        side = np.where(side == tdir, side, 0)
    tr = g['simulate'](x, m, side, stop, tgt, max_per_day=1)
    out = []
    for d, pts, sd in tr:
        risk_usd = sd * m['pv']
        out.append((pd.Timestamp(d), pts / sd - g['COMM'] / max(risk_usd, 1e-9), risk_usd))
    return out

def stats(rows, lo, hi):
    R = np.array([r for d, r, _ in rows if lo <= d.year <= hi])
    if len(R) == 0: return dict(n=0)
    e = np.cumsum(R)
    return dict(n=len(R), win=round(100 * float((R > 0).mean()), 1), avgR=round(float(R.mean()), 3), ddR=round(float(np.max(np.maximum.accumulate(e) - e)), 1))

rows_all = []
for mkt, m in g['MK'].items():
    x = g['prep'](g['load'](m['file']), m)
    y0 = int(x.year.min())
    for s, grid in g['GRID'].items():
        seen = set()
        for p in grid:
            for R in (0.5, 1.0, 2.0, 3.0):
                q = dict(p); q['R'] = R
                key = (s, tuple(sorted(q.items())))
                if key in seen: continue
                seen.add(key)
                for trend in (False, True):
                    rows = trades_R(x, m, s, q, trend)
                    mid = (y0 + 2025) // 2
                    a, b, full, t26 = stats(rows, y0, mid), stats(rows, mid + 1, 2025), stats(rows, y0, 2025), stats(rows, 2026, 2026)
                    rows_all.append(dict(mkt=mkt, s=s, p=q, trend=trend, a=a, b=b, full=full, t26=t26, rows=rows))
        print(mkt, s, flush=True)

ok = [r for r in rows_all if r['full']['n'] >= 150 and r['a'].get('avgR', -1) > 0 and r['b'].get('avgR', -1) > 0]
ok.sort(key=lambda r: -min(r['a']['avgR'], r['b']['avgR']))
print(f"\n{len(rows_all)} A+ versions, {len(ok)} positive in both halves of the pre-2026 years")
hi_win = sorted([r for r in rows_all if r['full']['n'] >= 150], key=lambda r: -r['full']['win'])[:5]
print('Highest win rates before 2026 (any expectancy):')
for r in hi_win: print(f"   {r['mkt']} {r['s']} {r['p']} trend={r['trend']}: win {r['full']['win']}%, avg {r['full']['avgR']}R, 2026 win {r['t26'].get('win')}% avg {r['t26'].get('avgR')}R")
print('Best by expectancy (chosen on pre-2026 only):')
for r in ok[:8]: print(f"   {r['mkt']} {r['s']} {r['p']} trend={r['trend']}: early {r['a']}, late {r['b']}, 2026 {r['t26']}")

def grade(r, risk):
    eq, floor, blown, days = 0.0, -MLL, 0, {}
    for d, R, _ in r['rows']:
        if d.year != 2026: continue
        pnl = max(-DLL, R * risk)
        eq += pnl; days[d] = pnl
        if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue
        if eq > 0: floor = max(floor, min(0.0, eq - MLL))
    x = pd.Series(days).sort_index()
    if x.empty: return 'no 2026 trades'
    allw = pd.period_range('2026-01-01', '2026-10-16', freq='W')
    w = x.groupby(x.index.to_period('W')).sum().reindex(allw, fill_value=0.0); e = x.cumsum()
    return (f"risk ${risk:,.0f}/trade: avg week ${w.mean():,.0f}, median week ${w.median():,.0f}, winning weeks {100 * (w > 0).mean():.0f}%, "
            f"weeks >= $1k {int((w >= 1000).sum())}/{len(w)}, best day ${x.max():,.0f}, worst ${x.min():,.0f}, drawdown ${float((e.cummax() - e).max()):,.0f}, blown {blown}")

if ok:
    top = ok[0]
    safe = min(0.75 * MLL / max(top['full']['ddR'], 1.0), 100 * min(rr for _, _, rr in top['rows']) if top['rows'] else 1e9)
    per_trade_week = top['full']['n'] / max(1, (2025 - min(d.year for d, _, _ in top['rows']) + 1) * 52)
    need = 1000 / max(1e-9, top['full']['avgR'] * per_trade_week)
    print(f"\nCHOSEN: {top['mkt']} {top['s']} {top['p']} trend={top['trend']}")
    print(f"   before 2026: {top['full']}  ({per_trade_week:.2f} trades a week)")
    print(f"   2026 trades: {top['t26']}")
    print(f"   2026 at the survivable size  -> {grade(top, safe)}")
    print(f"   2026 at the size $1k/week needs on paper -> {grade(top, need)}")
