---
name: python-backtest
description: Load when writing a Python backtest script - a tested template with next-bar fills, stop-first, trailing stop, costs, one trade a day and the account simulation
---

# Python backtest template (copy, then change only the signal)

```python
import sys, json, numpy as np, pandas as pd
SLIP, COMM, PV = 0.20, 1.50, 10.0          # gold MGC: $/oz slippage per side, $ commission per contract, $ per $1 move
def load(path):
    df = pd.read_csv(path, sep='\t')
    t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
    b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
    b = b[b.index.weekday < 5]
    pc = b.c.shift(1)
    b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
    return b
def backtest(b, side, k=1.5, flat_min=16*60+40):
    """side: +1/-1/0 per bar decided on that bar's close. Trailing stop k*ATR, one trade a day, flat by 16:40 ET."""
    o, h, l, c, a = (b[x].values for x in ('o', 'h', 'l', 'c', 'atr'))
    mins = (b.index.hour * 60 + b.index.minute).values; day = b.index.normalize().values
    out, i, n, last_day = [], 0, len(c), None
    while i < n - 1:
        s = side[i]
        if s == 0 or not a[i] > 0 or day[i] == last_day: i += 1; continue
        e = o[i + 1] + s * SLIP; stop = e - s * k * a[i]; best = e; j = i + 1; ex = None
        while j < n and day[j] == day[i] and mins[j] <= flat_min:
            if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): ex = stop - s * SLIP; break   # stop first
            best = max(best, h[j]) if s > 0 else min(best, l[j])
            stop = max(stop, best - k * a[j]) if s > 0 else min(stop, best + k * a[j])
            j += 1
        if ex is None: ex = c[j - 1] - s * SLIP
        out.append((b.index[i], (ex - e) * s * PV - COMM)); last_day = day[i]; i = j + 1
    return pd.DataFrame(out, columns=['t', 'usd']).set_index('t').usd
if __name__ == '__main__':
    b = load(sys.argv[1])
    side = np.zeros(len(b))  # <- your signal here, using only data up to each bar
    r = backtest(b, side)
    by = r.groupby(r.index.year).sum()
    res = {'trades': int(len(r)), 'win_pct': round(100 * (r > 0).mean(), 1), 'by_year': by.round(0).to_dict()}
    print(json.dumps(res, indent=1)); json.dump(res, open('results.json', 'w'), indent=1)
```
Then apply the prop-firm-rules floor simulation to the daily sums, and the splits from backtest-rules.
