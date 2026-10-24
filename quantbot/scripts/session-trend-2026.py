# usage: python3 scripts/session-trend-2026.py <XAUUSD M5 export> <NQ M5 export>
# Lucid requires every position closed by 4:45 PM ET, but a position opened at the 6:00 PM ET reopen and closed by
# 4:40 PM ET the next day follows that rule. So a daily trend signal can be traded per session: re-enter in the trend's
# direction at 18:00, flat by 16:40. Tested on gold (MGC) and NQ (MNQ):
#   signals on the session close: EMA fast/slow, close vs EMA(n), Donchian-n breakout state; long-only or both sides
#   protective stop k x daily ATR from the session open (checked on the session high/low, stop first), exit 16:40
#   size: micros = budget / (daily ATR x $ per point); budget chosen on 2012-2025 so drawdown <= 75% of $4,500
#   costs: slippage (gold $0.20, NQ 0.5 pt) each side + $1.50 per micro, every session
# CHOOSE on 2012-2025, GRADE 2026 once.
import sys, itertools, numpy as np, pandas as pd
MK = {'XAUUSD': dict(f=sys.argv[1], pv=10.0, slip=0.20), 'NQ': dict(f=sys.argv[2], pv=2.0, slip=0.50)}
MLL, DLL = 4500.0, 2700.0

def sessions(f):
    df = pd.read_csv(f, sep='\t')
    t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
    b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
    mins = b.index.hour * 60 + b.index.minute
    b = b[(mins >= 18 * 60) | (mins <= 16 * 60 + 40)].copy()
    b['s'] = (b.index + pd.Timedelta(hours=6)).normalize()
    S = b.groupby('s').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
    S = S[(S.n > 150) & (S.index.weekday < 5)].copy()
    pc = S.c.shift(1)
    S['atr'] = np.maximum(S.h - S.l, np.maximum((S.h - pc).abs(), (S.l - pc).abs())).rolling(20).mean().shift(1)
    return S.dropna()

def signal(S, kind, n, both):
    c = S.c
    if kind == 'ema':
        sig = np.sign(c.ewm(span=max(2, n // 4)).mean() - c.ewm(span=n).mean())
    elif kind == 'above':
        sig = np.sign(c - c.ewm(span=n).mean())
    else:
        hi, lo = c.rolling(n).max().shift(1), c.rolling(n).min().shift(1)
        raw = pd.Series(np.where(c > hi, 1.0, np.where(c < lo, -1.0, np.nan)), index=S.index)
        sig = raw.ffill().fillna(0.0)
    sig = sig.shift(1).fillna(0.0)          # decided on the previous session's close
    if not both: sig = sig.clip(lower=0)
    return sig.values

def per_micro(S, m, sig, k):
    o, h, l, c, a = S.o.values, S.h.values, S.l.values, S.c.values, S.atr.values
    out = np.zeros(len(S))
    for i in range(len(S)):
        s = sig[i]
        if s == 0: continue
        e = o[i] + s * m['slip']; stop = e - s * k * a[i]
        hit = (l[i] <= stop) if s > 0 else (h[i] >= stop)
        ex = stop if hit else c[i]
        out[i] = ((ex - e) * s - m['slip']) * m['pv'] - 1.5
    return out

def account(x):
    x = x.clip(lower=-DLL); eq, floor, blown = 0.0, -MLL, 0
    for p in x.values:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue
        if eq > 0: floor = max(floor, min(0.0, eq - MLL))
    w = x.groupby(x.index.to_period('W')).sum(); e = x.cumsum()
    return dict(avg_week=round(w.mean()), median_week=round(w.median()), win_weeks=round(100 * (w > 0).mean()),
                weeks_1k=f"{int((w >= 1000).sum())}/{len(w)}", best_day=round(x.max()), worst_day=round(x.min()),
                max_dd=round(float((e.cummax() - e).max())), blown=blown, total=round(x.sum()))

rows = []
for mkt, m in MK.items():
    S = sessions(m['f'])
    unit = (S.atr * m['pv']).values             # $ move of 1 micro on a normal session
    for kind, n, both, k in itertools.product(['ema', 'above', 'donch'], [20, 50, 100, 200], [False, True], [1.0, 2.0, 3.0]):
        pm = per_micro(S, m, signal(S, kind, n, both), k)
        tr = (S.index.year >= 2012) & (S.index.year <= 2025)
        # size by volatility: micros = budget / unit, budget the largest that keeps 2012-2025 drawdown under 75% of MLL
        best = None
        for budget in (50, 100, 150, 200, 300, 400, 600, 800, 1000, 1500):
            q = np.clip(np.floor(budget / unit), 1, 100)
            x = pd.Series(pm * q, index=S.index)
            xt = x[tr].clip(lower=-DLL); e = xt.cumsum()
            if best is not None and float((e.cummax() - e).max()) > 0.75 * MLL: break
            best = (budget, x)   # the smallest budget is always kept (1 micro minimum), even if it overshoots
        budget, x = best
        w = x[tr].groupby(x[tr].index.to_period('W')).sum().mean()
        early = x[(S.index.year >= 2012) & (S.index.year <= 2018)].mean(); late = x[(S.index.year >= 2019) & (S.index.year <= 2025)].mean()
        rows.append(dict(mkt=mkt, kind=kind, n=n, both=both, k=k, budget=budget, train_week=w, early=early, late=late, x=x))
    print(mkt, 'done', flush=True)

ok = [r for r in rows if r['early'] > 0 and r['late'] > 0]
ok.sort(key=lambda r: -r['train_week'])
print(f'{len(rows)} versions sized, {len(ok)} positive in both 2012-2018 and 2019-2025')
for r in ok[:8]:
    print(f"  {r['mkt']} {r['kind']} n={r['n']} both={r['both']} stop={r['k']}ATR budget=${r['budget']}: 2012-2025 avg week ${r['train_week']:,.0f}")
if ok:
    top = ok[0]; x = top['x']
    # combine the best gold and the best NQ version (both chosen on 2012-2025) when they fit together
    other = next((r for r in ok if r['mkt'] != top['mkt']), None)
    print('\nCHOSEN:', {k: top[k] for k in ('mkt', 'kind', 'n', 'both', 'k', 'budget')})
    print('  2012-2025:', account(x[(x.index.year >= 2012) & (x.index.year <= 2025)]))
    print('  2026 (graded once):', account(x[x.index.year == 2026]))
    if other:
        y = x.add(other['x'], fill_value=0.0)
        print('\nCHOSEN + best of the other market:', {k: other[k] for k in ('mkt', 'kind', 'n', 'both', 'k', 'budget')})
        print('  2012-2025:', account(y[(y.index.year >= 2012) & (y.index.year <= 2025)]))
        print('  2026 (graded once):', account(y[y.index.year == 2026]))
