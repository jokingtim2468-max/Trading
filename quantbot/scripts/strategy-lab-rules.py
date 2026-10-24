# usage: python3 scripts/strategy-lab-rules.py <XAUUSD M5 export> <NQ M5 export>
# NQ opening drive (the one strategy that made money on early AND unseen years in scripts/strategy-lab.py) played on
# LucidFlex accounts with QuantBot's own risk rules (server/lib/copyRules.js ruleRisk + the rule guard):
#   - risk per trade = risk_share x the smaller of the daily loss limit and the max loss (QuantBot default 0.25)
#   - never more than half the room left above the trailing max-loss floor (one loss can never blow the account)
#   - micros = risk / (stop x $2 + $1.50), rounded down; no trade when even 1 micro is over the budget
#   - the day stops at the daily loss limit; the floor trails end-of-day and locks at the start balance
# A blown account is replaced by a new one (counted, with its evaluation fee). Reported on 2020-2026 (unseen years)
# and on all of 2012-2026.
import sys, numpy as np, pandas as pd
src = open(__file__.replace('strategy-lab-rules.py', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
ARGS = sys.argv[:]
sys.argv = ['x', sys.argv[1], sys.argv[2], '/dev/null']
g = {}; exec(src, g)
m = g['MK']['NQ']
x = g['prep'](g['load'](m['file']), m)
side, stop, tgt = g['signals'](x, m, 'opening_drive', dict(k=1.0, R=None))
trades = [(pd.Timestamp(d), p, s) for d, p, s in g['simulate'](x, m, side, stop, tgt)]   # (day, points after slippage, stop in points)
FEES = {'25K': 65, '50K': 110, '100K': 210, '150K': 300}   # LucidFlex evaluation list prices (approximate, check the site)
ROOM = float(ARGS[3]) if len(ARGS) > 3 else 0.5   # never risk more than this share of the room above the floor
DLL = {'25K': 600, '50K': 1200, '100K': 1800, '150K': 2700}

def run(acct, a, share, lo, hi, fixed=None):
    mll, cap, dll = a['mll'], a['micros'], DLL[acct]
    eq = 0.0; floor = -mll; blown = 0; best = 0.0; worst = 0.0; days = {}; skipped = 0; total = 0.0; peak = 0.0; dd = 0.0; alive = []; n_alive = 0
    for d, pts, sd in trades:
        if not (lo <= d.year <= hi): continue
        room = eq - floor
        budget = min(share * min(dll, mll), ROOM * room)
        per_micro = sd * m['pv'] + g['COMM']
        micros = min(cap, int(budget // per_micro)) if fixed is None else (fixed if fixed * per_micro <= ROOM * room else 0)
        if micros < 1: skipped += 1; continue
        pnl = max(-dll, (pts * m['pv'] - g['COMM']) * micros)
        eq += pnl; total += pnl; n_alive += 1
        days[d] = days.get(d, 0) + pnl
        peak = max(peak, total); dd = max(dd, peak - total)
        if eq <= floor:
            blown += 1; alive.append(n_alive); n_alive = 0; eq = 0.0; floor = -mll
            continue
        if eq > 0: floor = max(floor, min(0.0, eq - mll))
    s = pd.Series(days).sort_index()
    w = s.groupby(s.index.to_period('W')).sum()
    allw = pd.period_range(f'{lo}-01-01', f'{hi}-12-31', freq='W')
    w = w.reindex(allw[(allw.start_time >= s.index.min()) & (allw.start_time <= s.index.max())], fill_value=0.0)
    fees = blown * FEES[acct]
    return dict(per_week=w.mean(), win_weeks=(w > 0).mean() * 100, best_day=s.max(), worst_day=s.min(), max_dd=dd, blown=blown,
                fees=fees, net=total - fees, days_1k=int((s >= 1000).sum()), traded=len(s), skipped=skipped,
                med_alive=float(np.median(alive)) if alive else None)

print('NQ opening drive, LucidFlex, QuantBot rules')
for lo, hi, label in [(2020, 2026, 'UNSEEN 2020-2026'), (2012, 2026, 'ALL 2012-2026')]:
    print(f'\n{label}')
    for share in (0.10, 0.25):
        for acct, a in g['ACCTS'].items():
            r = run(acct, a, share, lo, hi)
            print(f"  share {share:.2f} {acct:5s} avg week ${r['per_week']:,.0f} (win weeks {r['win_weeks']:.0f}%), best day ${r['best_day']:,.0f}, "
                  f"worst day ${r['worst_day']:,.0f}, max drawdown ${r['max_dd']:,.0f}, blown {r['blown']} (fees ${r['fees']:,}), "
                  f"net ${r['net']:,.0f}, $1k+ days {r['days_1k']}, trades {r['traded']}, skipped {r['skipped']}")

print('\nFIXED SIZE (no risk-share sizing), still skipping any trade that could use more than ROOM of the room above the floor')
for lo, hi, label in [(2020, 2026, 'UNSEEN 2020-2026'), (2012, 2026, 'ALL 2012-2026')]:
    print(f'\n{label}')
    for acct, a in g['ACCTS'].items():
        for fx in (1, 2, 3):
            r = run(acct, a, 0, lo, hi, fixed=fx)
            print(f"  {acct:5s} {fx} MNQ  avg week ${r['per_week']:,.0f} (win weeks {r['win_weeks']:.0f}%), best day ${r['best_day']:,.0f}, "
                  f"worst day ${r['worst_day']:,.0f}, max drawdown ${r['max_dd']:,.0f}, blown {r['blown']}, net ${r['net']:,.0f}, trades {r['traded']}, skipped {r['skipped']}")
