# usage: python3 gold_double_top.py <XAUUSD M5 export .csv> [contracts=2]
# Double top / double bottom reversals on gold, traded only after confirmation (a close through the neckline), on
# a LucidFlex 50K: $2,000 EOD trailing max loss, $1,200 daily loss limit, flat by 16:40 ET.
#   chart: 15-minute bars. Swing highs/lows = 3-bar pivots. Double top: two swing highs within 0.25 x ATR(14) of each
#   other, 5-40 bars apart; neckline = the lowest low between them. Confirmed when a bar closes below the neckline
#   (within 12 bars of the second top) -> sell at the next bar's open. Stop just above the higher top; target = the
#   pattern's height below the neckline (measured move). Double bottom = the mirror (buy).
#   entries 03:00-15:30 ET only, one trade at a time, flat 16:40; costs $0.20/oz slippage each side + $1.50 per MGC.
import sys, numpy as np, pandas as pd
Q = int(sys.argv[2]) if len(sys.argv) > 2 else 2
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
b = b[b.index.weekday < 5].resample('15min').agg({'o': 'first', 'h': 'max', 'l': 'min', 'c': 'last'}).dropna()
pc = b.c.shift(1); b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
o, h, l, c, a = (b[k].values for k in ('o', 'h', 'l', 'c', 'atr'))
mins = (b.index.hour * 60 + b.index.minute).values; day = b.index.normalize().values; n = len(c)
ph = np.zeros(n, bool); pl = np.zeros(n, bool)
ph[1:-1] = (h[1:-1] > h[:-2]) & (h[1:-1] >= h[2:]); pl[1:-1] = (l[1:-1] < l[:-2]) & (l[1:-1] <= l[2:])
trades = []; i = 50; SLIP, COMM = 0.20, 1.50
while i < n - 2:
    sig = None
    if 180 <= mins[i] < 930 and a[i] > 0:
        for kind, piv, ext in (('top', ph, h), ('bottom', pl, l)):
            # the latest two pivots that are already confirmed (pivot bar + 1 is before i)
            idx = np.flatnonzero(piv[max(0, i - 60):i - 1]) + max(0, i - 60)
            if len(idx) < 2: continue
            p2 = idx[-1]
            for p1 in idx[-2::-1]:
                gap = p2 - p1
                if gap < 5: continue
                if gap > 40: break
                if abs(ext[p1] - ext[p2]) > 0.25 * a[i]: continue
                if i - p2 > 12: break
                if kind == 'top':
                    neck = l[p1:p2 + 1].min(); top = max(h[p1], h[p2])
                    if c[i] < neck and c[i - 1] >= neck: sig = (-1, top + 0.1 * a[i], neck - (top - neck))
                else:
                    neck = h[p1:p2 + 1].max(); bot = min(l[p1], l[p2])
                    if c[i] > neck and c[i - 1] <= neck: sig = (1, bot - 0.1 * a[i], neck + (neck - bot))
                break
            if sig: break
    if not sig: i += 1; continue
    s, stop, tgt = sig; e = o[i + 1] + s * SLIP; d0 = day[i + 1]; res = None; j = i + 1
    while j < n and day[j] == d0 and mins[j] <= 16 * 60 + 40:
        if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): res = stop - s * SLIP; break
        if (s > 0 and h[j] >= tgt) or (s < 0 and l[j] <= tgt): res = tgt - s * SLIP; break
        j += 1
    if res is None: j = min(j, n - 1); res = c[j - 1] - s * SLIP
    worst_adv = ((l[i + 1:j + 1].min() - e) if s > 0 else (e - h[i + 1:j + 1].max()))
    trades.append((pd.Timestamp(d0), (res - e) * s * 10 * Q - COMM * Q, min(0, worst_adv) * 10 * Q, abs(e - stop) * 10 * Q))
    i = j + 1
T = pd.DataFrame(trades, columns=['d', 'pnl', 'worst', 'risk'])
D = T.groupby('d').agg(pnl=('pnl', 'sum'), worst=('worst', 'min'))
MLL, DLL = 2000.0, 1200.0
print(f'{len(T)} confirmed double tops/bottoms 2004-2026, {Q} MGC each, win rate {100 * (T.pnl > 0).mean():.0f}%, '
      f'average risk per trade ${T.risk.mean():,.0f}, average result ${T.pnl.mean():+,.1f}')
for lo, hi in ((2004, 2011), (2012, 2018), (2019, 2025), (2026, 2026)):
    x = D[(D.index.year >= lo) & (D.index.year <= hi)]
    u = np.where(x.worst.values <= -DLL, -DLL, x.pnl.values)
    eq, fl, bl = 0.0, -MLL, 0
    for p in u:
        eq += p
        if eq <= fl: bl += 1; eq, fl = 0.0, -MLL; continue
        if eq > 0: fl = max(fl, min(0.0, eq - MLL))
    s_ = pd.Series(u, index=x.index); allw = pd.period_range(f'{lo}-01-01', f'{hi}-12-31' if hi < 2026 else '2026-10-16', freq='W')
    w = s_.groupby(s_.index.to_period('W')).sum().reindex(allw, fill_value=0.0); e = s_.cumsum()
    print(f'{lo}-{hi}: {len(x)} trade days, avg week ${w.mean():+,.0f}, typical ${w.median():+,.0f}, winning weeks {100 * (w > 0).mean():.0f}%, '
          f'max drawdown ${float((e.cummax() - e).max()):,.0f}, worst day ${u.min():,.0f}, best day ${u.max():,.0f}, 50K blown {bl}, total ${u.sum():+,.0f}')
