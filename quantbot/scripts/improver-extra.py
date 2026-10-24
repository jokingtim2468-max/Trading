# usage: python3 scripts/improver-extra.py <XAUUSD M5 export> <NQ M5 export>
# Extra candidate setups for scripts/bot-improver.py: the NQ opening drive with filters, adding to winners and a
# trailing stop (scripts/opening-drive-lab.py), one trade a day, in R of the first unit's stop, with the same features
# (hour, weekday, volatility regime, trend agreement, gap direction). Written next to the data as improver-extra.pkl;
# the improver adds them to its pool on its next start.
import sys, os, itertools, pickle, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[:]
lab = open(os.path.join(ROOT, 'scripts', 'opening-drive-lab.py')).read()
lab = lab[:lab.index('GRID = dict(')]
sys.argv = ['x', ARGS[2], '150K']
od = {}; exec(lab, od)
src = open(os.path.join(ROOT, 'scripts', 'strategy-lab.py')).read()
src = src[:src.index("results = {'strategies'")]
sys.argv = ['x', ARGS[1], ARGS[2], '/dev/null']
g = {}; exec(src, g)
m = g['MK']['NQ']; x = g['prep'](g['load'](m['file']), m)
at930 = x[x.mins == 570]
feat = pd.DataFrame(dict(vol=(x.atr / x.atr.rolling(2000, min_periods=200).median()).reindex(at930.index).values,
                         tdir=np.sign(at930.c - at930.e200).values, gap=np.sign((at930.dopen - at930.pdc).values),
                         side=np.sign(at930.c - at930.o).values), index=at930.day.values)
feat = feat[~feat.index.duplicated()]
out = []
for body, gap, on, stop, adds, trail in itertools.product([0.0, 0.5], ['any', 'with'], ['any', 'break'], [1.0, 2.0], [1, 2, 3], [0.0, 4.0]):
    P = dict(body=body, gap=gap, on=on, stop=stop, be=False, adds=adds, raise_=True, trail=trail); P['raise'] = P.pop('raise_')
    rows = []
    for k in range(len(od['days'])):
        r = od['day_trade'](k, P)
        if r is None: continue
        pts, units = r
        d, o_, h_, l_, c_, atr = od['days'][k]
        R0 = P['stop'] * atr
        if not (R0 > 0) or d not in feat.index: continue
        f = feat.loc[d]
        rr = (pts - g['COMM'] * units / m['pv']) / R0
        rows.append((pd.Timestamp(d), d.year, 9, d.weekday(), f.vol, f.side == f.tdir, f.side == f.gap, rr))
    if len(rows) < 100: continue
    df = pd.DataFrame(rows, columns=['day', 'y', 'hour', 'wd', 'vol', 'withtrend', 'withgap', 'r'])
    out.append(dict(name=f'NQ opening_drive_plus {P}', mkt='NQ', s='opening_drive_plus', p=P, t=df))
print(len(out), 'extra setups')
# written by this script itself, read only by scripts/bot-improver.py (safe to unpickle)
pickle.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(ARGS[1])), 'improver-extra.pkl'), 'wb'))
