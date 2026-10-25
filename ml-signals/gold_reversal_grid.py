# usage: python3 gold_reversal_grid.py <XAUUSD M5 export .csv>
# Best settings for confirmed gold reversals at 1 MGC on a LucidFlex 50K (pattern detection from gold_reversals.py).
# For every pattern: target (1R, 2R, measured move, trail 2 ATR to the close) x trend filter (any / only with the
# daily EMA13-55 trend / only against it) x window (all 03:00-15:30, London 03:00-06:00, NY 08:00-11:30) x stop buffer
# (0.1 / 0.5 ATR). Chosen on 2004-2018 (positive in 2004-11 AND 2012-18, never blown), checked 2019-25, 2026 once.
import sys, itertools, numpy as np, pandas as pd
src = open(__file__.replace('gold_reversal_grid.py', 'gold_reversals.py')).read()
src = src[:src.index('SLIP, COMM, MLL, DLL')]
sys.argv = [sys.argv[0], sys.argv[1], '1']
g = {}; exec(src, g)
o, h, l, c, a, day, mins, n = (g[k] for k in ('o', 'h', 'l', 'c', 'a', 'day', 'mins', 'n'))
b = g['b']; dc = b.groupby('day').c.last()
tr = np.sign(dc.ewm(span=13, adjust=False).mean() - dc.ewm(span=55, adjust=False).mean()).shift(1)
TREND = b.day.map(tr).fillna(0).values
SLIP, COMM, MLL, DLL, Q = 0.20, 1.50, 2000.0, 1200.0, 1
yrs = pd.DatetimeIndex(day).year.values

def signals(kind):
    out = []
    for i in range(100, n - 2):
        s = g['find'](i, kind)
        if s: out.append((i,) + s)
    return out

def sim(sigs, tmode, buf):
    rows = []; busy = -1
    for i, s, stop, height in sigs:
        if i <= busy: continue
        stop = stop - s * (buf - 0.1) * a[i]
        e = o[i + 1] + s * SLIP; risk = abs(e - stop)
        if risk <= 0: continue
        tgt = None if tmode == 'trail' else e + s * (risk if tmode == '1R' else 2 * risk if tmode == '2R' else max(height, 0.5 * risk))
        d0 = day[i + 1]; res = None; j = i + 1; best = e
        while j < n and day[j] == d0 and mins[j] <= 16 * 60 + 40:
            if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): res = stop - s * SLIP; break
            if tgt is not None and ((s > 0 and h[j] >= tgt) or (s < 0 and l[j] <= tgt)): res = tgt - s * SLIP; break
            if tgt is None:
                best = max(best, h[j]) if s > 0 else min(best, l[j])
                ts = best - s * 2 * a[j]
                if (ts - stop) * s > 0 and (best - e) * s >= risk: stop = ts
            j += 1
        if res is None: j = min(j, n - 1); res = c[j - 1] - s * SLIP
        worst = (l[i + 1:j + 1].min() - e) if s > 0 else (e - h[i + 1:j + 1].max())
        rows.append((i, s, (res - e) * s * 10 * Q - COMM * Q, min(0, worst) * 10 * Q)); busy = j
    return rows

def acct(rows, lo, hi):
    sel = [(day[i], p, w) for i, s, p, w in rows if lo <= yrs[i] <= hi]
    if not sel: return dict(tot=0, wk=0, dd=0, bl=0, n=0, win=0)
    D = pd.DataFrame(sel, columns=['d', 'p', 'w']).groupby('d').agg(p=('p', 'sum'), w=('w', 'min'))
    u = np.where(D.w.values <= -DLL, -DLL, D.p.values); eq, fl, bl = 0.0, -MLL, 0
    for p in u:
        eq += p
        if eq <= fl: bl += 1; eq, fl = 0.0, -MLL; continue
        if eq > 0: fl = max(fl, min(0.0, eq - MLL))
    weeks = (pd.Timestamp(f'{hi}-12-31' if hi < 2026 else '2026-10-16') - pd.Timestamp(f'{lo}-01-01')).days / 7
    e = np.cumsum(u)
    return dict(tot=u.sum(), wk=u.sum() / weeks, dd=float(np.max(np.maximum.accumulate(e) - e)), bl=bl, n=len(sel), win=100 * np.mean([p > 0 for _, p, _ in sel]))

WIN = {'all': (180, 930), 'london': (180, 360), 'ny': (480, 690)}
res = []
for kind in ('triple', 'hs', 'pdh_pdl_sweep', 'asia_sweep', 'round_number_reject', 'rsi_divergence'):
    base = signals(kind)
    print(kind, len(base), 'confirmed signals', flush=True)
    for tf, wn in itertools.product(['any', 'with', 'against'], WIN):
        w0, w1 = WIN[wn]
        sg = [x for x in base if w0 <= mins[x[0]] < w1 and (tf == 'any' or (tf == 'with' and x[1] == TREND[x[0]]) or (tf == 'against' and x[1] == -TREND[x[0]]))]
        if len(sg) < 60: continue
        for tmode, buf in itertools.product(['1R', '2R', 'measured', 'trail'], [0.1, 0.5]):
            rows = sim(sg, tmode, buf)
            A, B = acct(rows, 2004, 2011), acct(rows, 2012, 2018)
            res.append(dict(P=dict(pattern=kind, trend=tf, window=wn, target=tmode, stop_buffer=buf), A=A, B=B, rows=rows))
ok = [r for r in res if r['A']['tot'] > 0 and r['B']['tot'] > 0 and r['A']['bl'] == 0 and r['B']['bl'] == 0 and r['A']['n'] + r['B']['n'] >= 60]
ok.sort(key=lambda r: -min(r['A']['wk'], r['B']['wk']))
print(f'\n{len(res)} settings tested, {len(ok)} positive in both 2004-11 and 2012-18 without blowing a 50K\n')
for r in ok[:10]:
    V, X = acct(r['rows'], 2019, 2025), acct(r['rows'], 2026, 2026)
    print(f"{r['P']}\n   2004-11 ${r['A']['wk']:+.0f}/wk | 2012-18 ${r['B']['wk']:+.0f}/wk | 2019-25 ${V['wk']:+.0f}/wk dd ${V['dd']:,.0f} blown {V['bl']} | "
          f"2026 ${X['wk']:+.0f}/wk dd ${X['dd']:,.0f} blown {X['bl']} | {r['A']['n'] + r['B']['n'] + V['n'] + X['n']} trades, win {r['B']['win']:.0f}%")
