# usage: python3 scripts/bot-improver.py <XAUUSD M5 export> <NQ M5 export> [iterations=0 (forever)]
# Automatic test -> improve -> test loop for the QB Signal Bot. Runs on its own; the 5-minute check only watches it.
#   1. Once: every strategy/setting/target/trend version from scripts/strategy-lab.py is simulated (one trade a day) and
#      each trade is saved with its features (hour, weekday, volatility regime, trend agreement, gap direction).
#   2. Forever: try a new bot = trade filters (hours, weekdays, volatility regime, gap rule) + a yearly selector
#      (look-back years, how candidates are ranked, how many setups run together). Score it with a WALK-FORWARD on
#      2019-2025: each year is traded with setups chosen only on the years before it.
#   3. Keep it when it beats the best so far (total R, with every losing year penalised) -> research/bot-best.json.
#   2026 is NOT used by the improver at all: it is the final exam, printed for the best bot only (research/bot-best.json).
# Every try is appended to research/bot-improver-log.jsonl. Random search with mutations of the current best.
import sys, os, json, time, pickle, random, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'scripts', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
ARGS = sys.argv[:]
sys.argv = ['x', ARGS[1], ARGS[2], '/dev/null']
g = {}; exec(src, g)
ITERS = int(ARGS[3]) if len(ARGS) > 3 else 0
# The cache is written by this script itself (never a downloaded file), so loading it with pickle is safe
CACHE = os.path.join(os.path.dirname(os.path.abspath(ARGS[1])), 'improver-trades.pkl')
BEST = os.path.join(ROOT, 'research', 'bot-best-v2.live.json')   # live file (gitignored); copied to bot-best-v2.json on each check; LOG = os.path.join(ROOT, 'research', 'bot-improver-log.jsonl')

def sim_first(x, m, side, stop, tgt):
    """one trade a day: the first signal; -> list of (bar index, R after costs)"""
    o, h, l, c, last, days = x.o.values, x.h.values, x.l.values, x.c.values, x.last.values, x.day.values
    out = []; taken = set(); idx = np.flatnonzero(side)
    for i in idx:
        d = days[i]
        if d in taken or i + 1 >= len(c) or last[i] <= i: continue
        s = side[i]; e = o[i + 1]; sd = stop[i]
        if not (sd > 0): continue
        taken.add(d)
        sp = e - s * sd; tp = e + s * tgt[i] if np.isfinite(tgt[i]) else None
        hh, ll = h[i + 1:last[i] + 1], l[i + 1:last[i] + 1]
        hs = np.flatnonzero(ll <= sp) if s > 0 else np.flatnonzero(hh >= sp)
        ht = (np.flatnonzero(hh >= tp) if s > 0 else np.flatnonzero(ll <= tp)) if tp is not None else np.array([], int)
        js = hs[0] if len(hs) else 10**9; jt = ht[0] if len(ht) else 10**9
        if js <= jt and js < 10**9: pts = -sd
        elif jt < 10**9: pts = tgt[i]
        else: pts = (c[last[i]] - e) * s
        out.append((i, (pts - m['slip']) / sd - g['COMM'] / max(sd * m['pv'], 1e-9)))
    return out

def build():
    cands = []
    for mkt, m in g['MK'].items():
        x = g['prep'](g['load'](m['file']), m)
        atr_reg = (x.atr / x.atr.rolling(2000, min_periods=200).median()).values
        tdir = np.sign(x.c.values - x.e200.values); gap = np.sign((x.dopen - x.pdc).values)
        hours = x.index.hour.values; wd = x.index.weekday.values; yrs = x.year.values; days = x.day.values
        for s, grid in g['GRID'].items():
            seen = set()
            for p in grid:
                for R in (None, 1.0, 2.0, 3.0):
                    q = dict(p); q['R'] = R
                    key = tuple(sorted((k, str(v)) for k, v in q.items()))
                    if key in seen: continue
                    seen.add(key)
                    side, stop, tgt = g['signals'](x, m, s, q)
                    tr = sim_first(x, m, side, stop, tgt)
                    if len(tr) < 100: continue
                    ii = np.array([i for i, _ in tr]); r = np.array([v for _, v in tr])
                    df = pd.DataFrame(dict(day=pd.DatetimeIndex(days[ii]), y=yrs[ii], hour=hours[ii], wd=wd[ii], vol=atr_reg[ii],
                                           withtrend=(side[ii] == tdir[ii]), withgap=(side[ii] == gap[ii]), r=r))
                    cands.append(dict(name=f'{mkt} {s} {q}', mkt=mkt, s=s, p=q, t=df))
            print(mkt, s, len(cands), flush=True)
    return cands

if os.path.exists(CACHE): cands = pickle.load(open(CACHE, 'rb'))
else: cands = build(); pickle.dump(cands, open(CACHE, 'wb'))
print(len(cands), 'candidate setups cached', flush=True)

SPACE = dict(trend=['any', 'with', 'against'], gap=['any', 'with', 'against'], vol=['any', 'high', 'low'],
             h0=[0, 2, 3, 7, 8, 9, 10, 11], h1=[10, 11, 12, 13, 14, 15, 16, 24], days=['all', 'no_mon', 'no_fri', 'mid_week'],
             look=[2, 3, 4, 5, 6], rank=['worst_year', 'mean', 'mean_minus_sd'], topk=[1, 2, 3, 4, 5], min_trades=[30, 60, 100, 150])

def filt(df, B):
    k = np.ones(len(df), bool)
    if B['trend'] == 'with': k &= df.withtrend.values
    if B['trend'] == 'against': k &= ~df.withtrend.values
    if B['gap'] == 'with': k &= df.withgap.values
    if B['gap'] == 'against': k &= ~df.withgap.values
    if B['vol'] == 'high': k &= df.vol.values > 1.0
    if B['vol'] == 'low': k &= df.vol.values <= 1.0
    k &= (df.hour.values >= B['h0']) & (df.hour.values < B['h1'])
    if B['days'] == 'no_mon': k &= df.wd.values != 0
    if B['days'] == 'no_fri': k &= df.wd.values != 4
    if B['days'] == 'mid_week': k &= (df.wd.values >= 1) & (df.wd.values <= 3)
    return df[k]

def walk(B, years):
    """-> per-year total R (each year traded with setups chosen only on earlier years), choices"""
    F = [(c, filt(c['t'], B)) for c in cands]
    out, picks = {}, {}
    for Y in years:
        scored = []
        for c, df in F:
            past = df[(df.y >= Y - B['look']) & (df.y < Y)]
            if past.y.nunique() < B['look'] or len(past) < B['min_trades']: continue
            by = past.groupby('y').r.mean()
            if (by <= 0).any(): continue
            sc = by.min() if B['rank'] == 'worst_year' else by.mean() if B['rank'] == 'mean' else by.mean() - by.std()
            scored.append((sc, c['name'], df))
        scored.sort(key=lambda z: -z[0])
        top = scored[:B['topk']]
        picks[Y] = [n for _, n, _ in top]
        out[Y] = float(sum(df[df.y == Y].r.sum() for _, _, df in top)) / max(1, len(top))   # equal risk split across setups
    return out, picks

def score(per_year):
    # robust score: the worse of 2019-2022 and 2023-2025 (per year), losing years counted three times. A bot that only
    # shines in one half (the search fitting a few lucky years) no longer wins.
    v = {int(k): x for k, x in per_year.items()}
    def part(ys):
        a = np.array([v[y] for y in ys if y in v]); return float((a.sum() + 2.0 * a[a < 0].sum()) / max(1, len(a)))
    return min(part(range(2019, 2023)), part(range(2023, 2026)))

def rand_bot(): return {k: random.choice(v) for k, v in SPACE.items()}
def mutate(B):
    B = dict(B)
    for k in random.sample(list(SPACE), random.choice([1, 1, 2, 3])): B[k] = random.choice(SPACE[k])
    if B['h1'] <= B['h0']: B['h1'] = 24
    return B

best = json.load(open(BEST)) if os.path.exists(BEST) else None
TRAIN = range(2019, 2026)
it = 0
while ITERS == 0 or it < ITERS:
    it += 1
    B = mutate(best['bot']) if best and random.random() < 0.7 else rand_bot()
    if B['h1'] <= B['h0']: B['h1'] = 24
    per, picks = walk(B, TRAIN)
    sc = score(per)
    rec = dict(t=time.strftime('%Y-%m-%d %H:%M:%S'), bot=B, score=round(sc, 2), totalR=round(sum(per.values()), 1),
               losing_years=int(sum(v < 0 for v in per.values())), per_year={str(k): round(v, 1) for k, v in per.items()})
    with open(LOG, 'a') as f: f.write(json.dumps(rec) + '\n')
    if best is None or sc > best['score'] + 0.01:
        exam, exam_picks = walk(B, [2026])
        best = dict(rec, picks={str(k): v for k, v in picks.items()}, exam_2026_R=round(exam[2026], 1), exam_2026_picks=exam_picks[2026],
                    note='score = the worse of 2019-2022 and 2023-2025 walk-forward R per year (losing years 3x); 2026 is never used to choose')
        json.dump(best, open(BEST, 'w'), indent=1)
        print(f"[{rec['t']}] it {it}: NEW BEST score {sc:.1f}, 2019-2025 total {rec['totalR']}R, losing years {rec['losing_years']}, "
              f"2026 exam {best['exam_2026_R']}R | {B}", flush=True)
    elif it % 25 == 0:
        print(f"[{rec['t']}] it {it}: best still {best['score']:.1f}", flush=True)
