# usage: python3 scripts/xau-quant-stats.py <MT5 M5 export .csv> <out folder>
# Builds the XAUUSD "quant data": M5, M15, H1, H4 and D1 bars from the M5 export, then per timeframe the numbers an
# indicator needs: typical range and ATR by hour and weekday, session ranges, how often a bar continues the last one,
# return spread, and how volatility changed by year. Times are broker time (MT5 server, usually UTC+2/+3).
import sys, os, json
import numpy as np, pandas as pd

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
df = pd.read_csv(src, sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S')
m5 = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values,
                   'v': df['<TICKVOL>'].values, 'sp': df['<SPREAD>'].values}, index=t)

def bars(rule):
    if rule == '5min': return m5
    return m5.resample(rule).agg({'o': 'first', 'h': 'max', 'l': 'min', 'c': 'last', 'v': 'sum', 'sp': 'mean'}).dropna()

def stats(b, name):
    rng = b.h - b.l
    pc = b.c.shift(1)
    tr = np.maximum(rng, np.maximum((b.h - pc).abs(), (b.l - pc).abs()))
    atr = tr.rolling(14).mean()
    ret = np.log(b.c / pc).dropna()
    body = np.sign(b.c - b.o)
    cont = (body == body.shift(1))[body != 0].mean()
    ac = [round(float(ret.autocorr(k)), 4) for k in (1, 2, 3, 6, 12)]
    s = {
        'timeframe': name, 'bars': int(len(b)), 'from': str(b.index[0]), 'to': str(b.index[-1]),
        'range_median': round(float(rng.median()), 3), 'range_p90': round(float(rng.quantile(0.9)), 3),
        'atr14_median': round(float(atr.median()), 3),
        'range_pct_of_price_median': round(float((rng / b.c).median() * 100), 4),
        'return_sd_pct': round(float(ret.std() * 100), 4),
        'continuation_rate': round(float(cont), 4),
        'return_autocorr_lags_1_2_3_6_12': ac,
        'spread_median_points': round(float(b.sp.median()), 1),
    }
    if name in ('M5', 'M15', 'H1'):
        h = pd.DataFrame({'r': rng / b.c * 100, 'up': (b.c > b.o).astype(float), 'hr': b.index.hour})
        s['by_hour'] = {int(k): {'range_pct': round(float(g.r.median()), 4), 'up_rate': round(float(g.up.mean()), 4)} for k, g in h.groupby('hr')}
    if name == 'D1':
        d = pd.DataFrame({'r': rng / b.c * 100, 'ret': ret.reindex(b.index) * 100, 'wd': b.index.weekday, 'y': b.index.year})
        s['by_weekday'] = {int(k): {'range_pct': round(float(g.r.median()), 3), 'mean_ret_pct': round(float(g.ret.mean()), 4)} for k, g in d.groupby('wd')}
        s['by_year'] = {int(k): {'range_pct': round(float(g.r.median()), 3), 'ret_pct': round(float(g.ret.sum()), 1)} for k, g in d.groupby('y')}
    return s

summary = {}
for rule, name in [('5min', 'M5'), ('15min', 'M15'), ('1h', 'H1'), ('4h', 'H4'), ('1D', 'D1')]:
    b = bars(rule)
    if name == 'D1': b = b[b.index.weekday < 5]
    b[['o', 'h', 'l', 'c', 'v']].to_csv(os.path.join(out, f'XAUUSD_{name}.csv.gz'), float_format='%.3f', compression='gzip')
    summary[name] = stats(b, name)
    print(name, len(b), summary[name]['range_median'], summary[name]['continuation_rate'], summary[name]['return_autocorr_lags_1_2_3_6_12'])

# Session ranges (broker time): Asia 01-08, London 09-14, New York 15-22
day = m5.index.normalize()
sess = {}
for nm, (a, z) in {'asia': (1, 8), 'london': (9, 14), 'newyork': (15, 22)}.items():
    x = m5[(m5.index.hour >= a) & (m5.index.hour < z)]
    r = x.groupby(x.index.normalize()).agg(h=('h', 'max'), l=('l', 'min'), c=('c', 'last'))
    sess[nm] = {'range_pct_median': round(float(((r.h - r.l) / r.c * 100).median()), 3)}
summary['sessions'] = sess
json.dump(summary, open(os.path.join(out, 'xau-quant-summary.json'), 'w'), indent=1)
print('sessions', sess)
