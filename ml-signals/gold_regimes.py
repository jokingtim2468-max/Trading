# usage: python3 gold_regimes.py <XAUUSD M5 export .csv>
# Does COT positioning, gold implied volatility (GVZ) or inflation tell us when gold's per-session long works?
# Lucid-style session: long at 18:00 ET, flat at 16:40 ET. Regime rules use only data published before the session:
#   COT (CFTC legacy, non-commercial = speculators): net long as % of open interest, its 3-year percentile and weekly change;
#   report date is Tuesday, published Friday -> used from the following Monday.
#   GVZ (Cboe gold volatility): level vs its 1-year median, 5-day change (previous day's close).
#   CPI: year-over-year inflation rising or falling (monthly, used 6 weeks after the reference month).
# Each rule is scored on 2008-2016 and 2017-2025 separately (must be positive in both), 2026 graded once. 1 MGC = 10 oz.
import sys, itertools, numpy as np, pandas as pd
D = 'data/'
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
m = b.index.hour * 60 + b.index.minute
b = b[(m >= 18 * 60) | (m <= 16 * 60 + 40)].copy(); b['s'] = (b.index + pd.Timedelta(hours=6)).normalize()
S = b.groupby('s').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
S = S[(S.n > 150) & (S.index.weekday < 5)].copy()
S['pnl'] = (S.c - S.o - 0.40) * 10; S['worst'] = (S.l - S.o - 0.40) * 10   # 1 MGC

cot = pd.read_csv(D + 'COT_Gold_Only.csv', low_memory=False)
cot = cot[cot['Market_and_Exchange_Names'].str.contains('GOLD', na=False) & ~cot['Market_and_Exchange_Names'].str.contains('MICRO', na=False)]
cot['d'] = pd.to_datetime(cot['Report_Date_as_YYYY_MM_DD'])
cot = cot.groupby('d').first().sort_index()
net = (cot.NonComm_Positions_Long_All - cot.NonComm_Positions_Short_All) / cot.Open_Interest_All * 100
C = pd.DataFrame({'net': net, 'chg': net.diff(), 'pct': net.rolling(156, min_periods=52).apply(lambda x: (x[-1] >= x).mean(), raw=True)})
C.index = C.index + pd.Timedelta(days=6)          # Tuesday data -> usable from Monday after the Friday release
g = pd.read_csv(D + 'GVZCLS.csv'); g['d'] = pd.to_datetime(g.observation_date); g = g.set_index('d').GVZCLS.astype(float).dropna()
G = pd.DataFrame({'gvz': g, 'rel': g / g.rolling(252, min_periods=100).median(), 'chg5': g - g.shift(5)}).shift(1)
cp = pd.read_csv(D + 'CPIAUCSL.csv'); cp['d'] = pd.to_datetime(cp.observation_date); cp = cp.set_index('d').CPIAUCSL.astype(float)
yoy = cp.pct_change(12) * 100; P = pd.DataFrame({'yoy': yoy, 'yoy_up': (yoy > yoy.shift(3)).astype(float)}); P.index = P.index + pd.Timedelta(days=45)
X = S.join(C.reindex(S.index, method='ffill')).join(G.reindex(S.index, method='ffill')).join(P.reindex(S.index, method='ffill'))
X = X[X.index >= '2008-07-01']
y = X.index.year

RULES = {
    'always long (baseline)': np.ones(len(X), bool),
    'COT specs net low (pct < 0.3)': X.pct.values < 0.3, 'COT specs net high (pct > 0.7)': X.pct.values > 0.7,
    'COT specs adding (chg > 0)': X.chg.values > 0, 'COT specs cutting (chg < 0)': X.chg.values < 0,
    'GVZ calm (rel < 1)': X.rel.values < 1, 'GVZ stressed (rel > 1.2)': X.rel.values > 1.2,
    'GVZ falling (5d chg < 0)': X.chg5.values < 0, 'GVZ rising (5d chg > 0)': X.chg5.values > 0,
    'inflation rising': X.yoy_up.values == 1, 'inflation falling': X.yoy_up.values == 0,
}
names = list(RULES)
for a_, b_ in itertools.combinations(names[1:], 2):
    if a_.split(' ')[0] == b_.split(' ')[0]: continue
    RULES[f'{a_} AND {b_}'] = RULES[a_] & RULES[b_]

def score(k, lo, hi):
    sel = k & (y >= lo) & (y <= hi)
    p = np.where(X.worst.values[sel] <= -1200, -1200, X.pnl.values[sel])
    weeks = max(1, ((min(pd.Timestamp(f'{hi}-12-31'), X.index[-1]) - max(pd.Timestamp(f'{lo}-01-01'), X.index[0])).days) / 7)
    e = np.cumsum(p)
    return p.sum() / weeks, float(np.max(np.maximum.accumulate(e) - e)) if len(e) else 0, sel.sum()

rows = []
for name, k in RULES.items():
    a = score(k, 2008, 2016); b2 = score(k, 2017, 2025); x = score(k, 2026, 2026)
    rows.append((min(a[0], b2[0]), name, a, b2, x))
rows.sort(reverse=True)
print(f'{len(RULES)} regime rules, per-session long on 1 MGC (avg $ per week, drawdown, sessions)\n')
for s, name, a, b2, x in rows[:12]:
    ok = 'BOTH +' if a[0] > 0 and b2[0] > 0 else ''
    print(f'{name:70s} 2008-16 ${a[0]:+6.0f}/wk dd ${a[1]:6,.0f} | 2017-25 ${b2[0]:+6.0f}/wk dd ${b2[1]:6,.0f} | 2026 ${x[0]:+6.0f}/wk dd ${x[1]:6,.0f} {ok}')
base = [r for r in rows if r[1].startswith('always')][0]
print(f"\nbaseline (always long): 2008-16 ${base[2][0]:+.0f}/wk, 2017-25 ${base[3][0]:+.0f}/wk, 2026 ${base[4][0]:+.0f}/wk")
