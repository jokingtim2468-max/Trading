# usage: python3 gold_reversals.py <XAUUSD M5 export .csv> [contracts=2]
# Gold reversal patterns, each traded only after confirmation, on a LucidFlex 50K (same rules and costs as
# gold_double_top.py): 15-minute chart, entries 03:00-15:30 ET, flat 16:40, $1,200 DLL, $2,000 EOD trailing max loss.
#   triple_top / triple_bottom : three swing highs (lows) within 0.25 ATR, confirmed by a close through the neckline
#   head_shoulders / inverse   : head above both shoulders, shoulders within 0.5 ATR, close through the neckline
#   pdh_pdl_sweep              : price trades through yesterday's high (low) then closes back inside -> fade it
#   asia_sweep                 : London/NY takes the Asian range high (low) then closes back inside -> fade it
#   round_number_reject        : a wick through a $10 level that closes back on the other side -> fade it
#   rsi_divergence             : a higher swing high with a lower RSI(14) (or the mirror), confirmed by a close
#                                beyond the bar before -> reverse
# Stop: just past the pattern's extreme. Targets tested: 1R, 2R and the measured move (pattern height).
import sys, numpy as np, pandas as pd
Q = int(sys.argv[2]) if len(sys.argv) > 2 else 2
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
m5 = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
m5 = m5[m5.index.weekday < 5]
b = m5.resample('15min').agg({'o': 'first', 'h': 'max', 'l': 'min', 'c': 'last'}).dropna()
pc = b.c.shift(1); b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
d_ = b.c.diff(); up = d_.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean(); dn = (-d_.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
b['rsi'] = 100 - 100 / (1 + up / dn)
b['day'] = b.index.normalize(); mins = (b.index.hour * 60 + b.index.minute).values
dd = b.groupby('day').agg(dh=('h', 'max'), dl=('l', 'min')); b = b.join(dd.shift(1).rename(columns={'dh': 'pdh', 'dl': 'pdl'}), on='day')
asia = b[mins < 180].groupby('day').agg(ah=('h', 'max'), al=('l', 'min')); b = b.join(asia, on='day')
o, h, l, c, a, rsi = (b[k].values for k in ('o', 'h', 'l', 'c', 'atr', 'rsi'))
pdh, pdl, ah, al = b.pdh.values, b.pdl.values, b.ah.values, b.al.values
day = b.day.values; n = len(c)
ph = np.zeros(n, bool); pl = np.zeros(n, bool)
ph[1:-1] = (h[1:-1] > h[:-2]) & (h[1:-1] >= h[2:]); pl[1:-1] = (l[1:-1] < l[:-2]) & (l[1:-1] <= l[2:])

def find(i, kind):
    """-> (side, stop, height) when pattern `kind` confirms on bar i"""
    if not (180 <= mins[i] < 930) or not a[i] > 0: return None
    A = a[i]
    if kind in ('triple', 'hs'):
        for side, piv, ext in ((-1, ph, h), (1, pl, l)):
            idx = np.flatnonzero(piv[max(0, i - 80):i - 1]) + max(0, i - 80)
            if len(idx) < 3: continue
            p1, p2, p3 = idx[-3:]
            if i - p3 > 12 or p3 - p1 < 8: continue
            e1, e2, e3 = ext[p1], ext[p2], ext[p3]
            if kind == 'triple' and max(e1, e2, e3) - min(e1, e2, e3) > 0.25 * A: continue
            if kind == 'hs':
                head_ok = (e2 > max(e1, e3) + 0.3 * A) if side < 0 else (e2 < min(e1, e3) - 0.3 * A)
                if not head_ok or abs(e1 - e3) > 0.5 * A: continue
            if side < 0:
                neck = l[p1:p3 + 1].min(); ex = h[p1:p3 + 1].max()
                if c[i] < neck <= c[i - 1]: return (-1, ex + 0.1 * A, ex - neck)
            else:
                neck = h[p1:p3 + 1].max(); ex = l[p1:p3 + 1].min()
                if c[i] > neck >= c[i - 1]: return (1, ex - 0.1 * A, neck - ex)
        return None
    if kind == 'pdh_pdl_sweep':
        if h[i] > pdh[i] and c[i] < pdh[i]: return (-1, h[i] + 0.1 * A, h[i] - l[i])
        if l[i] < pdl[i] and c[i] > pdl[i]: return (1, l[i] - 0.1 * A, h[i] - l[i])
    if kind == 'asia_sweep' and mins[i] >= 180:
        if h[i] > ah[i] and c[i] < ah[i]: return (-1, h[i] + 0.1 * A, ah[i] - al[i])
        if l[i] < al[i] and c[i] > al[i]: return (1, l[i] - 0.1 * A, ah[i] - al[i])
    if kind == 'round_number_reject':
        lv_hi = np.floor(h[i] / 10) * 10; lv_lo = np.ceil(l[i] / 10) * 10
        if h[i] > lv_hi > max(o[i], c[i]) and h[i] - max(o[i], c[i]) > 0.5 * A: return (-1, h[i] + 0.1 * A, h[i] - l[i])
        if l[i] < lv_lo < min(o[i], c[i]) and min(o[i], c[i]) - l[i] > 0.5 * A: return (1, l[i] - 0.1 * A, h[i] - l[i])
    if kind == 'rsi_divergence':
        for side, piv, ext, better in ((-1, ph, h, lambda x, y: x > y), (1, pl, l, lambda x, y: x < y)):
            idx = np.flatnonzero(piv[max(0, i - 40):i - 1]) + max(0, i - 40)
            if len(idx) < 2 or i - idx[-1] > 4: continue
            p1, p2 = idx[-2], idx[-1]
            if better(ext[p2], ext[p1]) and ((rsi[p2] < rsi[p1] - 5) if side < 0 else (rsi[p2] > rsi[p1] + 5)):
                if (side < 0 and c[i] < l[i - 1]) or (side > 0 and c[i] > h[i - 1]): return (side, ext[p2] + side * -0.1 * A * -1 if False else (ext[p2] + 0.1 * A if side < 0 else ext[p2] - 0.1 * A), abs(ext[p2] - c[i]))
    return None

SLIP, COMM, MLL, DLL = 0.20, 1.50, 2000.0, 1200.0
def run(kind, tmode):
    trades = []; i = 100
    while i < n - 2:
        sig = find(i, kind)
        if not sig: i += 1; continue
        s, stop, height = sig; e = o[i + 1] + s * SLIP; risk = abs(e - stop)
        if risk <= 0: i += 1; continue
        tgt = e + s * (risk if tmode == '1R' else 2 * risk if tmode == '2R' else max(height, 0.5 * risk))
        d0 = day[i + 1]; res = None; j = i + 1
        while j < n and day[j] == d0 and mins[j] <= 16 * 60 + 40:
            if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): res = stop - s * SLIP; break
            if (s > 0 and h[j] >= tgt) or (s < 0 and l[j] <= tgt): res = tgt - s * SLIP; break
            j += 1
        if res is None: j = min(j, n - 1); res = c[j - 1] - s * SLIP
        worst = (l[i + 1:j + 1].min() - e) if s > 0 else (e - h[i + 1:j + 1].max())
        trades.append((pd.Timestamp(d0), (res - e) * s * 10 * Q - COMM * Q, min(0, worst) * 10 * Q))
        i = j + 1
    return pd.DataFrame(trades, columns=['d', 'pnl', 'worst'])

def report(T, lo, hi):
    D = T[(T.d.dt.year >= lo) & (T.d.dt.year <= hi)].groupby('d').agg(pnl=('pnl', 'sum'), worst=('worst', 'min'))
    if D.empty: return 'no trades'
    u = np.where(D.worst.values <= -DLL, -DLL, D.pnl.values); eq, fl, bl = 0.0, -MLL, 0
    for p in u:
        eq += p
        if eq <= fl: bl += 1; eq, fl = 0.0, -MLL; continue
        if eq > 0: fl = max(fl, min(0.0, eq - MLL))
    weeks = (pd.Timestamp(f'{hi}-12-31' if hi < 2026 else '2026-10-16') - pd.Timestamp(f'{lo}-01-01')).days / 7
    e = np.cumsum(u)
    return f'avg week ${u.sum() / weeks:+,.0f}, drawdown ${float(np.max(np.maximum.accumulate(e) - e)):,.0f}, blown {bl}, total ${u.sum():+,.0f}'

for kind in ('triple', 'hs', 'pdh_pdl_sweep', 'asia_sweep', 'round_number_reject', 'rsi_divergence'):
    for tmode in ('1R', '2R', 'measured'):
        T = run(kind, tmode)
        if T.empty: print(kind, tmode, 'no trades'); continue
        print(f"{kind:20s} {tmode:8s} {len(T):5d} trades win {100 * (T.pnl > 0).mean():3.0f}% | 2004-18: {report(T, 2004, 2018)} | 2019-25: {report(T, 2019, 2025)} | 2026: {report(T, 2026, 2026)}", flush=True)
