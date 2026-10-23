# usage: python3 scripts/strategy-lab.py <XAUUSD M5 MT5 export> <NQ M5 MT5 export> <out.json>
# Public intraday strategy lab for Lucid futures accounts (flat by 4:45 PM ET, so intraday only).
# 20 well-known public strategies, a few standard settings each, on gold (MGC, $10 per $1) and Nasdaq (MNQ, $2 per pt).
# Honest rules: entries on the NEXT bar's open, stop first when stop and target hit in the same bar, everything closed
# by 16:40 ET, costs = slippage (gold $0.20, NQ 0.50 pt) + $1.50 commission per micro round trip.
# Settings are chosen on the early years (gold 2004-2018, NQ 2012-2019) and reported on the later years it never saw.
# Then each finalist runs on LucidFlex 25K / 50K / 100K / 150K rules: EOD trailing max loss, DLL = 60% of max loss,
# micro limits, and the size needed for $1,000 a day.
import sys, json, itertools
import numpy as np, pandas as pd

GOLD, NQ, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
MK = {'XAUUSD': dict(file=GOLD, pv=10.0, slip=0.20, open_h=8, open_m=20, split=2019),
      'NQ': dict(file=NQ, pv=2.0, slip=0.50, open_h=9, open_m=30, split=2020)}
COMM = 1.50
ACCTS = {'25K': dict(mll=1000, micros=20), '50K': dict(mll=2000, micros=40), '100K': dict(mll=3000, micros=60), '150K': dict(mll=4500, micros=100)}

def load(f):
    df = pd.read_csv(f, sep='\t')
    t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') - pd.Timedelta(hours=7)  # broker -> ET
    b = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
    b = b[b.index.weekday < 5]
    return b

def prep(b, m):
    x = b.copy()
    mins = x.index.hour * 60 + x.index.minute
    x['mins'] = mins
    # trading day = ET calendar day, session used = 00:00-16:40 ET
    x['day'] = x.index.normalize()
    x = x[mins <= 16 * 60 + 40]
    c = x.c
    pc = c.shift(1)
    tr = np.maximum(x.h - x.l, np.maximum((x.h - pc).abs(), (x.l - pc).abs()))
    x['atr'] = tr.rolling(14).mean()
    for n in (9, 21, 50, 200): x[f'e{n}'] = c.ewm(span=n).mean()
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1 / 2).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1 / 2).mean()
    x['rsi2'] = 100 - 100 / (1 + up / dn)
    mid = c.rolling(20).mean(); sd = c.rolling(20).std()
    x['bbu'], x['bbl'], x['bbm'], x['bbw'] = mid + 2 * sd, mid - 2 * sd, mid, (4 * sd / mid)
    m12, m26 = c.ewm(span=12).mean(), c.ewm(span=26).mean(); x['macd'] = m12 - m26; x['sig'] = x.macd.ewm(span=9).mean()
    x['hh20'], x['ll20'] = x.h.rolling(20).max().shift(1), x.l.rolling(20).min().shift(1)
    # session VWAP (from the regular open) with a typical-price proxy, volume-free (equal weights)
    tp = (x.h + x.l + x.c) / 3
    g = (x.day.astype('int64') // 10**9).values
    key = pd.Series(np.where(x.mins.values >= m['open_h'] * 60 + m['open_m'], g, -1), index=x.index)
    cs = tp.where(key >= 0).groupby(key).cumsum(); cn = tp.where(key >= 0).groupby(key).cumcount() + 1
    x['vwap'] = np.where(key >= 0, cs / cn, np.nan)
    dev = (tp - x.vwap) ** 2
    x['vsd'] = np.where(key >= 0, np.sqrt(dev.where(key >= 0).groupby(key).cumsum() / cn), np.nan)
    # supertrend(10, 3)
    a10 = tr.rolling(10).mean(); hl2 = (x.h + x.l) / 2
    ub, lb = (hl2 + 3 * a10).to_numpy(copy=True), (hl2 - 3 * a10).to_numpy(copy=True); cc = c.to_numpy(); st = np.zeros(len(x)); dirn = np.ones(len(x))
    for i in range(1, len(x)):
        if np.isnan(ub[i]): continue
        lb[i] = max(lb[i], lb[i - 1]) if cc[i - 1] > lb[i - 1] else lb[i]
        ub[i] = min(ub[i], ub[i - 1]) if cc[i - 1] < ub[i - 1] else ub[i]
        dirn[i] = 1 if cc[i] > ub[i - 1] else -1 if cc[i] < lb[i - 1] else dirn[i - 1]
    x['stdir'] = dirn
    # daily context
    dd = x.groupby('day').agg(dh=('h', 'max'), dl=('l', 'min'), dc=('c', 'last'))
    dd['pdh'], dd['pdl'], dd['pdc'] = dd.dh.shift(1), dd.dl.shift(1), dd.dc.shift(1)
    tr_d = np.maximum(dd.dh - dd.dl, np.maximum((dd.dh - dd.dc.shift(1)).abs(), (dd.dl - dd.dc.shift(1)).abs()))
    dd['datr'] = tr_d.rolling(14).mean().shift(1)
    x = x.join(dd[['pdh', 'pdl', 'pdc', 'datr']], on='day')
    # overnight / Asia range before the regular open, and the opening range
    pre = x[x.mins < m['open_h'] * 60 + m['open_m']].groupby('day').agg(onh=('h', 'max'), onl=('l', 'min'))
    x = x.join(pre, on='day')
    op = x[x.mins == m['open_h'] * 60 + m['open_m']].groupby('day').o.first().rename('dopen')
    x = x.join(op, on='day')
    for n in (5, 15, 30):
        w = x[(x.mins >= m['open_h'] * 60 + m['open_m']) & (x.mins < m['open_h'] * 60 + m['open_m'] + n)].groupby('day').agg(**{f'orh{n}': ('h', 'max'), f'orl{n}': ('l', 'min')})
        x = x.join(w, on='day')
    # last bar index of each day (the forced exit)
    x = x.dropna(subset=['atr', 'e200', 'datr']).copy()
    pos = np.arange(len(x)); x['last'] = pd.Series(pos, index=x.index).groupby(x.day.values).transform('max').values
    x['year'] = x.index.year
    return x

def signals(x, m, s, p):
    """-> side array (+1 long, -1 short, 0), stop distance array, target distance array (np.inf = hold to the close)"""
    n = len(x); side = np.zeros(n); mins = x.mins.values; c, o, h, l = x.c.values, x.o.values, x.h.values, x.l.values
    atr, op = x.atr.values, m['open_h'] * 60 + m['open_m']
    rth = (mins >= op) & (mins < 15 * 60 + 30)
    stop = p.get('k', 1.5) * atr; tgt = np.full(n, np.inf) if p.get('R') is None else p['R'] * stop
    if s == 'orb':
        N = p['n']; hi, lo = x[f'orh{N}'].values, x[f'orl{N}'].values; t = (mins >= op + N) & (mins < op + 180)
        side[t & (c > hi) & (np.roll(c, 1) <= hi)] = 1; side[t & (c < lo) & (np.roll(c, 1) >= lo)] = -1
        stop = np.maximum((hi - lo) * p['frac'], 0.5 * atr); tgt = np.full(n, np.inf) if p.get('R') is None else p['R'] * stop
    elif s == 'intraday_momentum':
        # Gao et al. (2018): the first half hour's move (from the prior close) predicts the last half hour
        first = x.groupby('day').apply(lambda g: g.c[g.mins <= op + 30].iloc[-1] if (g.mins <= op + 30).any() else np.nan)
        r1 = (x.day.map(first) - x.pdc).values
        t = mins == 15 * 60 + 25
        side[t & (r1 > 0)] = 1; side[t & (r1 < 0)] = -1
    elif s == 'gap_fade':
        gap = (x.dopen - x.pdc).values; t = mins == op; small = np.abs(gap) < p['g'] * x.datr.values
        side[t & small & (gap > 0)] = -1; side[t & small & (gap < 0)] = 1
        stop = np.maximum(np.abs(gap), 0.5 * atr); tgt = np.abs(gap)
    elif s == 'vwap_revert':
        v, sd = x.vwap.values, x.vsd.values; t = rth & (mins >= op + 30)
        side[t & (c > v + p['z'] * sd)] = -1; side[t & (c < v - p['z'] * sd)] = 1
        tgt = np.abs(c - v)
    elif s == 'vwap_trend':
        v = x.vwap.values; pv = np.roll(v, 1); pc = np.roll(c, 1); t = rth & (mins >= op + 30)
        side[t & (c > v) & (pc <= pv) & (c > x.dopen.values)] = 1; side[t & (c < v) & (pc >= pv) & (c < x.dopen.values)] = -1
    elif s == 'rsi2':
        r = x.rsi2.values; e = x.e200.values
        side[rth & (r < p['th']) & (c > e)] = 1; side[rth & (r > 100 - p['th']) & (c < e)] = -1
    elif s == 'bb_fade':
        side[rth & (c < x.bbl.values)] = 1; side[rth & (c > x.bbu.values)] = -1
        tgt = np.abs(c - x.bbm.values)
    elif s == 'bb_squeeze':
        w = x.bbw.values; sq = w < pd.Series(w).rolling(120).quantile(0.2).values
        side[rth & np.roll(sq, 1) & (c > x.bbu.values)] = 1; side[rth & np.roll(sq, 1) & (c < x.bbl.values)] = -1
    elif s == 'ema_cross':
        f, sl = x.e9.values, x.e21.values; pf, ps = np.roll(f, 1), np.roll(sl, 1)
        side[rth & (f > sl) & (pf <= ps)] = 1; side[rth & (f < sl) & (pf >= ps)] = -1
    elif s == 'macd_cross':
        a, b_ = x.macd.values, x.sig.values; pa, pb = np.roll(a, 1), np.roll(b_, 1)
        side[rth & (a > b_) & (pa <= pb) & (a < 0)] = 1; side[rth & (a < b_) & (pa >= pb) & (a > 0)] = -1
    elif s == 'supertrend':
        d = x.stdir.values; pd_ = np.roll(d, 1)
        side[rth & (d == 1) & (pd_ == -1)] = 1; side[rth & (d == -1) & (pd_ == 1)] = -1
    elif s == 'donchian':
        side[rth & (c > x.hh20.values)] = 1; side[rth & (c < x.ll20.values)] = -1
    elif s == 'pdhl_break':
        pc = np.roll(c, 1); side[rth & (c > x.pdh.values) & (pc <= x.pdh.values)] = 1; side[rth & (c < x.pdl.values) & (pc >= x.pdl.values)] = -1
    elif s == 'pdhl_fade':
        # "turtle soup": a poke through yesterday's high/low that closes back inside
        side[rth & (h > x.pdh.values) & (c < x.pdh.values)] = -1; side[rth & (l < x.pdl.values) & (c > x.pdl.values)] = 1
    elif s == 'inside_bar':
        ph, pl = np.roll(h, 1), np.roll(l, 1); ins = (ph < np.roll(h, 2)) & (pl > np.roll(l, 2))
        side[rth & ins & (c > ph)] = 1; side[rth & ins & (c < pl)] = -1
    elif s == 'overnight_break':
        t = (mins >= op) & (mins < op + 120); pc = np.roll(c, 1)
        side[t & (c > x.onh.values) & (pc <= x.onh.values)] = 1; side[t & (c < x.onl.values) & (pc >= x.onl.values)] = -1
    elif s == 'silver_bullet':
        # ICT silver bullet, simplified: a 3-bar fair value gap that forms 10:00-11:00 ET, traded in its direction
        t = (mins >= 10 * 60) & (mins < 11 * 60)
        side[t & (l > np.roll(h, 2)) & (c > o)] = 1; side[t & (h < np.roll(l, 2)) & (c < o)] = -1
    elif s == 'opening_drive':
        t = mins == op; side[t & (c > o)] = 1; side[t & (c < o)] = -1
    elif s == 'buy_open':
        side[mins == op] = 1   # benchmark: long the open, out at the close
    elif s == 'exhaustion':
        r1, r2, r3 = c < o, np.roll(c < o, 1), np.roll(c < o, 2); g1, g2, g3 = c > o, np.roll(c > o, 1), np.roll(c > o, 2)
        side[rth & r1 & r2 & r3] = 1; side[rth & g1 & g2 & g3] = -1
    if not p.get('short', True): side[side < 0] = 0
    return side, stop, np.broadcast_to(tgt, (n,)).copy() if np.ndim(tgt) == 0 else tgt

def simulate(x, m, side, stop, tgt, max_per_day=3):
    """-> list of (day, points per contract after slippage)"""
    o, h, l, c, last, days = x.o.values, x.h.values, x.l.values, x.c.values, x.last.values, x.day.values
    n = len(c); out = []; idx = np.flatnonzero(side); k = 0; per_day = {}
    while k < len(idx):
        i = idx[k]
        if i + 1 >= n or last[i] <= i: k += 1; continue
        d = days[i]
        if per_day.get(d, 0) >= max_per_day: k = np.searchsorted(idx, last[i] + 1); continue
        s = side[i]; e = o[i + 1]; sd = stop[i]
        if not (sd > 0): k += 1; continue
        sp = e - s * sd; tp = e + s * tgt[i] if np.isfinite(tgt[i]) else None
        end = last[i] + 1
        hh, ll = h[i + 1:end], l[i + 1:end]
        hs = np.flatnonzero(ll <= sp) if s > 0 else np.flatnonzero(hh >= sp)
        ht = (np.flatnonzero(hh >= tp) if s > 0 else np.flatnonzero(ll <= tp)) if tp is not None else np.array([], int)
        js = hs[0] if len(hs) else 10**9; jt = ht[0] if len(ht) else 10**9
        if js <= jt and js < 10**9: pts, j = -sd, js
        elif jt < 10**9: pts, j = tgt[i], jt
        else: j = end - i - 2; pts = (c[end - 1] - e) * s
        out.append((d, pts - m['slip'], sd))
        per_day[d] = per_day.get(d, 0) + 1
        k = np.searchsorted(idx, i + 1 + j + 1)
    return out

def per_contract_days(trades, m):
    s = {}
    for d, pts, _ in trades: s[d] = s.get(d, 0.0) + pts * m['pv'] - COMM
    return pd.Series(s).sort_index()

def stats(daily, lo, hi):
    x = daily[(daily.index.year >= lo) & (daily.index.year <= hi)]
    if len(x) < 30: return {'days': int(len(x))}
    eq = x.cumsum(); dd = float((eq.cummax() - eq).max())
    w = x.groupby(x.index.to_period('W')).sum()
    return {'days': int(len(x)), 'per_day': round(float(x.mean()), 2), 'win_days': round(float((x > 0).mean() * 100), 1),
            'pf': round(float(x[x > 0].sum() / max(1e-9, -x[x < 0].sum())), 2), 'total': round(float(x.sum()), 0),
            'dd': round(dd, 0), 'per_week': round(float(w.mean()), 2)}

GRID = {
    'orb': [dict(n=n, frac=f, R=R) for n in (5, 15, 30) for f in (0.5, 1.0) for R in (1.0, 2.0, None)],
    'intraday_momentum': [dict(k=k) for k in (1.0, 2.0)],
    'gap_fade': [dict(g=g) for g in (0.3, 0.6)],
    'vwap_revert': [dict(z=z, k=k) for z in (1.5, 2.5) for k in (1.0, 2.0)],
    'vwap_trend': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'rsi2': [dict(th=th, k=k, R=R) for th in (5, 15) for k in (1.0, 2.0) for R in (1.0, 2.0)],
    'bb_fade': [dict(k=k) for k in (1.0, 2.0)],
    'bb_squeeze': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'ema_cross': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'macd_cross': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'supertrend': [dict(k=k, R=R) for k in (1.5, 3.0) for R in (2.0, None)],
    'donchian': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'pdhl_break': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'pdhl_fade': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (1.0, 2.0)],
    'inside_bar': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (1.0, 2.0)],
    'overnight_break': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'silver_bullet': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, 3.0)],
    'opening_drive': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (2.0, None)],
    'buy_open': [dict(k=k) for k in (2.0, 4.0)],
    'exhaustion': [dict(k=k, R=R) for k in (1.0, 2.0) for R in (1.0, 2.0)],
}

def account_run(daily_pc, risk_contracts, acct, lo, hi):
    """Plays daily P&L per micro x contracts on a LucidFlex account; resets the account when the max loss is hit."""
    x = daily_pc[(daily_pc.index.year >= lo) & (daily_pc.index.year <= hi)] * risk_contracts
    dll = 0.6 * acct['mll']
    x = x.clip(lower=-dll)   # the DLL stops the day (approximation: the day's loss can't pass it)
    eq = 0.0; floor = -acct['mll']; blown = 0; days_alive = []; alive = 0
    for v in x.values:
        eq += v; alive += 1
        if eq <= floor: blown += 1; days_alive.append(alive); eq = 0.0; floor = -acct['mll']; alive = 0; continue
        floor = max(floor, min(0.0, eq - acct['mll'])) if eq > 0 else floor
    w = x.groupby(x.index.to_period('W')).sum()
    eqc = x.cumsum(); dd = float((eqc.cummax() - eqc).max())
    return {'contracts': int(risk_contracts), 'per_day': round(float(x.mean()), 0), 'per_week': round(float(w.mean()), 0),
            'best_day': round(float(x.max()), 0), 'worst_day': round(float(x.min()), 0), 'max_dd': round(dd, 0),
            'days_1k_plus': int((x >= 1000).sum()), 'accounts_blown': blown,
            'median_days_before_blown': float(np.median(days_alive)) if days_alive else None, 'trading_days': int(len(x))}

results = {'strategies': [], 'accounts': {}}
for mkt, m in MK.items():
    x = prep(load(m['file']), m)
    y0, y1 = int(x.year.min()), int(x.year.max())
    print(mkt, len(x), y0, y1, flush=True)
    for s, grid in GRID.items():
        for p in grid:
            side, stop, tgt = signals(x, m, s, p)
            tr = simulate(x, m, side, stop, tgt)
            daily = per_contract_days(tr, m)
            row = {'market': mkt, 'strategy': s, 'params': {k: v for k, v in p.items()}, 'pick': stats(daily, y0, m['split'] - 1), 'unseen': stats(daily, m['split'], y1)}
            row['_daily'] = daily
            results['strategies'].append(row)
        print(' ', s, 'done', flush=True)
    results.setdefault('meta', {})[mkt] = {'years': [y0, y1], 'split': m['split']}

# Best setting per strategy and market, chosen on the early years only
best = {}
for r in results['strategies']:
    key = (r['market'], r['strategy'])
    if r['pick'].get('days', 0) < 60: continue
    if key not in best or r['pick']['per_day'] > best[key]['pick']['per_day']: best[key] = r
final = sorted(best.values(), key=lambda r: -r['pick']['per_day'])
print('\nBEST SETTING PER STRATEGY (chosen on early years), $ per day per micro: early | unseen')
for r in final:
    print(f"{r['market']:7s} {r['strategy']:18s} {str(r['params']):42s} early {r['pick'].get('per_day')} pf {r['pick'].get('pf')} | unseen {r['unseen'].get('per_day')} pf {r['unseen'].get('pf')}")

# Survivors: positive on both the early and the unseen years
surv = [r for r in final if r['pick'].get('per_day', -1) > 0 and r['unseen'].get('per_day', -1) > 0]
print(f'\n{len(surv)} of {len(final)} strategies made money on both early and unseen years')
for r in (surv or final[:3])[:6]:
    mkt = r['market']; lo = MK[mkt]['split']; hi = results['meta'][mkt]['years'][1]
    per = r['unseen']['per_day']
    for an, a in ACCTS.items():
        need = int(np.ceil(1000 / per)) if per > 0 else None
        runs = {'max_allowed': account_run(r['_daily'], a['micros'], a, lo, hi)}
        if need: runs['size_for_1k_day'] = account_run(r['_daily'], need, a, lo, hi); runs['size_for_1k_day']['allowed'] = need <= a['micros']
        safe = max(1, int(0.5 * a['mll'] / max(1.0, r['unseen']['dd'])))  # the worst unseen drawdown uses half the max loss
        runs['safe'] = account_run(r['_daily'], min(safe, a['micros']), a, lo, hi)
        results['accounts'].setdefault(f"{mkt} {r['strategy']}", {})[an] = runs
        print(mkt, r['strategy'], an, json.dumps(runs))
for r in results['strategies']: r.pop('_daily', None)
json.dump(results, open(OUT, 'w'), indent=1, default=str)
