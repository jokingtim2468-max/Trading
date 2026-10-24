# usage: python3 scripts/ict-sb-lucid-v2.py <XAUUSD M5 export> <NQ M5 export>
# ICT sweep -> MSS -> FVG strategy with the four filters requested, added one at a time so each one's effect shows:
#   1. HTF alignment: trade only with the 1h AND 4h trend (close vs EMA200 of each, closed bars only)
#   2. Volatility / momentum: ADX(14) > 20 and ATR14 above its 100-bar median on the 5-minute chart
#   3. Killzones only: London open 02:00-05:00 ET and NY AM 09:30-11:30 ET (no Asia); liquidity = high/low of the
#      6 hours before the killzone opens
#   4. Breakeven: stop to entry + 1 tick once the trade is +1R
# Same mechanics as scripts/ict-sb-lucid.py: displacement bar (range > 1 x ATR14, volume above average when the feed has
# real volume) closing beyond the last 1-1 pivot after the sweep and leaving an FVG; limit at the FVG middle, stop
# beyond the sweep extreme, 2R target; pending orders die 30 min after the killzone; flat at 15:55 ET.
# $150 fixed risk in micros (MNQ $2/pt, MGC $10/$), day stops at +$250 / -$300 / 2 losses, 1 tick slippage each side
# + $1.50 per micro. LucidFlex 150K: $4,500 EOD trailing max loss. Reported for all years and 2022-2026.
import sys, numpy as np, pandas as pd
RISK, CAP_DAY, LOSS_DAY, RR = 150.0, 250.0, -300.0, 2.0
MK = {'NQ': dict(f=sys.argv[2], pv=2.0, tick=0.25), 'XAUUSD': dict(f=sys.argv[1], pv=10.0, tick=0.10)}

def load(f):
    df = pd.read_csv(f, sep='\t')
    t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)
    b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values,
                      'v': df['<TICKVOL>'].values.astype(float)}, index=t)
    b = b[b.index.weekday < 5].copy()
    pc = b.c.shift(1)
    tr = np.maximum(b.h - b.l, np.maximum((b.h - pc).abs(), (b.l - pc).abs()))
    b['atr'] = tr.rolling(14).mean(); b['atr_med'] = b.atr.rolling(100).median(); b['vavg'] = b.v.rolling(20).mean()
    up, dn = b.h.diff(), -b.l.diff()
    pdm = np.where((up > dn) & (up > 0), up, 0.0); ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = tr.ewm(alpha=1 / 14).mean(); pdi = 100 * pd.Series(pdm, index=b.index).ewm(alpha=1 / 14).mean() / a
    ndi = 100 * pd.Series(ndm, index=b.index).ewm(alpha=1 / 14).mean() / a
    b['adx'] = (100 * (pdi - ndi).abs() / (pdi + ndi)).ewm(alpha=1 / 14).mean()
    for rule, name in (('1h', 'h1'), ('4h', 'h4')):
        x = b.c.resample(rule).last().dropna(); e = x.ewm(span=200).mean()
        tr_ = np.sign(x - e).shift(1); tr_.index = tr_.index + pd.tseries.frequencies.to_offset(rule)
        b[name] = tr_.reindex(b.index, method='ffill')
    b['mins'] = b.index.hour * 60 + b.index.minute
    b['day'] = b.index.normalize()
    return b

KZ_SB = [(600, 660)]                      # the original Silver Bullet hour
KZ = [(120, 300), (570, 690)]             # London open, NY AM

def run(b, m, htf, vol, kz, be):
    o, h, l, c, v, va, atr, am, adx, h1, h4, mins, day = (b[k].values for k in ('o', 'h', 'l', 'c', 'v', 'vavg', 'atr', 'atr_med', 'adx', 'h1', 'h4', 'mins', 'day'))
    real_vol = b.v.std() > 1.0
    zones = KZ if kz else KZ_SB
    n = len(c); out = {}; cur_day = None; dpnl = 0.0; dloss = 0
    zone = None; liqH = liqL = None; swept = 0; ext = None; pend = None; pos = None
    for j in range(300, n):
        t = mins[j]
        if day[j] != cur_day: cur_day, dpnl, dloss = day[j], 0.0, 0; pend = None
        if pos:
            s, e, sl, tp, q, R, moved = pos
            hs = l[j] <= sl if s > 0 else h[j] >= sl
            ht = h[j] >= tp if s > 0 else l[j] <= tp
            ex = sl if hs else tp if ht else (c[j] if t >= 955 else None)
            if ex is not None:
                pnl = ((ex - e) * s - 2 * m['tick']) * m['pv'] * q - 1.5 * q
                out[cur_day] = out.get(cur_day, 0.0) + pnl; dpnl += pnl; dloss += pnl < 0; pos = None
            elif be and not moved and ((h[j] - e) * s >= R if s > 0 else (e - l[j]) >= R):
                pos = (s, e, e + s * m['tick'], tp, q, R, True)
            continue
        if dpnl >= CAP_DAY or dpnl <= LOSS_DAY or dloss >= 2: continue
        # which killzone are we in
        zi = next((k for k, (a0, a1) in enumerate(zones) if a0 <= t < a1), None)
        if zi is not None and zone != (cur_day, zi):
            zone = (cur_day, zi); look = slice(max(0, j - 72), j)   # 6 hours of 5-minute bars before the zone
            liqH, liqL = h[look].max(), l[look].min(); swept = 0; ext = None; pend = None
        if pend:
            s, ent, sl, dead = pend
            if t >= dead or t >= 955: pend = None; continue
            if (s > 0 and l[j] <= ent) or (s < 0 and h[j] >= ent):
                R = abs(ent - sl); q = int(RISK // (R * m['pv'])) if R > 0 else 0
                if q < 1 and R * m['pv'] <= 2 * RISK: q = 1
                q = min(q, 100); pend = None
                if q >= 1: pos = (s, ent + s * m['tick'], sl, ent + s * RR * R, q, R, False)
            continue
        if zi is None or not (atr[j] > 0): continue
        if h[j] > liqH: ext = max(h[j], ext) if swept == -1 else h[j]; swept = -1
        if l[j] < liqL: ext = min(l[j], ext) if swept == 1 else l[j]; swept = 1
        if swept == 0: continue
        disp = (h[j] - l[j]) > atr[j] and (not real_vol or v[j] > va[j])
        if not disp: continue
        if vol and not (adx[j] > 20 and atr[j] > am[j]): continue
        s = swept
        if htf and not (h1[j] == s and h4[j] == s): continue
        if s > 0:
            piv = [h[k] for k in range(max(1, j - 12), j - 1) if h[k] > h[k - 1] and h[k] > h[k + 1]]
            if piv and c[j] > piv[-1] and c[j] > o[j] and l[j] > h[j - 2]:
                pend = (1, (l[j] + h[j - 2]) / 2, ext - m['tick'], zones[zi][1] + 30)
        else:
            piv = [l[k] for k in range(max(1, j - 12), j - 1) if l[k] < l[k - 1] and l[k] < l[k + 1]]
            if piv and c[j] < piv[-1] and c[j] < o[j] and h[j] < l[j - 2]:
                pend = (-1, (h[j] + l[j - 2]) / 2, ext + m['tick'], zones[zi][1] + 30)
    return pd.Series(out).sort_index()

def report(x, lo, hi):
    x = x[(x.index.year >= lo) & (x.index.year <= hi)]
    if x.empty: return 'no trades'
    eq, floor, blown = 0.0, -4500.0, 0
    for p in x.values:
        eq += p
        if eq <= floor: blown += 1; eq, floor = 0.0, -4500.0; continue
        if eq > 0: floor = max(floor, min(0.0, eq - 4500.0))
    allw = pd.period_range(f'{lo}-01-01', f'{hi}-12-31', freq='W')
    wk = x.groupby(x.index.to_period('W')).sum().reindex(allw[(allw.start_time >= x.index.min()) & (allw.start_time <= x.index.max())], fill_value=0.0)
    e = x.cumsum()
    return (f"{len(x)} trade days, win days {100 * (x > 0).mean():.0f}%, avg week ${wk.mean():,.0f}, weeks >= $1k {int((wk >= 1000).sum())}/{len(wk)}, "
            f"best day ${x.max():,.0f}, worst ${x.min():,.0f}, max drawdown ${float((e.cummax() - e).max()):,.0f}, blown {blown}, total ${x.sum():,.0f}")

STEPS = [('base (Silver Bullet hour, no filters)', dict(htf=False, vol=False, kz=False, be=False)),
         ('+ 1h/4h EMA200 alignment', dict(htf=True, vol=False, kz=False, be=False)),
         ('+ ADX > 20 and ATR above median', dict(htf=True, vol=True, kz=False, be=False)),
         ('+ London + NY AM killzones', dict(htf=True, vol=True, kz=True, be=False)),
         ('+ breakeven at 1R (all four filters)', dict(htf=True, vol=True, kz=True, be=True))]
for name, m in MK.items():
    b = load(m['f'])
    y0, y1 = b.index.year.min(), b.index.year.max()
    print(f'\n{name} ({y0}-{y1})', flush=True)
    for label, P in STEPS:
        x = run(b, m, **P)
        print(f'  {label}\n     all years: {report(x, y0, y1)}\n     2022-2026: {report(x, 2022, 2026)}', flush=True)
