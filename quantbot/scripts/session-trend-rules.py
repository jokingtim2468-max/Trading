# usage: python3 scripts/session-trend-rules.py <XAUUSD M5 export> <NQ M5 export> [25K|50K|100K|150K]
# The NQ session trend (long while daily EMA50 > EMA200, 1 ATR stop, enter 18:00 ET, flat 16:40 ET, 1 MNQ) from
# scripts/session-trend-2026.py, with the account's rules and QuantBot's limits:
#   - LucidFlex max loss (EOD trailing, locks at the start balance) and daily loss limit checked on the worst open loss
#   - daily max profit: the session is closed once open profit reaches it (checked on the session's best price;
#     if the stop and the cap are both inside one session, the stop counts first, worst case)
#   - weekly loss limit: no new sessions for the rest of the week after it; weekly profit cap: same after it
#   - (a floor guard that skips sessions near the floor was tested and removed: after one loss it never trades again)
# Settings chosen on 2012-2025 (fewest blown accounts, then the best average week), graded once on 2026.
import sys, itertools, numpy as np, pandas as pd
src = open(__file__.replace('session-trend-rules.py', 'session-trend-2026.py')).read()
src = src[:src.index('rows = []')]
g = {}; exec(src, g)
MLL, DLL, CAP = g['MLL'], g['DLL'], g['CAP']; ACCT = g['ACCT']
m = g['MK']['NQ']; S = g['sessions'](m['f'])
pm, mae = g['per_micro'](S, m, g['signal'](S, 'ema', 200, False), 1.0); mfe = g['per_micro'].mfe
weeks = S.index.to_period('W')

def play(lo, hi, wloss, wcap, dcap, guard=True, q=1):
    eq, floor, blown, out = 0.0, -MLL, 0, {}
    wk, wp = None, 0.0
    for i, d in enumerate(S.index):
        if not (lo <= d.year <= hi): continue
        if weeks[i] != wk: wk, wp = weeks[i], 0.0
        if pm[i] == 0 and mae[i] == 0: out[d] = 0.0; continue                # flat session (no trend)
        if wloss and wp <= -wloss: continue
        if wcap and wp >= wcap: continue
        if guard and eq - floor < 1.2 * min(DLL, MLL): continue
        loss_hit = mae[i] * q <= -DLL
        if loss_hit: pnl = -DLL
        elif dcap and pm[i] * q >= 0 and mfe[i] * q >= dcap: pnl = dcap      # losing sessions keep their loss (worst case)
        else: pnl = pm[i] * q
        eq += pnl; wp += pnl; out[d] = pnl
        if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue
        if eq > 0: floor = max(floor, min(0.0, eq - MLL))
    x = pd.Series(out).sort_index()
    w = x.groupby(x.index.to_period('W')).sum(); e = x.cumsum()
    return dict(avg_week=round(w.mean()), median_week=round(w.median()), win_weeks=round(100 * (w > 0).mean()), weeks_1k=f"{int((w >= 1000).sum())}/{len(w)}",
                best_day=round(x.max()), worst_day=round(x.min()), max_dd=round(float((e.cummax() - e).max())), blown=blown, total=round(x.sum()))

base = play(2012, 2025, None, None, None, guard=False)
res = []
for wloss, wcap, dcap, guard in itertools.product([None, 0.3, 0.5, 0.7], [None, 1000, 1500, 2500], [None, 300, 500, 800], [False]):
    wl = wloss * MLL if wloss else None
    r = play(2012, 2025, wl, wcap, dcap, guard)
    res.append(((r['blown'], -r['avg_week']), dict(weekly_loss=wl, weekly_cap=wcap, daily_cap=dcap, guard=guard), r))
res.sort(key=lambda z: z[0])
print(f'{ACCT}: no extra rules, 2012-2025:', base)
print('2026 no extra rules:', play(2026, 2026, None, None, None, guard=False))
print('\nBest rule sets on 2012-2025 (fewest blown, then best week):')
for _, P, r in res[:6]: print('  ', P, r)
P = res[0][1]
print('\nCHOSEN', P)
print('  2012-2025:', res[0][2])
print('  2026 (graded once):', play(2026, 2026, P['weekly_loss'], P['weekly_cap'], P['daily_cap'], P['guard']))
