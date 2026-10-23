# usage: python3 scripts/xau-compass-replay.py <MT5 M5 export .csv> [equity.png]
# Replays the Gold Compass EA (mt5/QB_GoldCompass.mq5) rules bar by bar on 2004-2026 XAUUSD in dollars, for a $25,000
# account: trend pullback, long only, daily + 4h + 1h trend agree, 14:00-20:00 broker time, stop 2 x ATR14, target 3R,
# next-bar fills, real spread + 0.10 slippage, stop first when both hit in one bar. Day rules: stop after 2 losses or
# -2% on the day. Reports each risk level per year, the worst drawdown and whether a 10% max-loss rule would be hit.
import sys, numpy as np
src = open(__file__.replace('xau-compass-replay.py', 'xau-indicator-research.py')).read()
src = src[:src.index('from multiprocessing import Pool')]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'compass-replay.png'
sys.argv = ['x', sys.argv[1], '/dev/null']
g = {}; exec(src, g)
START = 25000.0
curves = {}
for tf, hold in [('15min', 64), ('5min', 96)]:
    b = g['frame'](tf)
    p = dict(th=20, d1=True, h1=True, s0=14, s1=20, k=2.0, R=3.0, short=False, hold=hold)
    res = g['simulate'](b, g['signals'](b, 'pullback', p), p)
    days = b.index.normalize()
    for risk_pct in (0.25, 0.5, 1.0):
        curve = []; eq = START; peak = START; dd = 0; breach = None; per_year = {}; day = None; dl = 0; dp = 0; n = 0
        for y, r, i in res:
            d = days[i]
            if d != day: day, dl, dp = d, 0, 0.0
            if dl >= 2 or dp <= -0.02 * START: continue   # the day is locked
            usd = r * START * risk_pct / 100           # fixed $ risk from the starting balance (prop-style)
            eq += usd; dp += usd; n += 1
            if r < 0: dl += 1
            per_year[y] = per_year.get(y, 0) + usd
            curve.append((d, eq))
            peak = max(peak, eq); dd = max(dd, peak - eq)
            if breach is None and START - eq >= 0.10 * START: breach = str(d.date())
        name = 'M15' if tf == '15min' else 'M5'
        curves.setdefault(name, {})[risk_pct] = curve
        print(f"{name} risk {risk_pct}% (${START * risk_pct / 100:.0f}/trade): {n} trades, end ${eq:,.0f}, worst drawdown ${dd:,.0f}, "
              f"10% max loss hit: {breach or 'never'}")
        print('   ', ' '.join(f"{y}:{v:+,.0f}" for y, v in sorted(per_year.items())))

# Equity curves at 0.25% risk to a PNG (argv[2])
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(11, 5), facecolor='#0b0b0c'); ax.set_facecolor('#0b0b0c')
for (name, c) in [('M15', '#22c55e'), ('M5', '#ef4444')]:
    xs = curves[name][0.25]; ax.plot([d for d, _ in xs], [e for _, e in xs], color=c, label=f'{name}, $62.50 risk per trade')
ax.axhline(START * 0.9, color='#f59e0b', ls='--', lw=1, label='10% max loss ($22,500)'); ax.axhline(START, color='#555', lw=0.8)
ax.set_title('QB Gold Compass replay, XAUUSD 2004-2026, $25k account', color='#e5e5e5'); ax.tick_params(colors='#aaa')
for s_ in ax.spines.values(): s_.set_color('#333')
ax.legend(facecolor='#161616', labelcolor='#ddd', edgecolor='#333'); ax.set_ylabel('Balance ($)', color='#aaa')
fig.tight_layout(); fig.savefig(OUT, dpi=110)
