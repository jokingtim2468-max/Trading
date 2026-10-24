# usage: python3 scripts/bot-best-dollars.py <XAUUSD M5 export> <NQ M5 export>
# Turns the improver's best bot (research/bot-best-v2.json) into dollars on LucidFlex accounts:
#   trades per day from the walk-forward (each year's setups chosen on earlier years only), $ risk per R sized so the
#   2019-2025 drawdown stays under 75% of the account's max loss, daily loss limit applied, then 2026 graded.
import sys, os, json, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'scripts', 'bot-improver.py')).read()
src = src[:src.index("best = json.load(open(BEST))")]
ARGS = sys.argv[:]
g = {'__file__': os.path.join(ROOT, 'scripts', 'bot-improver.py')}; sys.argv = ARGS[:3]; exec(src, g)
B = json.load(open(os.path.join(ROOT, 'research', 'bot-best-v2.json')))['bot']
ACCTS = {'25K': (1000, 600), '50K': (2000, 1200), '100K': (3000, 1800), '150K': (4500, 2700)}

def daily_R(years):
    F = [(c, g['filt'](c['t'], B)) for c in g['cands']]
    rows = []
    for Y in years:
        scored = []
        for c, df in F:
            past = df[(df.y >= Y - B['look']) & (df.y < Y)]
            if past.y.nunique() < B['look'] or len(past) < B['min_trades']: continue
            by = past.groupby('y').r.mean()
            if (by <= 0).any(): continue
            sc = by.min() if B['rank'] == 'worst_year' else by.mean() if B['rank'] == 'mean' else by.mean() - by.std()
            scored.append((sc, df))
        scored.sort(key=lambda z: -z[0])
        top = scored[:B['topk']]
        for _, df in top:
            for d, r in df[df.y == Y][['day', 'r']].values: rows.append((pd.Timestamp(d), r / max(1, len(top))))
    s = pd.Series([r for _, r in rows], index=[d for d, _ in rows])
    return s.groupby(level=0).sum().sort_index()

R = daily_R(range(2019, 2027))
for acct, (mll, dll) in ACCTS.items():
    pre = R[R.index.year <= 2025]
    best = None
    for risk in range(25, 2001, 25):
        x = (pre * risk).clip(lower=-dll); e = x.cumsum()
        if float((e.cummax() - e).max()) > 0.75 * mll: break
        best = risk
    if best is None: print(acct, 'even $25 per R is too big'); continue
    for label, part in (('2019-2025', pre), ('2026 exam', R[R.index.year == 2026])):
        x = (part * best).clip(lower=-dll)
        eq, floor, blown = 0.0, -mll, 0
        for p in x.values:
            eq += p
            if eq <= floor: blown += 1; eq, floor = 0.0, -mll; continue
            if eq > 0: floor = max(floor, min(0.0, eq - mll))
        lo, hi = (2019, 2025) if label != '2026 exam' else (2026, 2026)
        allw = pd.period_range(f'{lo}-01-01', f'{hi}-10-16' if hi == 2026 else f'{hi}-12-31', freq='W')
        w = x.groupby(x.index.to_period('W')).sum().reindex(allw, fill_value=0.0); e = x.cumsum()
        print(f"{acct} ${best}/R | {label}: avg week ${w.mean():,.0f}, median week ${w.median():,.0f}, winning weeks {100 * (w > 0).mean():.0f}%, "
              f"weeks >= $1k {int((w >= 1000).sum())}/{len(w)}, best day ${x.max():,.0f}, worst day ${x.min():,.0f}, "
              f"max drawdown ${float((e.cummax() - e).max()):,.0f}, blown {blown}, total ${x.sum():,.0f}")
