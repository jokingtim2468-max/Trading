# usage: python3 gold_fast_pass.py <XAUUSD M5 export .csv>
# Fastest gold setup that still passes a LucidFlex 50K evaluation (+$3,000 before the $2,000 EOD trailing max loss,
# $1,200 daily loss limit) at least 60% of the time. An evaluation is started on every Monday from 2008 to 2025 and
# played forward on the real sessions; reported: pass rate, fail rate, median weeks to pass. 2026 starts shown apart.
# Setups (all flat by 16:40 ET): trend = daily EMA13/55 cross, trail 1.5 x daily ATR, held each session 18:00-16:40;
#   night = long 18:00-02:00 ET every session; night_calm = night only when GVZ < its 1-year median and CPI y/y rising;
#   trend+night = both. Sizes 1-6 MGC.
import sys, numpy as np, pandas as pd
df = pd.read_csv(sys.argv[1], sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
b = b[b.index.weekday < 5]
m = b.index.hour * 60 + b.index.minute
full = b[(m >= 18 * 60) | (m <= 16 * 60 + 40)].copy(); full['s'] = (full.index + pd.Timedelta(hours=6)).normalize()
S = full.groupby('s').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
S = S[(S.n > 150) & (S.index.weekday < 5)]
nm = full[(full.index.hour * 60 + full.index.minute >= 18 * 60) | (full.index.hour < 2)]
N = nm.groupby('s').agg(o=('o', 'first'), l=('l', 'min'), c=('c', 'last')).reindex(S.index)
COST = 0.40
pc = S.c.shift(1); A = np.maximum(S.h - S.l, np.maximum((S.h - pc).abs(), (S.l - pc).abs())).rolling(20).mean().values
o, h, l, c = S.o.values, S.h.values, S.l.values, S.c.values
f = pd.Series(c).ewm(span=13, adjust=False).mean().values; s5 = pd.Series(c).ewm(span=55, adjust=False).mean().values
tp = np.zeros(len(c)); tw = np.zeros(len(c)); pos = 0; trail = best = 0.0; age = 0
for i in range(60, len(c)):
    if pos:
        tw[i] = min(0, l[i] - o[i]) - COST
        if l[i] <= trail: tp[i] = trail - o[i] - COST; pos = 0; continue
        tp[i] = c[i] - o[i] - COST; age += 1; best = max(best, c[i]); trail = max(trail, best - 1.5 * A[i])
        if age >= 60: pos = 0
    elif f[i] > s5[i] and f[i - 1] <= s5[i - 1] and A[i] > 0: pos = 1; best = c[i]; trail = c[i] - 1.5 * A[i]; age = 0
npnl = (N.c - N.o).values - COST; nw = (N.l - N.o).values - COST
npnl = np.nan_to_num(npnl); nw = np.nan_to_num(nw)
g = pd.read_csv('data/GVZCLS.csv'); g['d'] = pd.to_datetime(g.observation_date); g = g.set_index('d').GVZCLS.astype(float).dropna()
calm = (g < g.rolling(252, min_periods=100).median()).shift(1).reindex(S.index, method='ffill').fillna(False).values
cp = pd.read_csv('data/CPIAUCSL.csv'); cp['d'] = pd.to_datetime(cp.observation_date); cp = cp.set_index('d').CPIAUCSL.astype(float)
yoy = cp.pct_change(12); up = (yoy > yoy.shift(3)); up.index = up.index + pd.Timedelta(days=45)
infl = up.reindex(S.index, method='ffill').fillna(False).values
SET = {'trend': (tp, tw), 'night': (npnl, nw), 'night_calm': (np.where(calm & infl, npnl, 0), np.where(calm & infl, nw, 0)),
       'trend+night': (tp + npnl, np.minimum(tw, 0) + np.minimum(nw, 0))}
days = S.index; yrs = days.year.values
starts = [i for i in range(len(days)) if days[i].weekday() == 0]

def evaluate(p, w, q, idx):
    res = []
    for s0 in idx:
        eq, fl = 0.0, -2000.0
        for j in range(s0, len(p)):
            x = -1200.0 if w[j] * 10 * q <= -1200 else p[j] * 10 * q
            eq += x
            if eq <= fl: res.append(('fail', j - s0)); break
            if eq >= 3000: res.append(('pass', j - s0)); break
            if eq > 0: fl = max(fl, min(0.0, eq - 2000.0))
        else: res.append(('open', 0))
    done = [r for r in res if r[0] != 'open']
    if not done: return None
    pr = np.mean([r[0] == 'pass' for r in done]); wk = np.median([r[1] / 5 for r in done if r[0] == 'pass']) if pr > 0 else np.inf
    return pr, 1 - pr, wk, len(done)

hist = [s for s in starts if 2008 <= yrs[s] <= 2025]; recent = [s for s in starts if yrs[s] == 2026]
print('LucidFlex 50K evaluation: +$3,000 target before the $2,000 trailing max loss\n')
rows = []
for name, (p, w) in SET.items():
    for q in range(1, 7):
        r = evaluate(p, w, q, hist)
        if r is None: continue
        r26 = evaluate(p, w, q, recent)
        rows.append((name, q, r, r26))
        print(f"{name:12s} {q} MGC | 2008-2025 starts: pass {100 * r[0]:3.0f}%, fail {100 * r[1]:3.0f}%, median {r[2]:5.1f} weeks to pass"
              + (f" | 2026 starts: pass {100 * r26[0]:3.0f}%, median {r26[2]:4.1f} weeks" if r26 else ''), flush=True)
ok = [x for x in rows if x[2][1] <= 0.40]
if ok:
    best = min(ok, key=lambda x: x[2][2])
    print(f'\nFASTEST WITH FAIL <= 40%: {best[0]} at {best[1]} MGC: pass {100 * best[2][0]:.0f}%, median {best[2][2]:.1f} weeks')
