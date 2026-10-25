# Standalone gold daily-trend ML signals (not part of QuantBot). Needs: python3, pandas, numpy, scikit-learn, internet.
# usage: python3 gold_daily_ml.py <XAUUSD M5 or D1 MT5 export .csv> [out.pine] [--both]  (default: buy signals only)
# Base signal (the one gold edge that held up for 22 years): EMA 13 crosses EMA 55 on daily closes, enter on that close,
# trailing stop 1.5 x ATR(20) behind the best close, exit after 60 days at most. Longs and shorts are both candidates.
# Free extra data, downloaded from FRED (the same series TradingView shows as FRED:...):
#   DTWEXBGS broad US dollar index, DGS10 10-year yield, DFII10 10-year real yield, VIXCLS VIX
# Model: logistic regression rating each signal (did it make money?). Walk-forward: each year 2012-2025 predicted by a
# model trained only on earlier years; 2026 graded once. The final model is written into a Pine v6 indicator for the
# XAUUSD daily chart, using the same FRED series through request.security.
import sys, io, urllib.request, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression

BOTH = '--both' in sys.argv; ARGV = [v for v in sys.argv if v != '--both']
F = ARGV[1]; OUT = ARGV[2] if len(ARGV) > 2 else 'qb-gold-daily-ml.pine'
COST = 0.40   # $ per oz round trip (spread + slippage + commission), on a daily stop of ~$30-100 it is small

def fred(sid):
    raw = urllib.request.urlopen(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}', timeout=60).read().decode()
    s = pd.read_csv(io.StringIO(raw)); s.columns = ['d', sid]
    s['d'] = pd.to_datetime(s.d); s[sid] = pd.to_numeric(s[sid], errors='coerce')
    return s.set_index('d')[sid]

df = pd.read_csv(F, sep='\t')
t = pd.to_datetime(df['<DATE>'] + ' ' + df['<TIME>'], format='%Y.%m.%d %H:%M:%S') if '<TIME>' in df else pd.to_datetime(df['<DATE>'], format='%Y.%m.%d')
x = pd.DataFrame({'o': df['<OPEN>'].values, 'h': df['<HIGH>'].values, 'l': df['<LOW>'].values, 'c': df['<CLOSE>'].values}, index=t)
D = x.resample('1D').agg({'o': 'first', 'h': 'max', 'l': 'min', 'c': 'last'}).dropna()
D = D[D.index.weekday < 5].copy()
pc = D.c.shift(1)
D['atr'] = np.maximum(D.h - D.l, np.maximum((D.h - pc).abs(), (D.l - pc).abs())).rolling(20).mean()
D['atr100'] = D.atr.rolling(100).mean()
D['f'], D['s'], D['e200'] = D.c.ewm(span=13, adjust=False).mean(), D.c.ewm(span=55, adjust=False).mean(), D.c.ewm(span=200, adjust=False).mean()
d = D.c.diff(); up = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
D['rsi'] = 100 - 100 / (1 + up / dn)
print('downloading FRED: dollar, 10y yield, real yield, VIX ...', flush=True)
for sid in ('DTWEXBGS', 'DGS10', 'DFII10', 'VIXCLS'):
    D[sid] = fred(sid).reindex(D.index, method='ffill').shift(1)   # known by the next day (publication lag)

FEATS = ['dxy20', 'y10_20', 'ry20', 'vix', 'vix5', 'ret20', 'ret60', 'e200_atr', 'atr_ratio', 'rsi_c']
cross = np.sign(D.f - D.s)
rows = []
c, h, l, a = D.c.values, D.h.values, D.l.values, D.atr.values
for i in range(220, len(D) - 1):
    s = cross.iloc[i]
    if s == 0 or s == cross.iloc[i - 1] or not (a[i] > 0): continue
    if s < 0 and not BOTH: continue   # shorts lost money (-20.8R over 2006-2026): long only unless --both
    r = D.iloc[i]
    f = dict(dxy20=s * (r.DTWEXBGS / D.DTWEXBGS.iloc[i - 20] - 1) * 100, y10_20=s * (r.DGS10 - D.DGS10.iloc[i - 20]),
             ry20=s * (r.DFII10 - D.DFII10.iloc[i - 20]), vix=r.VIXCLS / 20, vix5=(r.VIXCLS - D.VIXCLS.iloc[i - 5]) / 5,
             ret20=s * (c[i] / c[i - 20] - 1) * 10, ret60=s * (c[i] / c[i - 60] - 1) * 10,
             e200_atr=s * (c[i] - r.e200) / a[i] / 10, atr_ratio=a[i] / r.atr100, rsi_c=s * (r.rsi - 50) / 50)
    if any(pd.isna(v) for v in f.values()): continue
    e = c[i]; R1 = 1.5 * a[i]; stop = e - s * R1; best = e; res = None
    for j in range(i + 1, min(len(D), i + 61)):
        if (s > 0 and l[j] <= stop) or (s < 0 and h[j] >= stop): res = (stop - e) * s; break
        best = max(best, c[j]) if s > 0 else min(best, c[j])
        stop = max(stop, best - R1) if s > 0 else min(stop, best + R1)
    if res is None: res = (c[min(len(D) - 1, i + 60)] - e) * s
    R = (res - COST) / R1
    rows.append(dict(day=D.index[i], y=D.index[i].year, side=int(s), R=R, win=int(R > 0), **f))
T = pd.DataFrame(rows)
print(f'{len(T)} daily trend signals {T.y.min()}-{T.y.max()} ({(T.side > 0).sum()} long, {(T.side < 0).sum()} short), '
      f'plain {T.R.sum():+.1f}R, longs {T[T.side > 0].R.sum():+.1f}R, shorts {T[T.side < 0].R.sum():+.1f}R')

def fit(tr):
    mu, sd = tr[FEATS].mean(), tr[FEATS].std().replace(0, 1)
    m = LogisticRegression(C=0.5, max_iter=2000).fit((tr[FEATS] - mu) / sd, tr.win)
    return m, mu, sd
def prob(M, X): m, mu, sd = M; return m.predict_proba((X[FEATS] - mu) / sd)[:, 1]

print('\nWALK-FORWARD (each year rated by a model trained only on earlier years)')
tot_p = tot_m = 0.0; ths = []
for Y in range(2012, 2027):
    tr, te = T[T.y < Y], T[T.y == Y]
    if len(te) == 0 or len(tr) < 25: continue
    M = fit(tr); ptr = prob(M, tr)
    th = max(np.arange(0.2, 0.75, 0.01), key=lambda q: tr.R[ptr >= q].sum() if (ptr >= q).sum() >= 10 else -1e9)
    take = te[prob(M, te) >= th]; ths.append(th)
    if Y <= 2025: tot_p += te.R.sum(); tot_m += take.R.sum()
    print(f"{Y}: plain {len(te):2d} signals {te.R.sum():+6.1f}R | ML takes {len(take):2d} (p>={th:.2f}) {take.R.sum():+6.1f}R"
          + ('   <- EXAM, graded once' if Y == 2026 else ''))
print(f'2012-2025 total: plain {tot_p:+.1f}R, ML {tot_m:+.1f}R')

M = fit(T[T.y <= 2025]); m, mu, sd = M; th = float(ths[-1])
coef = m.coef_[0] / sd.values; icpt = m.intercept_[0] - float((m.coef_[0] * mu.values / sd.values).sum())
terms = ' + '.join(f'({v:.6f}) * {k}' for v, k in zip(coef, FEATS))
pine = f'''// QB Gold Daily ML (generated by gold_daily_ml.py, trained 2004-2025). Signals only. Use on XAUUSD, 1D chart.
// Signal: EMA 13 crosses EMA 55 at the daily close. Stop/trail 1.5 x ATR(20) behind the best close, out after 60 days.
// Probability from a logistic model using gold trend, volatility, the US dollar, 10y yield, real yield and VIX (FRED).
//@version=6
indicator("QB Gold Daily ML", overlay=true, max_labels_count=500, max_lines_count=500)
float riskUsd = input.float(200, "Risk per trade ($)")
float th = input.float(0.0, "Highlight signals with probability >= (0 = all; ML filtering lost R in the walk-forward, model threshold {th:.2f})")
float atr = ta.atr(20)
float atr100 = ta.sma(atr, 100)
float f = ta.ema(close, 13)
float sl55 = ta.ema(close, 55)
float e200 = ta.ema(close, 200)
float rsi = ta.rsi(close, 14)
float dxy = request.security("FRED:DTWEXBGS", "D", close[1])
float y10 = request.security("FRED:DGS10", "D", close[1])
float ry = request.security("FRED:DFII10", "D", close[1])
float vixv = request.security("FRED:VIXCLS", "D", close[1])
int s = ta.crossover(f, sl55) ? 1 : ta.crossunder(f, sl55) and {"true" if BOTH else "false"} ? -1 : 0
var float trail = na
var int dir = 0
var int age = 0
var float best = na
if s != 0 and barstate.isconfirmed
    float dxy20 = s * (dxy / dxy[20] - 1) * 100
    float y10_20 = s * (y10 - y10[20])
    float ry20 = s * (ry - ry[20])
    float vix = vixv / 20
    float vix5 = (vixv - vixv[5]) / 5
    float ret20 = s * (close / close[20] - 1) * 10
    float ret60 = s * (close / close[60] - 1) * 10
    float e200_atr = s * (close - e200) / atr / 10
    float atr_ratio = atr / atr100
    float rsi_c = s * (rsi - 50) / 50
    float z = {icpt:.6f} + {terms}
    float p = 1 / (1 + math.exp(-z))
    bool take = p >= th
    float stp = close - s * 1.5 * atr
    float oz = riskUsd / (1.5 * atr)
    label.new(bar_index, s > 0 ? low - atr * 0.5 : high + atr * 0.5, (s > 0 ? "BUY " : "SELL ") + str.tostring(math.round(p * 100)) + "%\\nSL " + str.tostring(stp, format.mintick) + " then trail 1.5 ATR\\n" + str.tostring(oz / 100, "#.##") + " lots (100 oz) / " + str.tostring(oz / 10, "#") + " MGC", style=s > 0 ? label.style_label_up : label.style_label_down, color=color.new(s > 0 ? #22c55e : #ef4444, take ? 5 : 70), textcolor=color.white, size=size.normal)
    if take
        alert((s > 0 ? "GOLD BUY " : "GOLD SELL ") + str.tostring(math.round(p * 100)) + "% SL " + str.tostring(stp, format.mintick), alert.freq_once_per_bar_close)
    dir := s, best := close, trail := stp, age := 0
else if dir != 0
    age += 1
    best := dir > 0 ? math.max(best, close) : math.min(best, close)
    trail := dir > 0 ? math.max(trail, best - 1.5 * atr) : math.min(trail, best + 1.5 * atr)
    if (dir > 0 and low <= trail) or (dir < 0 and high >= trail) or age >= 60
        label.new(bar_index, close, "EXIT", style=label.style_label_center, color=color.new(color.gray, 20), textcolor=color.white, size=size.small)
        dir := 0
plot(dir != 0 ? trail : na, "Trailing stop", color=color.orange, style=plot.style_linebr, linewidth=2)
plot(f, "EMA 13", color=color.new(#60a5fa, 30))
plot(sl55, "EMA 55", color=color.new(#a3a3a3, 30))
'''
open(OUT, 'w').write(pine)
print(f'\nWrote {OUT} (threshold {th:.2f}). TradingView: Pine Editor > paste > Add to chart on XAUUSD, 1D.')
