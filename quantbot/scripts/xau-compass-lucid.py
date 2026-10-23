# usage: python3 scripts/xau-compass-lucid.py <MT5 M5 export .csv>
# Gold Compass M15 on a Lucid-style 25K Flex eval (micro gold MGC, $10 per $1): target +$1,250, $1,000 end-of-day
# trailing max loss, $600 daily loss limit, 50% consistency (best day <= 50% of profit), 20 micros max.
# Starts an eval on the first trading day of every month 2004-2026 and plays the real trade sequence forward.
import sys, numpy as np, pandas as pd
src = open(__file__.replace('xau-compass-lucid.py', 'xau-indicator-research.py')).read()
src = src[:src.index('from multiprocessing import Pool')]
sys.argv = ['x', sys.argv[1], '/dev/null']
g = {}; exec(src, g)
b = g['frame']('15min')
p = dict(th=20, d1=True, h1=True, s0=14, s1=20, k=2.0, R=3.0, short=False, hold=64)
res = g['simulate'](b, g['signals'](b, 'pullback', p), p)
days = b.index.normalize(); atr = b.atr.values
trades = [(days[i], r, atr[i] * 2.0) for y, r, i in res]   # stop distance in $ of gold price
for risk in (100, 200, 300):
    out = {'pass': 0, 'fail': 0, 'open': 0}; dpd = []
    starts = sorted({d.to_period('M') for d, _, _ in trades})
    for m in starts:
        seq = [t for t in trades if t[0].to_period('M') >= m]
        eq = 0.0; floor = -1000.0; best = 0.0; day = None; dp = 0.0; dl = 0; nd = 0; res_ = 'open'
        for d, r, stop in seq:
            if d != day:
                if day is not None:
                    best = max(best, dp); floor = max(floor, min(0.0, eq - 1000.0)) if eq > 0 else floor  # EOD trail, locks at start
                    if eq >= 1250 and best <= 0.5 * eq: res_ = 'pass'; break
                day, dp, dl = d, 0.0, 0; nd += 1
                if nd > 90: break
            if dp <= -600: continue
            micros = max(1, min(20, int(risk / (stop * 10))))
            usd = r * stop * 10 * micros
            eq += usd; dp += usd
            if eq <= floor: res_ = 'fail'; break
        out[res_] += 1
        if res_ == 'pass': dpd.append(nd)
    tot = sum(out.values())
    print(f"risk ${risk}/trade: pass {out['pass']}/{tot} ({100*out['pass']/tot:.0f}%), fail {out['fail']}, no result in 90 days {out['open']}, median days to pass {np.median(dpd) if dpd else '-'}")
