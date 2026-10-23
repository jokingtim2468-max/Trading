# usage: python3 scripts/xau-indicator-research.py <MT5 M5 export .csv> <out.json>
# Searches signal ideas for an XAUUSD M5 / M15 indicator on 2004-2026 data, with honest splits:
#   pick on 2004-2018 (train), check on 2019-2022 (validation), report 2023-2026 (test, never used to choose).
# Every trade enters on the NEXT bar's open, pays the bar's spread (0.30 when the export has none) plus 0.10 slippage,
# and exits on a stop (k x ATR14), a target (R x stop) or after max_hold bars. When stop and target are hit in the
# same bar the stop counts (worst case). Higher-timeframe values use only closed bars (shifted one bar).
import sys, json, itertools
import numpy as np, pandas as pd

src, out = sys.argv[1], sys.argv[2]
df = pd.read_csv(src, sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S')
m5 = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values,
                   'sp': df['<SPREAD>'].values}, index=t)

def resample(rule):
    if rule == '5min': return m5
    return m5.resample(rule).agg({'o': 'first', 'h': 'max', 'l': 'min', 'c': 'last', 'sp': 'mean'}).dropna()

def atr(b, n=14):
    pc = b.c.shift(1)
    tr = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs()))
    return tr.rolling(n).mean()

def rsi(c, n):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1 / n).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1 / n).mean()
    return 100 - 100 / (1 + up / dn)

def htf(b, rule, fn):
    # value of a higher timeframe, known only once its bar has closed, mapped onto b's bars
    x = resample(rule)
    v = fn(x).shift(1)
    v.index = v.index + pd.tseries.frequencies.to_offset(rule)  # stamp at the bar's close time
    return v.reindex(b.index, method='ffill')

def frame(rule):
    b = resample(rule).copy()
    b['atr'] = atr(b)
    b['ema20'] = b.c.ewm(span=20).mean(); b['ema50'] = b.c.ewm(span=50).mean(); b['ema200'] = b.c.ewm(span=200).mean()
    b['rsi2'] = rsi(b.c, 2); b['rsi14'] = rsi(b.c, 14)
    b['hh20'] = b.h.rolling(20).max().shift(1); b['ll20'] = b.l.rolling(20).min().shift(1)
    # higher-timeframe trend: H4 EMA50 vs EMA200, and the daily close against its 50-day EMA
    b['h4_trend'] = htf(b, '4h', lambda x: np.sign(x.c.ewm(span=50).mean() - x.c.ewm(span=200).mean()))
    b['d1_trend'] = htf(b, '1D', lambda x: np.sign(x.c - x.c.ewm(span=50).mean()))
    b['h1_trend'] = htf(b, '1h', lambda x: np.sign(x.c.ewm(span=20).mean() - x.c.ewm(span=50).mean()))
    # day's running high/low so far and yesterday's high/low
    day = b.index.normalize()
    b['pdh'] = htf(b, '1D', lambda x: x.h); b['pdl'] = htf(b, '1D', lambda x: x.l)
    b['hr'] = b.index.hour
    b['year'] = b.index.year
    return b.dropna()

def signals(b, idea, p):
    up, dn = b.h4_trend.values > 0, b.h4_trend.values < 0
    if p.get('d1'): up &= b.d1_trend.values > 0; dn &= b.d1_trend.values < 0
    if p.get('h1'): up &= b.h1_trend.values > 0; dn &= b.h1_trend.values < 0
    sess = (b.hr.values >= p['s0']) & (b.hr.values < p['s1'])
    c, o, h, l = b.c.values, b.o.values, b.h.values, b.l.values
    if idea == 'pullback':
        # trend pullback: RSI(2) dips under the threshold, then the bar closes back above the prior high (long)
        r = b.rsi2.values; pr = np.roll(r, 1); ph, pl = np.roll(h, 1), np.roll(l, 1)
        lg = up & (pr < p['th']) & (c > ph); sh = dn & (pr > 100 - p['th']) & (c < pl)
    elif idea == 'ema_touch':
        # pullback to EMA20 in an EMA20>EMA50 trend, close back on the trend side
        e20, e50 = b.ema20.values, b.ema50.values
        lg = up & (e20 > e50) & (l <= e20) & (c > e20) & (c > o); sh = dn & (e20 < e50) & (h >= e20) & (c < e20) & (c < o)
    elif idea == 'breakout':
        lg = up & (c > b.hh20.values); sh = dn & (c < b.ll20.values)
    elif idea == 'pdhl':
        # yesterday's high / low broken in the trend direction
        lg = up & (c > b.pdh.values) & (np.roll(c, 1) <= b.pdh.values); sh = dn & (c < b.pdl.values) & (np.roll(c, 1) >= b.pdl.values)
    elif idea == 'fade':
        # short-horizon mean reversion: fade a bar over m x ATR against... nothing (no trend filter)
        big = (h - l) > p['th'] / 10 * b.atr.values
        lg = big & (c < o); sh = big & (c > o)
    side = np.where(lg & sess, 1, np.where(sh & sess, -1, 0))
    if not p.get('short', True): side[side < 0] = 0
    return side

def simulate(b, side, p):
    o, h, l, c, a, sp, yr = b.o.values, b.h.values, b.l.values, b.c.values, b.atr.values, b.sp.values, b.year.values
    n = len(c); res = []; i = 0
    idx = np.flatnonzero(side)
    k = 0
    while k < len(idx):
        i = idx[k]
        if i + 2 >= n: break
        s = side[i]; e = o[i + 1]; risk = p['k'] * a[i]
        if risk <= 0: k += 1; continue
        cost = (sp[i] * 0.01 if sp[i] > 0 else 0.30) + 0.10
        stop = e - s * risk; tp = e + s * p['R'] * risk
        end = min(n, i + 1 + p['hold'])
        hh, ll = h[i + 1:end], l[i + 1:end]
        hit_s = np.flatnonzero(ll <= stop) if s > 0 else np.flatnonzero(hh >= stop)
        hit_t = np.flatnonzero(hh >= tp) if s > 0 else np.flatnonzero(ll <= tp)
        js = hit_s[0] if len(hit_s) else 10**9; jt = hit_t[0] if len(hit_t) else 10**9
        if js <= jt and js < 10**9: r, j = -1.0, js
        elif jt < 10**9: r, j = p['R'], jt
        else: j = end - i - 2; r = (c[end - 1] - e) * s / risk
        res.append((yr[i], r - cost / risk, i))
        nxt = i + 1 + j + 1
        k = np.searchsorted(idx, nxt)
    return res

def st(res, lo, hi):
    R = np.array([r for y, r, _ in res if lo <= y <= hi])
    if len(R) < 30: return {'n': int(len(R))}
    eq = np.cumsum(R); dd = float(np.max(np.maximum.accumulate(eq) - eq))
    yrs = hi - lo + 1
    return {'n': int(len(R)), 'per_year': round(len(R) / yrs, 1), 'win': round(float((R > 0).mean() * 100), 1),
            'avgR': round(float(R.mean()), 3), 'pf': round(float(R[R > 0].sum() / max(1e-9, -R[R <= 0].sum())), 2),
            'totR': round(float(R.sum()), 1), 'ddR': round(dd, 1)}

GRID = {
    'pullback': {'th': [5, 10, 20]},
    'ema_touch': {'th': [0]},
    'breakout': {'th': [0]},
    'pdhl': {'th': [0]},
    'fade': {'th': [25, 35]},
}
from multiprocessing import Pool
B = {}
def one(args):
    tf, idea, p = args
    b = B[tf]
    res = simulate(b, signals(b, idea, p), p)
    return {'tf': 'M5' if tf == '5min' else 'M15', 'idea': idea, **p,
            'train': st(res, 2004, 2018), 'val': st(res, 2019, 2022), 'test': st(res, 2023, 2026)}

jobs = []
for tf in ['5min', '15min']:
    B[tf] = frame(tf)
    print(tf, len(B[tf]), flush=True)
    for idea, g in GRID.items():
        for th, d1, h1, (s0, s1), k_, R, short in itertools.product(g['th'], [False, True], [False, True], [(8, 20), (14, 20), (0, 24)],
                                                                     [1.0, 2.0], [1.5, 3.0], [True, False]):
            if idea == 'fade' and (d1 or h1): continue
            jobs.append((tf, idea, dict(th=th, d1=d1, h1=h1, s0=s0, s1=s1, k=k_, R=R, short=short, hold=96 if tf == '5min' else 64)))
print(len(jobs), 'versions', flush=True)
with Pool(4) as pool:
    results = pool.map(one, jobs, chunksize=4)
json.dump(results, open(out, 'w'))

# Choose on train + validation only: both must be positive with enough trades, rank by the worse of the two
def ok(s): return s.get('n', 0) >= 60 and s.get('avgR', -1) > 0
good = [r for r in results if ok(r['train']) and ok(r['val'])]
good.sort(key=lambda r: -min(r['train']['avgR'], r['val']['avgR']))
print(f'{len(results)} versions, {len(good)} positive on both train and validation')
for r in good[:25]:
    print(r['tf'], r['idea'], {k: r[k] for k in ('th', 'd1', 'h1', 's0', 's1', 'k', 'R', 'short')}, 'TRAIN', r['train'], 'VAL', r['val'], 'TEST', r['test'])
