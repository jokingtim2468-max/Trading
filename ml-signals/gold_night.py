# usage: python3 gold_night.py <XAUUSD M5 export .csv>
# Gold overnight drift for Lucid: long at 18:00 ET (the reopen), out at 02:00 ET (before London), every session.
# Optional filters: only when the daily trend is up (EMA 13 > EMA 55), and/or a stop at k x the hourly ATR.
# Lucid rules per account (EOD trailing max loss, DLL on the worst open point), whole MGC contracts; size = most MGC whose
# 2004-2018 drawdown stays under 75% of the max loss. Chosen on 2004-2018, checked 2019-2025, 2026 graded once.
import sys, itertools, numpy as np, pandas as pd
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
b = b[b.index.weekday < 5]
COST = 0.40
day = b.c.resample('1D').last().dropna(); f = day.ewm(span=13, adjust=False).mean(); s5 = day.ewm(span=55, adjust=False).mean()
up = (f > s5).shift(1)   # known at the previous close
m = b.index.hour * 60 + b.index.minute
rows = []
for start, end in ((18 * 60, 2 * 60), (18 * 60, 4 * 60), (17 * 60 + 0, 2 * 60)):
    pass
win = b[(m >= 18 * 60) | (m < 2 * 60)].copy(); win['s'] = (win.index + pd.Timedelta(hours=6)).normalize()
G = win.groupby('s').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
G = G[G.n >= 60]
G['up'] = up.reindex(G.index - pd.Timedelta(days=1), method='ffill').values
hr = b.h.resample('1h').max() - b.l.resample('1h').min(); hatr = hr.rolling(24 * 20).mean()
G['hatr'] = hatr.reindex(G.index - pd.Timedelta(hours=6), method='ffill').values
y = G.index.year.values; W = G.index.to_period('W')
ACC = {'25K': (1000, 600), '50K': (2000, 1200), '100K': (3000, 1800), '150K': (4500, 2700)}

def sess(trend, k):
    keep = (G.up.values == True) if trend else np.ones(len(G), bool)
    pnl = (G.c - G.o).values - COST; worst = (G.l - G.o).values - COST
    if k:
        stp = k * G.hatr.values; hit = (G.o - G.l).values >= stp
        pnl = np.where(hit, -stp - COST, pnl); worst = np.maximum(worst, -stp - COST)
    return np.where(keep, pnl, 0.0), np.where(keep, worst, 0.0)

def play(pnl, worst, q, mll, dll, k):
    u = np.where(worst[k] * 10 * q <= -dll, -dll, pnl[k] * 10 * q)
    eq, fl, bl = 0.0, -mll, 0
    for p in u:
        eq += p
        if eq <= fl: bl += 1; eq, fl = 0.0, -mll; continue
        if eq > 0: fl = max(fl, min(0.0, eq - mll))
    e = np.cumsum(u); w = pd.Series(u, index=W[k]).groupby(level=0).sum()
    return w.mean(), w.median(), 100 * (w > 0).mean(), float(np.max(np.maximum.accumulate(e) - e)), u.min(), bl, u.sum()

TR, A, B, V, X = y <= 2018, y <= 2011, (y >= 2012) & (y <= 2018), (y >= 2019) & (y <= 2025), y == 2026
for acct, (mll, dll) in ACC.items():
    best = None
    for trend, k in itertools.product([False, True], [0, 1.0, 1.5, 2.0, 3.0]):
        pnl, worst = sess(trend, k)
        for q in range(1, 21):
            r = play(pnl, worst, q, mll, dll, TR)
            if r[5] or r[3] > 0.75 * mll: break
            if play(pnl, worst, q, mll, dll, A)[6] <= 0 or play(pnl, worst, q, mll, dll, B)[6] <= 0: continue
            if best is None or r[0] > best[0][0]: best = (r, dict(trend_filter=trend, stop_hatr=k, mgc=q), pnl, worst)
    if best is None: print(f'{acct}: nothing fits (even 1 MGC breaks the 2004-2018 rules)'); continue
    r, P, pnl, worst = best
    print(f'{acct} {P}')
    for lab, k in (('2004-2018 (chosen)', TR), ('2019-2025 (check)', V), ('2026 (exam)', X)):
        wk, med, ww, dd, wd, bl, tot = play(pnl, worst, P['mgc'], mll, dll, k)
        print(f'   {lab}: avg week ${wk:,.0f}, typical ${med:,.0f}, winning weeks {ww:.0f}%, max drawdown ${dd:,.0f}, worst day ${wd:,.0f}, blown {bl}, total ${tot:,.0f}')

print('\n1 MGC, every filter, LucidFlex 150K rules:')
for trend, k in itertools.product([False, True], [0, 1.0, 2.0, 3.0]):
    pnl, worst = sess(trend, k)
    out = []
    for lab, kk in (('04-11', A), ('12-18', B), ('19-25', V), ('2026', X)):
        wk, med, ww, dd, wd, bl, tot = play(pnl, worst, 1, 4500, 2700, kk)
        out.append(f'{lab} ${tot:+,.0f} dd ${dd:,.0f}')
    print(f'  trend={trend!s:5} stop={k}: ' + ' | '.join(out))
