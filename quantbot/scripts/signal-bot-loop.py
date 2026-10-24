# usage: python3 scripts/signal-bot-loop.py <XAUUSD M5 export> <NQ M5 export> [first test year]
# The test -> improve -> test loop behind strategies/qb-signal-bot.pine. Walk-forward, year by year:
#   for each test year Y: score every candidate setting (every strategy/setting/target/trend version in
#   scripts/strategy-lab.py, one trade a day) on the 4 years before Y only, keep the best one that was positive in each
#   of those 4 years, then trade it on Y (never seen while choosing). Then move to Y+1 and choose again.
# Results are in R (risk units) so they hold for any lot size; $ shown at $100 risk per trade.
# Re-run it after every new data export: the newest year is the live test, and the line for the next year is what the
# bot should run now (written to research/signal-bot-choice.json, which the Pine script's defaults come from).
import sys, json, itertools, numpy as np, pandas as pd
src = open(__file__.replace('signal-bot-loop.py', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
ARGS = sys.argv[:]
sys.argv = ['x', ARGS[1], ARGS[2], '/dev/null']
g = {}; exec(src, g)
FIRST = int(ARGS[3]) if len(ARGS) > 3 else 2017
RISK = 100.0

cands = []
for mkt, m in g['MK'].items():
    x = g['prep'](g['load'](m['file']), m)
    for s, grid in g['GRID'].items():
        seen = set()
        for p in grid:
            for R in (None, 1.0, 2.0, 3.0):
                q = dict(p); q['R'] = R
                key = tuple(sorted((k, str(v)) for k, v in q.items()))
                if key in seen: continue
                seen.add(key)
                for trend in (False, True):
                    side, stop, tgt = g['signals'](x, m, s, q)
                    if trend: side = np.where(side == np.sign(x.c.values - x.e200.values), side, 0)
                    tr = g['simulate'](x, m, side, stop, tgt, max_per_day=1)
                    if len(tr) < 100: continue
                    rows = pd.DataFrame([(pd.Timestamp(d), pts / sd - g['COMM'] / max(sd * m['pv'], 1e-9)) for d, pts, sd in tr], columns=['d', 'r'])
                    rows['y'] = rows.d.dt.year
                    cands.append(dict(name=f"{mkt} {s} {q} trend={trend}", mkt=mkt, s=s, p=q, trend=trend, rows=rows))
        print(mkt, s, len(cands), flush=True)

years = range(FIRST, 2027)
log = []; total = []
for Y in years:
    best = None
    for c in cands:
        r = c['rows']; past = r[(r.y >= Y - 4) & (r.y < Y)]
        if past.y.nunique() < 4 or len(past) < 60: continue
        by = past.groupby('y').r.mean()
        if (by <= 0).any(): continue
        score = by.min()
        if best is None or score > best[0]: best = (score, c)
    if best is None:
        log.append((Y, None, 0, 0.0, 0.0)); print(f'{Y}: nothing passed the 4-year check -> no trading'); continue
    c = best[1]; now = c['rows'][c['rows'].y == Y]
    total.append(now.r.values)
    log.append((Y, c['name'], len(now), float(now.r.mean()) if len(now) else 0.0, float(now.r.sum())))
    print(f"{Y}: chose {c['name']} (worst of the last 4 years {best[0]:+.3f}R/trade) -> {Y}: {len(now)} trades, "
          f"win {100 * (now.r > 0).mean():.0f}%, {now.r.mean():+.3f}R/trade, {now.r.sum():+.1f}R = ${now.r.sum() * RISK:+,.0f} at ${RISK:.0f} risk", flush=True)

allr = np.concatenate(total) if total else np.array([])
print(f"\nWALK-FORWARD {FIRST}-2026 (every year unseen when chosen): {len(allr)} trades, win {100 * (allr > 0).mean():.0f}%, "
      f"{allr.mean():+.3f}R/trade, total {allr.sum():+.1f}R = ${allr.sum() * RISK:+,.0f} at ${RISK:.0f} risk")
# what the bot should run next (chosen on the last 4 full years)
best = None
for c in cands:
    r = c['rows']; past = r[(r.y >= 2022) & (r.y <= 2025)]
    if past.y.nunique() < 4: continue
    by = past.groupby('y').r.mean()
    if (by <= 0).any(): continue
    if best is None or by.min() > best[0]: best = (by.min(), c)
if best:
    c = best[1]
    json.dump(dict(chosen_on='2022-2025', name=c['name'], market=c['mkt'], strategy=c['s'], params=c['p'], trend=c['trend'],
                   worst_year_R=round(best[0], 3), log=[dict(year=y, choice=n, trades=t, avgR=round(a, 3), totalR=round(s, 1)) for y, n, t, a, s in log]),
              open('research/signal-bot-choice.json', 'w'), indent=1)
    print('NEXT (for live):', c['name'])
