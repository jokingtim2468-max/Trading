# usage: python3 gold_lucid_grid.py <XAUUSD M5 export .csv>
# Every setting of the gold session-trend signals (qb-gold-lucid.pine) on every LucidFlex account:
#   EMA pairs 8/21, 13/55, 20/100, 50/200 | entry: on the cross, or any session the fast EMA is above (state)
#   trailing stop 1, 1.5, 2, 3 x daily ATR | max hold 20, 60, 120 sessions | long only, or long + short
#   size 1-20 MGC (whole contracts) | Lucid rules: EOD trailing max loss, DLL on the session's worst point
# Chosen per account on 2004-2018 (both halves of it positive, never blown, drawdown <= 75% of max loss), best average
# week; checked on 2019-2025; 2026 graded once.
import sys, itertools, numpy as np, pandas as pd
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
m = b.index.hour * 60 + b.index.minute
b = b[(m >= 18 * 60) | (m <= 16 * 60 + 40)].copy(); b['s'] = (b.index + pd.Timedelta(hours=6)).normalize()
S = b.groupby('s').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
S = S[(S.n > 150) & (S.index.weekday < 5)]
pc = S.c.shift(1); A = np.maximum(S.h - S.l, np.maximum((S.h - pc).abs(), (S.l - pc).abs())).rolling(20).mean().values
o, h, l, c = S.o.values, S.h.values, S.l.values, S.c.values; yrs = S.index.year.values; wk = S.index.to_period('W')
COST = 0.40
ACC = {'25K': (1000, 600), '50K': (2000, 1200), '100K': (3000, 1800), '150K': (4500, 2700)}

def sessions(fa, sl, entry, k, maxage, both):
    f = pd.Series(c).ewm(span=fa, adjust=False).mean().values; s_ = pd.Series(c).ewm(span=sl, adjust=False).mean().values
    pnl = np.zeros(len(c)); worst = np.zeros(len(c)); pos = 0; trail = best = 0.0; age = 0
    for i in range(sl, len(c)):
        if pos:
            adv = (l[i] - o[i]) if pos > 0 else (o[i] - h[i])
            hit = (l[i] <= trail) if pos > 0 else (h[i] >= trail)
            worst[i] = min(0.0, adv) - COST
            if hit: pnl[i] = (trail - o[i]) * pos - COST; pos = 0; continue
            pnl[i] = (c[i] - o[i]) * pos - COST; age += 1
            best = max(best, c[i]) if pos > 0 else min(best, c[i])
            trail = max(trail, best - k * A[i]) if pos > 0 else min(trail, best + k * A[i])
            if age >= maxage or (entry == 'state' and np.sign(f[i] - s_[i]) != pos): pos = 0
            continue
        if not A[i] > 0: continue
        up = f[i] > s_[i]; dn = f[i] < s_[i]
        if entry == 'cross': up &= f[i - 1] <= s_[i - 1]; dn &= f[i - 1] >= s_[i - 1]
        d = 1 if up else (-1 if dn and both else 0)
        if d: pos = d; best = c[i]; trail = c[i] - d * k * A[i]; age = 0
    return pnl, worst

def play(pnl, worst, q, mll, dll, mask):
    usd = np.where(worst[mask] * 10 * q <= -dll, -dll, pnl[mask] * 10 * q)
    eq, floor, blown = 0.0, -mll, 0
    for p in usd:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -mll; continue
        if eq > 0: floor = max(floor, min(0.0, eq - mll))
    e = np.cumsum(usd); dd = float(np.max(np.maximum.accumulate(e) - e)) if len(e) else 0
    w = pd.Series(usd, index=wk[mask]).groupby(level=0).sum()
    return dict(week=w.mean(), med=w.median(), ww=100 * (w > 0).mean(), dd=dd, worst=usd.min(), blown=blown, tot=usd.sum())

M_tr = yrs <= 2018; M_a = yrs <= 2011; M_b = (yrs >= 2012) & (yrs <= 2018); M_v = (yrs >= 2019) & (yrs <= 2025); M_x = yrs == 2026
grid = list(itertools.product([(8, 21), (13, 55), (20, 100), (50, 200)], ['cross', 'state'], [1.0, 1.5, 2.0, 3.0], [20, 60, 120], [False, True]))
best = {a: None for a in ACC}; tested = 0
for (fa, sl), entry, k, maxage, both in grid:
    pnl, worst = sessions(fa, sl, entry, k, maxage, both)
    for a, (mll, dll) in ACC.items():
        for q in range(1, 21):
            tested += 1
            r = play(pnl, worst, q, mll, dll, M_tr)
            if r['blown'] or r['dd'] > 0.75 * mll: break
            if play(pnl, worst, q, mll, dll, M_a)['tot'] <= 0 or play(pnl, worst, q, mll, dll, M_b)['tot'] <= 0: continue
            if best[a] is None or r['week'] > best[a][0]['week']:
                best[a] = (r, dict(ema=f'{fa}/{sl}', entry=entry, trail=k, maxage=maxage, shorts=both, mgc=q), pnl, worst)
print(f'{len(grid)} settings x sizes x 4 accounts = {tested} combinations tested\n')
for a, (mll, dll) in ACC.items():
    if best[a] is None: print(f'{a}: nothing passed (profitable in both 2004-11 and 2012-18 without blowing)\n'); continue
    r, P, pnl, worst = best[a]
    print(f'{a} BEST {P}')
    for lab, M in (('2004-2018 (chosen)', M_tr), ('2019-2025 (check)', M_v), ('2026 (exam)', M_x)):
        x = play(pnl, worst, P['mgc'], mll, dll, M)
        print(f"   {lab}: avg week ${x['week']:,.0f}, typical ${x['med']:,.0f}, winning weeks {x['ww']:.0f}%, max drawdown ${x['dd']:,.0f}, "
              f"worst day ${x['worst']:,.0f}, blown {x['blown']}, total ${x['tot']:,.0f}")
    print()
