# usage: python3 scripts/xau-judas-lucid.py <XAUUSD M5 MT5 export>
# Gold-specific liquidity-sweep model ("Judas swing") on 2004-2026 XAUUSD, micro gold (MGC, $10 per $1):
#   - Asian range = 19:00-02:00 ET; windows: London 03:00-05:00 ET and NY 08:30-10:30 ET only
#   - setup: a sweep of the Asian high (or low), then a market structure shift the other way: a displacement bar
#     (range > 1 x ATR14, tick volume above its 20-bar average) closing beyond the last 1-1 pivot; enter on the next
#     bar's open (no FVG wait)
#   - stop = k x ATR14 from the entry (k = 1.5 or 2.0), target 2R; scale-out: 50% closed at 1R, the runner keeps the
#     ORIGINAL stop and aims for 2R; flat at 15:55 ET
#   - size: fixed $ risk ($100 or $150) / (stop x $10) micros, rounded down, at least 2 so half can be closed
#     (skipped if 2 micros would risk more than 2x the $ risk); one trade per window, day stops at +$250 / -$300 / 2 losses
#   - costs: $0.10 slippage each side + $1.50 commission per micro; stop counts first when both are hit in one bar
# Compared against: (a) no scale-out, hold all for 2R; (b) breakeven at 1R. Expectancy in R and $ per trade.
import sys, numpy as np, pandas as pd
F = sys.argv[1]
PV, SLIP, COMM = 10.0, 0.10, 1.5

df = pd.read_csv(F, sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values,
                  'v': df['<TICKVOL>'].values.astype(float)}, index=t)
pc = b.c.shift(1)
b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
b['vavg'] = b.v.rolling(20).mean()
b['mins'] = b.index.hour * 60 + b.index.minute
b['sday'] = (b.index + pd.Timedelta(hours=5)).normalize()      # a session day starts at 19:00 ET
asia = b[(b.mins >= 19 * 60) | (b.mins < 120)].groupby('sday').agg(ah=('h', 'max'), al=('l', 'min'))
b = b.join(asia, on='sday')
b = b[(b.index.weekday < 5)]
o, h, l, c, v, va, atr, mins, AH, AL, sd = (b[k].values for k in ('o', 'h', 'l', 'c', 'v', 'vavg', 'atr', 'mins', 'ah', 'al', 'sday'))
WINDOWS = [(180, 300), (510, 630)]
n = len(c)

def trades(k, mode):
    """mode: 'scale' (50% at 1R, runner to 2R, original stop), 'hold' (all to 2R), 'be' (all to 2R, stop to BE at 1R)
       -> list of (session day, R multiple before costs, stop $ per micro)"""
    out = []; j = 300
    while j < n - 1:
        t_ = mins[j]
        w = next((x for x in WINDOWS if x[0] <= t_ < x[1]), None)
        if w is None or not (atr[j] > 0) or np.isnan(AH[j]): j += 1; continue
        # scan this window for sweep -> MSS
        day = sd[j]; swept = 0; entered = False
        while j < n - 1 and sd[j] == day and w[0] <= mins[j] < w[1]:
            if h[j] > AH[j]: swept = -1
            if l[j] < AL[j]: swept = 1
            if swept and (h[j] - l[j]) > atr[j] and v[j] > va[j]:
                s = swept
                if s > 0:
                    piv = [h[q] for q in range(max(1, j - 12), j - 1) if h[q] > h[q - 1] and h[q] > h[q + 1]]
                    ok = piv and c[j] > piv[-1] and c[j] > o[j]
                else:
                    piv = [l[q] for q in range(max(1, j - 12), j - 1) if l[q] < l[q - 1] and l[q] < l[q + 1]]
                    ok = piv and c[j] < piv[-1] and c[j] < o[j]
                if ok:
                    e = o[j + 1] + s * SLIP; R = k * atr[j]; stop = e - s * R; t1 = e + s * R; t2 = e + s * 2 * R
                    half = False; res = 0.0; q = j + 1; be_stop = stop
                    while q < n and sd[q] == day and mins[q] < 955:
                        st = be_stop if mode == 'be' else stop
                        if (s > 0 and l[q] <= st) or (s < 0 and h[q] >= st):
                            rr = (st - e) * s / R
                            res = (0.5 * 1.0 + 0.5 * rr) if half else rr; break
                        if (s > 0 and h[q] >= t2) or (s < 0 and l[q] <= t2):
                            res = (0.5 * 1.0 + 0.5 * 2.0) if half else 2.0; break
                        if (s > 0 and h[q] >= t1) or (s < 0 and l[q] <= t1):
                            if mode == 'scale': half = True
                            if mode == 'be': be_stop = e + s * SLIP
                        q += 1
                    else:
                        q = min(q, n - 1); rr = (c[q - 1] - e) * s / R
                        res = (0.5 * 1.0 + 0.5 * rr) if half else rr
                    out.append((pd.Timestamp(day), res, R * PV, half))
                    entered = True; j = q
                    break
            j += 1
        if not entered:
            while j < n - 1 and sd[j] == day and w[0] <= mins[j] < w[1]: j += 1
        j += 1
    return out

def dollars(tr, risk):
    """$ per trade with micros sized to the risk (min 2), slippage on the exit and commissions; day stops applied"""
    rows = []; dp = {}; dl = {}
    for d, r, stop_usd, half in tr:
        if dp.get(d, 0) >= 250 or dp.get(d, 0) <= -300 or dl.get(d, 0) >= 2: continue
        q = int(risk // stop_usd)
        if q < 2:
            if 2 * stop_usd > 2 * risk: continue
            q = 2
        pnl = r * stop_usd * q - SLIP * PV * q - COMM * q
        rows.append((d, pnl, r, q)); dp[d] = dp.get(d, 0) + pnl; dl[d] = dl.get(d, 0) + (pnl < 0)
    return rows

def summary(rows, lo, hi):
    x = [(d, p, r) for d, p, r, q in rows if lo <= d.year <= hi]
    if len(x) < 20: return f'{len(x)} trades'
    P = np.array([p for _, p, _ in x]); Rr = np.array([r for _, _, r in x])
    streak = mx = 0
    for p in P: streak = streak + 1 if p < 0 else 0; mx = max(mx, streak)
    s = pd.Series(P, index=[d for d, _, _ in x]).groupby(level=0).sum()
    allw = pd.period_range(f'{lo}-01-01', f'{hi}-12-31', freq='W')
    wk = s.groupby(s.index.to_period('W')).sum().reindex(allw[(allw.start_time >= s.index.min()) & (allw.start_time <= s.index.max())], fill_value=0.0)
    e = s.cumsum(); eq = 0.0; floor = -4500.0; blown = 0
    for p in s.values:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -4500.0; continue
        if eq > 0: floor = max(floor, min(0.0, eq - 4500.0))
    return (f"{len(P)} trades, win {100 * (P > 0).mean():.0f}%, expectancy {Rr.mean():+.3f}R before costs, ${P.mean():+.1f}/trade after costs, "
            f"PF {P[P > 0].sum() / max(1e-9, -P[P < 0].sum()):.2f}, longest losing streak {mx}, avg week ${wk.mean():+.0f}, "
            f"weeks >= $1k {int((wk >= 1000).sum())}, max drawdown ${float((e.cummax() - e).max()):,.0f}, 150K blown {blown}, total ${P.sum():+,.0f}")

for k in (1.5, 2.0):
    for mode, label in (('scale', 'scale-out 50% at 1R, runner to 2R, original stop'), ('hold', 'hold all to 2R'), ('be', 'breakeven at 1R')):
        tr = trades(k, mode)
        for risk in (100, 150):
            rows = dollars(tr, risk)
            print(f"stop {k} ATR | {label} | ${risk} risk\n   2004-2026: {summary(rows, 2004, 2026)}\n   2022-2026: {summary(rows, 2022, 2026)}", flush=True)
