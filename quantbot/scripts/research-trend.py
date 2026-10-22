# usage: python3 scripts/research-trend.py <MT5 M5 export> <cost per round trip> <first late-period date> <tag>
# Multi-day trend systems on daily bars. Entry on the close, next-day fills ignored (enter at close, conservative cost).
# Exits: fixed 1:2 (stop k x ATR, target 2x stop) or trend (trailing k x ATR stop). Costs in price per round trip.
import pandas as pd, numpy as np, sys, itertools
def daily(path):
    df = pd.read_csv(path, sep='\t')
    t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
    x = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
    d = x.resample('1D').agg({'o': 'first', 'h': 'max', 'l': 'min', 'c': 'last'}).dropna()
    return d[d.index.weekday < 5]
def sim(d, P, cost):
    h, l, c = d.h.values, d.l.values, d.c.values
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    atr = pd.Series(tr).rolling(20).mean().values
    n = len(c); out = []; pos = 0
    if P['sig'] == 'donch':
        hh = pd.Series(h).rolling(P['n']).max().shift(1).values; ll = pd.Series(l).rolling(P['n']).min().shift(1).values
    else:
        f = pd.Series(c).ewm(span=P['n'] // 4).mean().values; s = pd.Series(c).ewm(span=P['n']).mean().values
    i = 60
    while i < n - 1:
        if P['sig'] == 'donch': side = 1 if c[i] > hh[i] else -1 if c[i] < ll[i] else 0
        else: side = 1 if f[i] > s[i] and f[i - 1] <= s[i - 1] else -1 if f[i] < s[i] and f[i - 1] >= s[i - 1] else 0
        if side == 0 or np.isnan(atr[i]): i += 1; continue
        if P['long_only'] and side < 0: i += 1; continue
        e = c[i]; risk = P['k'] * atr[i]; stop = e - side * risk; tp = e + side * 2 * risk; r = None; j = i + 1
        while j < n:
            if (side == 1 and l[j] <= stop) or (side == -1 and h[j] >= stop): r = (stop - e) * side / risk; break
            if P['exit'] == 'fixed' and ((side == 1 and h[j] >= tp) or (side == -1 and l[j] <= tp)): r = 2.0; break
            if P['exit'] == 'trail':
                stop = max(stop, c[j] - risk) if side == 1 else min(stop, c[j] + risk)
            if j - i >= P['maxhold']: r = (c[j] - e) * side / risk; break
            j += 1
        if r is None: break
        out.append((d.index[i], r - cost / risk, j - i)); i = j + 1
    return out
def st(res):
    if len(res) < 10: return dict(n=len(res))
    R = np.array([x[1] for x in res]); eq = np.cumsum(R); dd = np.max(np.maximum.accumulate(eq) - eq)
    return dict(n=len(R), win=round(100 * (R > 0).mean(), 1), avgR=round(R.mean(), 3), pf=round(R[R > 0].sum() / -R[R <= 0].sum(), 2), totR=round(R.sum(), 1), ddR=round(dd, 1), hold=round(np.mean([x[2] for x in res]), 1))
path, cost, split, tag = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
d = daily(path)
rows = []
for sig, n, k, ex, lo, mh in itertools.product(['donch', 'ema'], [20, 55, 100], [1.5, 3.0], ['fixed', 'trail'], [0, 1], [20, 60]):
    P = dict(sig=sig, n=n, k=k, exit=ex, long_only=lo, maxhold=mh)
    res = sim(d, P, cost)
    a = st([x for x in res if x[0] < pd.Timestamp(split)]); b = st([x for x in res if x[0] >= pd.Timestamp(split)])
    if a.get('n', 0) >= 30: rows.append((a['avgR'], P, a, b))
rows.sort(key=lambda r: -r[0])
print(tag, 'tested', len(rows))
for _, P, a, b in rows[:10]: print(tag, P, '\n   early', a, '\n   late ', b)
