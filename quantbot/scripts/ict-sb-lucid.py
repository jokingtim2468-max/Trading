# usage: python3 scripts/ict-sb-lucid.py <XAUUSD M5 export> <NQ M5 export>
# Replays strategies/qb-ict-silver-bullet-lucid.pine bar by bar (same rules) on 2004-2026 gold and 2012-2026 NQ:
#   - window 10:00-11:00 ET (Silver Bullet); liquidity = the nearer of the 09:30-10:00 range and the overnight high/low
#   - sweep: a bar trades through a liquidity level; MSS: a later close beyond the last swing (3-bar fractal) the
#     other way, made by a displacement bar (range > 1 x ATR14, tick volume above its 20-bar average)
#   - FVG left by the displacement (3-bar gap); limit entry at the FVG middle, stop beyond the sweep extreme,
#     target 2R; the order is cancelled at 11:30 ET if not filled; any open trade is closed at 15:55 ET
#   - size: fixed $ risk (default $150) / (stop x $ per point), micros (MNQ $2/pt, MGC $10/$1), at least 1, max 100;
#     a trade whose 1-micro risk is over 2x the $ risk is skipped
#   - day stops at +$250 or -$300 (2 losses); costs 1 tick slippage each side + $1.50 commission per micro
# Account: LucidFlex 150K, $4,500 EOD trailing max loss (locks at the start balance), blown = reset + counted.
import sys, numpy as np, pandas as pd
RISK, CAP_DAY, LOSS_DAY, RR, VOLX, DISP = 150.0, 250.0, -300.0, 2.0, 1.0, 1.0
MK = {'NQ': dict(f=sys.argv[2], pv=2.0, tick=0.25), 'XAUUSD': dict(f=sys.argv[1], pv=10.0, tick=0.10)}

def load(f):
    df = pd.read_csv(f, sep='\t')
    t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
    b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values,
                      'v': df['<TICKVOL>'].values.astype(float)}, index=t)
    b = b[b.index.weekday < 5]
    pc = b.c.shift(1)
    b['atr'] = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs())).rolling(14).mean()
    b['vavg'] = b.v.rolling(20).mean()
    b['mins'] = b.index.hour * 60 + b.index.minute
    b['day'] = b.index.normalize()
    return b

def run(m):
    b = load(m['f']); out = []
    real_vol = b.v.std() > 1.0   # the NQ export has a constant tick volume (5): no volume filter there
    print(m['f'].split('/')[-1], 'volume filter', 'on' if real_vol else 'off (no real volume in this data)', flush=True)
    for d, g in b.groupby('day'):
        mins = g.mins.values
        if not ((mins == 570).any() and (mins == 600).any()): continue
        o, h, l, c, v, va, atr = (g[k].values for k in ('o', 'h', 'l', 'c', 'v', 'vavg', 'atr'))
        pre = mins < 570; orr = (mins >= 570) & (mins < 600)
        if not pre.any(): continue
        levels_hi = [h[pre].max(), h[orr].max()]; levels_lo = [l[pre].min(), l[orr].min()]
        day_pnl = 0.0; losses = 0; swept = 0; sweep_ext = None; pending = None; pos = None
        for j in range(3, len(g)):
            t = mins[j]
            if t > 16 * 60 - 5: break
            if pos:  # manage the open trade
                s, e, sl, tp, n = pos
                hit_s = (l[j] <= sl) if s > 0 else (h[j] >= sl)
                hit_t = (h[j] >= tp) if s > 0 else (l[j] <= tp)
                ex = sl if hit_s else tp if hit_t else (c[j] if t >= 15 * 60 + 55 else None)
                if ex is not None:
                    pts = (ex - e) * s - 2 * m['tick']
                    pnl = pts * m['pv'] * n - 1.5 * n
                    out.append((d, pnl)); day_pnl += pnl; losses += pnl < 0; pos = None
                continue
            if day_pnl >= CAP_DAY or day_pnl <= LOSS_DAY or losses >= 2: break
            if pending:  # waiting for the limit fill at the FVG middle
                s, ent, sl = pending
                if t >= 11 * 60 + 30: pending = None; continue
                if (s > 0 and l[j] <= ent) or (s < 0 and h[j] >= ent):
                    stop = abs(ent - sl)
                    n = int(RISK // (stop * m['pv'])) if stop > 0 else 0
                    if n < 1 and stop * m['pv'] <= 2 * RISK: n = 1
                    n = min(n, 100)
                    if n >= 1: pos = (s, ent + s * m['tick'], sl, ent + s * RR * stop, n)
                    pending = None
                continue
            if not (600 <= t < 660): continue
            # sweep of liquidity inside the window
            if h[j] > min(levels_hi):
                sweep_ext = max(h[j], sweep_ext) if swept == -1 else h[j]; swept = -1
            if l[j] < max(levels_lo):
                sweep_ext = min(l[j], sweep_ext) if swept == 1 else l[j]; swept = 1
            if swept == 0 or not (atr[j] > 0) or not (va[j] > 0): continue
            # last 3-bar swing before this bar
            disp = (h[j] - l[j]) > DISP * atr[j] and (not real_vol or v[j] > VOLX * va[j])
            if not disp: continue
            if swept == 1:   # swept lows -> look for a bullish MSS + FVG
                sh = [h[k] for k in range(max(1, j - 12), j - 1) if h[k] > h[k - 1] and h[k] > h[k + 1]]
                if sh and c[j] > sh[-1] and l[j] > h[j - 2] and c[j] > o[j]:
                    fvg_mid = (l[j] + h[j - 2]) / 2; pending = (1, fvg_mid, sweep_ext - m['tick'])
            else:
                sl_ = [l[k] for k in range(max(1, j - 12), j - 1) if l[k] < l[k - 1] and l[k] < l[k + 1]]
                if sl_ and c[j] < sl_[-1] and h[j] < l[j - 2] and c[j] < o[j]:
                    fvg_mid = (h[j] + l[j - 2]) / 2; pending = (-1, fvg_mid, sweep_ext + m['tick'])
    return pd.Series(dict(_agg(out))).sort_index() if out else pd.Series(dtype=float)

def _agg(rows):
    s = {}
    for d, p in rows: s[d] = s.get(d, 0.0) + p
    return s.items()

def account(daily, lo, hi):
    x = daily[(daily.index.year >= lo) & (daily.index.year <= hi)]
    eq, floor, blown = 0.0, -4500.0, 0
    for p in x.values:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -4500.0; continue
        if eq > 0: floor = max(floor, min(0.0, eq - 4500.0))
    wk = x.groupby(x.index.to_period('W')).sum()
    allw = pd.period_range(f'{lo}-01-01', f'{hi}-12-31', freq='W'); wk = wk.reindex(allw[(allw.start_time >= x.index.min()) & (allw.start_time <= x.index.max())], fill_value=0.0)
    e = x.cumsum()
    return dict(trade_days=len(x), win_days=round(float((x > 0).mean() * 100), 1), avg_week=round(float(wk.mean())) if len(wk) else 0, median_week=round(float(wk.median())) if len(wk) else 0,
                weeks_1k=int((wk >= 1000).sum()), weeks=len(wk), best_day=round(float(x.max())), worst_day=round(float(x.min())),
                max_dd=round(float((e.cummax() - e).max())), blown=blown, total=round(float(x.sum())))

for name, m in MK.items():
    d = run(m)
    if d.empty: print(name, "no trades"); continue
    print(name, 'all years', account(d, d.index.min().year, d.index.max().year), flush=True)
    print(name, '2022-2026 ', account(d, 2022, 2026), flush=True)
