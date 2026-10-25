# usage: python3 gold_lucid_accounts.py <XAUUSD M5 export .csv>
# Replays qb-gold-lucid.pine (daily EMA13/55 gold trend, held one session at a time 18:00-16:40 ET) on LucidFlex rules:
# EOD trailing max loss (locks at the start balance), daily loss limit checked on the session low, whole MGC contracts.
# Size per account = the most MGC whose 2004-2025 drawdown stays under 75% of the max loss. Weekly averages reported.
import sys, numpy as np, pandas as pd
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
m = b.index.hour * 60 + b.index.minute
b = b[(m >= 18 * 60) | (m <= 16 * 60 + 40)].copy(); b['s'] = (b.index + pd.Timedelta(hours=6)).normalize()
S = b.groupby('s').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
S = S[(S.n > 150) & (S.index.weekday < 5)]
pc = S.c.shift(1); S['atr'] = np.maximum(S.h - S.l, np.maximum((S.h - pc).abs(), (S.l - pc).abs())).rolling(20).mean()
f = S.c.ewm(span=13, adjust=False).mean().values; s5 = S.c.ewm(span=55, adjust=False).mean().values
o, h, l, c, a = S.o.values, S.h.values, S.l.values, S.c.values, S.atr.values
COST = 0.40   # $ per oz per session
sess = []     # (date, $ per oz close-to-close of the session, worst open $ per oz)
pos = 0; trail = best = 0.0; age = 0
for i in range(60, len(S)):
    pnl = worst = 0.0
    if pos:
        worst = min(0.0, l[i] - o[i])
        if l[i] <= trail: pnl = trail - o[i] - COST; pos = 0
        else:
            pnl = c[i] - o[i] - COST; age += 1; best = max(best, c[i]); trail = max(trail, best - 1.5 * a[i])
            if age >= 60: pos = 0
    elif f[i] > s5[i] and f[i - 1] <= s5[i - 1] and a[i] > 0:
        pos = 1; best = c[i]; trail = c[i] - 1.5 * a[i]; age = 0
    sess.append((S.index[i], pnl, worst - COST if pnl else 0.0))
D = pd.DataFrame(sess, columns=['d', 'pnl', 'worst']).set_index('d')

def play(q, mll, dll, lo, hi):
    x = D[(D.index.year >= lo) & (D.index.year <= hi)]
    usd = np.where(x.worst.values * 10 * q <= -dll, -dll, x.pnl.values * 10 * q)   # DLL hit inside the session
    s = pd.Series(usd, index=x.index)
    eq, floor, blown = 0.0, -mll, 0
    for p in s.values:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -mll; continue
        if eq > 0: floor = max(floor, min(0.0, eq - mll))
    w = s.groupby(s.index.to_period('W')).sum(); e = s.cumsum()
    return w.mean(), w.median(), 100 * (w > 0).mean(), float((e.cummax() - e).max()), s.min(), blown, s.sum()

for acct, (mll, dll) in {'25K': (1000, 600), '50K': (2000, 1200), '100K': (3000, 1800), '150K': (4500, 2700)}.items():
    q = 0
    for n in range(1, 41):
        if play(n, mll, dll, 2004, 2025)[3] > 0.75 * mll: break
        q = n
    note = '' if q else ' (even 1 MGC is too big for this account: shown at 1 MGC)'
    q = q or 1
    for lo, hi in ((2004, 2025), (2019, 2025), (2026, 2026)):
        wk, med, ww, dd, worst, blown, tot = play(q, mll, dll, lo, hi)
        print(f'{acct} {q} MGC {lo}-{hi}: avg week ${wk:,.0f}, typical week ${med:,.0f}, winning weeks {ww:.0f}%, max drawdown ${dd:,.0f}, '
              f'worst day ${worst:,.0f}, blown {blown}, total ${tot:,.0f}{note}')
