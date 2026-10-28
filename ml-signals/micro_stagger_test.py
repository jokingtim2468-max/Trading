# usage: python3 micro_stagger_test.py <XAUUSD M5 export .csv>
# Backtest of the "Micro-Stagger" rules before building anything around them, on 2004-2026 gold (tick volume):
#   trigger: a 5-minute bar whose volume is >= 5.0x its 20-bar average; trade in that bar's direction at the next open
#   stop: 1.5 x ATR(14), trailed 1.5 ATR behind the best price (no breakeven move); one trade per day; flat 16:40 ET
#   costs: $0.20/oz slippage each side + $1.50 per MGC; 1 MGC. Also tested: 3x / 4x surges and only with the 200-EMA trend.
import sys, numpy as np, pandas as pd
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values,
                  'v': df['<TICKVOL>'].values.astype(float)}, index=t)
b = b[b.index.weekday < 5]
pc = b.c.shift(1)
b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
b['vavg'] = b.v.rolling(20).mean().shift(1); b['e200'] = b.c.ewm(span=200, adjust=False).mean()
o, h, l, c, v, va, a, e2 = (b[k].values for k in ('o', 'h', 'l', 'c', 'v', 'vavg', 'atr', 'e200'))
mins = (b.index.hour * 60 + b.index.minute).values; day = b.index.normalize().values; yrs = b.index.year.values; n = len(c)
def run(mult, trend):
    out = []; i = 300; last_day = None
    while i < n - 2:
        if not (va[i] > 0 and v[i] >= mult * va[i] and c[i] != o[i] and a[i] > 0 and mins[i] <= 15 * 60 + 30) or day[i] == last_day:
            i += 1; continue
        s = 1 if c[i] > o[i] else -1
        if trend and s != np.sign(c[i] - e2[i]): i += 1; continue
        e = o[i + 1] + s * 0.20; stop = e - s * 1.5 * a[i]; best = e; j = i + 1; res = None
        while j < n and day[j] == day[i] and mins[j] <= 16 * 60 + 40:
            if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): res = stop - s * 0.20; break
            best = max(best, h[j]) if s > 0 else min(best, l[j])
            ts = best - s * 1.5 * a[j]
            if (ts - stop) * s > 0: stop = ts
            j += 1
        if res is None: res = c[j - 1] - s * 0.20
        out.append((yrs[i], (res - e) * s * 10 - 1.5)); last_day = day[i]; i = j + 1
    return pd.DataFrame(out, columns=['y', 'usd'])
for mult in (5.0, 4.0, 3.0):
    for trend in (False, True):
        T = run(mult, trend)
        if T.empty: print(mult, trend, 'no trades'); continue
        by = T.groupby('y').usd.sum()
        print(f"{mult}x surge{' + trend' if trend else ''}: {len(T)} trades, win {100 * (T.usd > 0).mean():.0f}%, "
              f"2004-14 ${by[by.index <= 2014].sum():+,.0f}, 2015-25 ${by[(by.index >= 2015) & (by.index <= 2025)].sum():+,.0f}, "
              f"2026 ${by.get(2026, 0):+,.0f}, losing years {(by < 0).sum()}/{len(by)}  (1 MGC)")
