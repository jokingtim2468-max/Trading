# usage: python3 scripts/opening-drive-lab.py <M5 MT5 export> [account=150K] [NQ|XAUUSD]
# Improves the NQ opening drive (the one public strategy that survived scripts/strategy-lab.py) for LucidFlex accounts.
# Variants: filters on the first 5-minute bar and the gap, stop size, break-even, adding to winners (pyramiding, stops
# raised as it adds), trailing exit. Everything is flat by 16:40 ET.
# Honest protocol: choose on 2012-2017 (train) + 2018-2021 (validation); 2022-2026 (holdout) is graded once at the end.
# Size per variant: the most micros per unit whose 2012-2021 drawdown stays under half the account's max loss.
# Costs: 0.5 pt slippage per fill + $1.50 commission per micro round trip. Stop checked before adds in the same bar.
import sys, itertools, json
import numpy as np, pandas as pd

F = sys.argv[1]; ACCT = sys.argv[2] if len(sys.argv) > 2 else '150K'
MKT = sys.argv[3] if len(sys.argv) > 3 else 'NQ'   # NQ: 09:30 open, MNQ $2/pt; XAUUSD: COMEX 08:20 open, MGC $10/$1
A = {'25K': (1000, 600, 20), '50K': (2000, 1200, 40), '100K': (3000, 1800, 60), '150K': (4500, 2700, 100)}
MLL, DLL, CAP = A[ACCT]
PV, SLIP, COMM = (10.0, 0.20, 1.5) if MKT == 'XAUUSD' else (2.0, 0.5, 1.5)
OPEN = 500 if MKT == 'XAUUSD' else 570

df = pd.read_csv(F, sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
b = b[b.index.weekday < 5]
pc = b.c.shift(1)
b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
mins = b.index.hour * 60 + b.index.minute
b['day'] = b.index.normalize()
rth = b[(mins >= OPEN) & (mins <= 16 * 60 + 40)]
eth = b[mins < OPEN]
close16 = b[mins == 16 * 60 - 5].groupby('day').c.last()          # 15:55 bar close ~ the RTH close
on = eth.groupby('day').agg(onh=('h', 'max'), onl=('l', 'min'))
days = []
for d, g in rth.groupby('day'):
    if len(g) < 60 or g.index[0].hour * 60 + g.index[0].minute != OPEN: continue
    days.append((d, g.o.values, g.h.values, g.l.values, g.c.values, g.atr.values[0]))
prev_close = {d: close16.get(d) for d in close16.index}
ds = [x[0] for x in days]
pcl = pd.Series(prev_close).reindex(pd.DatetimeIndex(ds)).shift(1).values
ONH = on.reindex(pd.DatetimeIndex(ds)).onh.values; ONL = on.reindex(pd.DatetimeIndex(ds)).onl.values
print(f'{len(days)} RTH days {ds[0].date()} to {ds[-1].date()}', flush=True)

def day_trade(k, P):
    """-> (points per micro summed over units, micros-units used) for day k, or None if no trade"""
    d, o, h, l, c, atr = days[k]
    if not (atr > 0): return None
    s = 1 if c[0] > o[0] else -1 if c[0] < o[0] else 0
    if s == 0: return None
    if abs(c[0] - o[0]) < P['body'] * atr: return None
    gap = o[0] - pcl[k] if np.isfinite(pcl[k]) else 0.0
    if P['gap'] == 'with' and np.sign(gap) != s: return None
    if P['gap'] == 'against' and np.sign(gap) == s: return None
    if P['on'] == 'break' and not ((s > 0 and c[0] > ONH[k]) or (s < 0 and c[0] < ONL[k])): return None
    R = P['stop'] * atr
    e = o[1] + s * SLIP
    entries = [e]; stop = e - s * R; best = e; adds = 0
    for j in range(1, len(o)):
        hi, lo = h[j], l[j]
        # stop first (worst case)
        if (s > 0 and lo <= stop) or (s < 0 and hi >= stop):
            ex = stop - s * SLIP
            return sum((ex - x) * s for x in entries), len(entries)
        best = max(best, hi) if s > 0 else min(best, lo)
        # adds at +1R, +2R... from the first entry; each add raises the stop one step
        while adds < P['adds'] and ((s > 0 and hi >= e + s * R * (adds + 1)) or (s < 0 and lo <= e + s * R * (adds + 1))):
            adds += 1
            entries.append(e + s * R * adds + s * SLIP)
            stop = e + s * R * (adds - 1) if P['raise'] else stop
        if P['be'] and adds == 0 and ((best - e) * s >= R): stop = e if (stop - e) * s < 0 else stop
        if P['trail'] > 0 and (best - e) * s >= R:
            ts = best - s * P['trail'] * atr
            if (ts - stop) * s > 0: stop = ts
    ex = c[-1] - s * SLIP
    return sum((ex - x) * s for x in entries), len(entries)

GRID = dict(body=[0.0, 0.5], gap=['any', 'with'], on=['any', 'break'], stop=[1.0, 2.0],
            be=[False, True], adds=[0, 1, 2, 3], raise_=[True], trail=[0.0, 4.0])

def evaluate(P):
    rows = []
    for k in range(len(days)):
        r = day_trade(k, P)
        if r is None: continue
        pts, units = r
        rows.append((days[k][0], pts * PV - COMM * units, units))
    return rows

def size_for(rows, lo, hi):
    """micros per unit so the lo-hi drawdown stays under half the max loss (and units x micros under the cap)"""
    v = np.array([p for d, p, u in rows if lo <= d.year <= hi]); maxu = max([u for d, p, u in rows] or [1])
    if len(v) < 100: return 0
    eq = np.cumsum(v); dd = float(np.max(np.maximum.accumulate(eq) - eq)) or 1.0
    return int(max(0, min(CAP // maxu, (0.5 * MLL) // dd)))

def play(rows, n, lo, hi):
    """LucidFlex rules: day capped at the DLL, EOD trailing floor that locks at the start balance, reset when blown"""
    eq, floor, blown, out = 0.0, -MLL, 0, {}
    for d, p, u in rows:
        if not (lo <= d.year <= hi): continue
        pnl = max(-DLL, p * n)
        eq += pnl; out[d] = pnl
        if eq <= floor: blown += 1; eq, floor = 0.0, -MLL; continue
        if eq > 0: floor = max(floor, min(0.0, eq - MLL))
    s = pd.Series(out).sort_index()
    if s.empty: return None
    wk = s.groupby(s.index.to_period('W')).sum()
    allw = pd.period_range(s.index.min(), s.index.max(), freq='W'); wk = wk.reindex(allw, fill_value=0.0)
    e = s.cumsum(); dd = float((e.cummax() - e).max())
    return dict(per_week=round(wk.mean()), median_week=round(wk.median()), win_weeks=round((wk > 0).mean() * 100), best_day=round(s.max()),
                worst_day=round(s.min()), max_dd=round(dd), blown=blown, total=round(s.sum()), trades=len(s))

def one(combo):
    P = dict(zip(list(GRID), combo)); P['raise'] = P.pop('raise_')
    rows = evaluate(P)
    n = size_for(rows, 2012, 2021)
    if n < 1: return None
    tr, va = play(rows, n, 2012, 2017), play(rows, n, 2018, 2021)
    if not tr or not va: return None
    return dict(P=P, micros=n, train=tr, val=va, _rows=rows)

from multiprocessing import Pool
with Pool(4) as pool:
    res = [r for r in pool.map(one, list(itertools.product(*GRID.values())), chunksize=4) if r]
print(len(res), 'variants sized', flush=True)
ok = [r for r in res if r['train']['per_week'] > 0 and r['val']['per_week'] > 0 and r['train']['blown'] == 0 and r['val']['blown'] == 0]
ok.sort(key=lambda r: -min(r['train']['per_week'], r['val']['per_week']))
print(len(ok), 'positive and never blown on both train and validation')
for r in ok[:10]: print(r['P'], 'micros/unit', r['micros'], '\n   train', r['train'], '\n   val  ', r['val'])
if ok:
    top = ok[0]
    print('\nHOLDOUT 2022-2026 (graded once), chosen variant:', top['P'], 'micros/unit', top['micros'])
    print('  ', play(top['_rows'], top['micros'], 2022, 2026))
    print('Top 5 by validation, on holdout (for the record, not used to choose):')
    for r in ok[:5]: print('  ', r['P'], r['micros'], play(r['_rows'], r['micros'], 2022, 2026))
    json.dump({'account': ACCT, 'chosen': {k: v for k, v in top.items() if k != '_rows'}, 'holdout': play(top['_rows'], top['micros'], 2022, 2026)},
              open(f'research/opening-drive-{ACCT}.json', 'w'), indent=1, default=str)
