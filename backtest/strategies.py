"""Common intraday strategies. Every signal uses only data up to the signal bar's close.
sig: +1 long / -1 short at bar close (entry next open). exit_sig: +1 closes longs, -1 closes shorts."""
import numpy as np, pandas as pd
from engine import ema, rma


def rsi(c, n):
    d = np.diff(c, prepend=c[0])
    up = rma(np.maximum(d, 0), n); dn = rma(np.maximum(-d, 0), n)
    return 100 - 100 / (1 + up / np.where(dn == 0, 1e-12, dn))


def cross_up(a, b):
    r = np.zeros(len(a), bool); r[1:] = (a[1:] > b[1:]) & (a[:-1] <= b[:-1]); return r


def first_per_day(mask, tday):
    out = np.zeros(len(mask), bool); seen = set()
    for i in np.flatnonzero(mask):
        if tday[i] not in seen:
            seen.add(tday[i]); out[i] = True
    return out


class Feats:
    def __init__(self, mk):
        self.mk = mk
        o, h, l, c = mk.o, mk.h, mk.l, mk.c
        s = pd.Series(c)
        self.e = {k: ema(c, k) for k in (5, 9, 20, 21, 50, 200)}
        self.rsi2 = rsi(c, 2); self.rsi14 = rsi(c, 14)
        self.sma20 = s.rolling(20).mean().to_numpy(); self.sd20 = s.rolling(20).std().to_numpy()
        # ADX(14)
        up = np.r_[0, h[1:] - h[:-1]]; dn = np.r_[0, l[:-1] - l[1:]]
        pdm = np.where((up > dn) & (up > 0), up, 0.0); ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
        tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1)))); tr[0] = h[0] - l[0]
        atr14 = rma(tr, 14); pdi = 100 * rma(pdm, 14) / atr14; ndi = 100 * rma(ndm, 14) / atr14
        dx = 100 * abs(pdi - ndi) / np.where(pdi + ndi == 0, 1, pdi + ndi)
        self.adx = rma(np.nan_to_num(dx), 14)
        # session VWAP from 18:00 NY (file volume is constant, so this is the session average price)
        tp = (h + l + c) / 3
        g = pd.Series(tp).groupby(mk.tday)
        self.vwap = (g.cumsum() / g.cumcount().add(1)).to_numpy()
        # previous trading-day high/low
        dfd = pd.DataFrame({"td": mk.tday, "h": h, "l": l})
        dd = dfd.groupby("td").agg(h=("h", "max"), l=("l", "min")).shift(1)
        self.pdh = dd.h.reindex(mk.tday).to_numpy(); self.pdl = dd.l.reindex(mk.tday).to_numpy()
        # 1H bias from completed hours only (EMA50 vs EMA200 on 1H closes)
        t = mk.df["t"]
        hk = t.dt.floor("60min")
        hc = pd.Series(c).groupby(hk.to_numpy()).last()
        he50 = hc.ewm(span=50, adjust=False).mean(); he200 = hc.ewm(span=200, adjust=False).mean()
        hb = pd.Series(np.where(he50 > he200, 1, -1), index=hc.index + pd.Timedelta(hours=1))  # known at hour end
        close_t = t + pd.Timedelta(minutes=5)
        idx = hb.index.searchsorted(close_t.to_numpy(), side="right") - 1
        b = np.where(idx >= 0, hb.to_numpy()[np.clip(idx, 0, None)], 0); b[:200 * 12] = 0
        self.bias = b


def strategies(f):
    mk = f.mk; o, h, l, c, td = mk.o, mk.h, mk.l, mk.c, mk.tday
    mclose = (mk.m + 5) % 1440
    S = []  # (name, params, sig, exit_sig, window)

    # 1 EMA crossover
    for a, b in ((9, 21), (20, 50)):
        ea, eb = f.e[a], f.e[b]
        sig = cross_up(ea, eb).astype(int) - cross_up(eb, ea).astype(int)
        S.append(("EMA cross", f"{a}/{b}", sig, -sig, "ny"))
    # 2 MACD 12/26/9 cross, on the right side of zero
    m_ = ema(c, 12) - ema(c, 26); sg = ema(m_, 9)
    sig = (cross_up(m_, sg) & (m_ < 0)).astype(int) - (cross_up(sg, m_) & (m_ > 0)).astype(int)
    S.append(("MACD cross", "12/26/9", sig, None, "ny"))
    # 3 Supertrend 10/3 flip
    atr10 = rma(np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1)))), 10)
    hl2 = (h + l) / 2; up = hl2 - 3 * atr10; dn = hl2 + 3 * atr10
    fu = up.copy(); fd = dn.copy(); dirn = np.ones(len(c))
    for i in range(1, len(c)):
        fu[i] = max(up[i], fu[i - 1]) if c[i - 1] > fu[i - 1] else up[i]
        fd[i] = min(dn[i], fd[i - 1]) if c[i - 1] < fd[i - 1] else dn[i]
        dirn[i] = 1 if c[i] > fd[i - 1] else -1 if c[i] < fu[i - 1] else dirn[i - 1]
    flip = np.r_[0, np.diff(dirn)]
    sig = np.where(flip > 0, 1, np.where(flip < 0, -1, 0))
    S.append(("Supertrend", "10/3", sig, -sig, "ny"))
    # 4 Donchian breakout
    for N in (20, 55):
        hh = pd.Series(h).rolling(N).max().shift(1).to_numpy(); ll = pd.Series(l).rolling(N).min().shift(1).to_numpy()
        sig = (c > hh).astype(int) - (c < ll).astype(int)
        S.append(("Donchian breakout", f"{N}", sig, None, "ny"))
    # 5 Bollinger mean reversion (close back inside 20/2 band, exit at middle band)
    lo = f.sma20 - 2 * f.sd20; hi = f.sma20 + 2 * f.sd20
    sig = ((np.roll(c, 1) < np.roll(lo, 1)) & (c > lo)).astype(int) - ((np.roll(c, 1) > np.roll(hi, 1)) & (c < hi)).astype(int)
    ex = (c >= f.sma20).astype(int) - (c <= f.sma20).astype(int)
    S.append(("Bollinger reversion", "20/2", sig, ex, "ny"))
    # 6 RSI(2) Connors reversion with EMA200 trend, exit close > EMA5
    for th in (5, 10):
        sig = ((f.rsi2 < th) & (c > f.e[200])).astype(int) - ((f.rsi2 > 100 - th) & (c < f.e[200])).astype(int)
        ex = (c > f.e[5]).astype(int) - (c < f.e[5]).astype(int)
        S.append(("RSI(2) reversion", f"<{th}", sig, ex, "ny"))
    # 7 RSI(14) 30/70 fade
    sig = cross_up(f.rsi14, np.full(len(c), 30.0)).astype(int) - cross_up(np.full(len(c), 70.0), f.rsi14).astype(int)
    S.append(("RSI(14) 30/70", "", sig, None, "ny"))
    # 8 VWAP trend pullback and VWAP band fade
    v = f.vwap
    sig = ((f.e[20] > f.e[50]) & (l <= v) & (c > v)).astype(int) - ((f.e[20] < f.e[50]) & (h >= v) & (c < v)).astype(int)
    S.append(("VWAP pullback", "", sig, None, "ny"))
    dev = pd.Series(c - v).groupby(td).transform(lambda x: x.expanding().std()).to_numpy()
    sig = ((c < v - 2 * dev) & (np.roll(c, 1) >= np.roll(v - 2 * dev, 1))).astype(int) - ((c > v + 2 * dev) & (np.roll(c, 1) <= np.roll(v + 2 * dev, 1))).astype(int)
    S.append(("VWAP 2sd fade", "", -(-sig), (c >= v).astype(int) - (c <= v).astype(int), "ny"))
    # 9 Opening range breakout (NY 09:30)
    for N in (15, 30):
        inr = (mclose > 570) & (mclose <= 570 + N)
        rh = pd.Series(np.where(inr, h, np.nan)).groupby(td).transform("max").to_numpy()
        rl = pd.Series(np.where(inr, l, np.nan)).groupby(td).transform("min").to_numpy()
        after = (mclose > 570 + N) & (mclose <= 720)
        sig = first_per_day(after & ((c > rh) | (c < rl)), td).astype(int) * np.where(c > rh, 1, -1)
        S.append(("Opening range breakout", f"{N}m", sig, None, "ny"))
    # 10 London breakout of Asia range (20:00-02:00 NY)
    ina = (mk.m >= 1200) | (mk.m < 120)
    ah = pd.Series(np.where(ina, h, np.nan)).groupby(td).transform(lambda x: x.ffill().cummax()).to_numpy()
    al = pd.Series(np.where(ina, l, np.nan)).groupby(td).transform(lambda x: x.ffill().cummin()).to_numpy()
    lwin = (mclose > 120) & (mclose <= 300)
    sig = first_per_day(lwin & ((c > ah) | (c < al)), td).astype(int) * np.where(c > ah, 1, -1)
    S.append(("London breakout", "Asia range", sig, None, "lon"))
    # 11 Previous day high/low: breakout and sweep-fade
    sig = first_per_day((c > f.pdh) | (c < f.pdl), td).astype(int) * np.where(c > f.pdh, 1, -1)
    S.append(("PDH/PDL breakout", "", sig, None, "lonny"))
    sw = ((l < f.pdl) & (c > f.pdl)).astype(int) - ((h > f.pdh) & (c < f.pdh)).astype(int)
    S.append(("PDH/PDL sweep fade", "", sw, None, "lonny"))
    # 12 Bollinger/Keltner squeeze breakout
    kc = 1.5 * rma(np.maximum(h - l, abs(h - np.roll(c, 1))), 20)
    sq = (f.sd20 * 2 < kc)
    rel = np.roll(sq, 1) & ~sq
    sig = (rel & (c > f.sma20)).astype(int) - (rel & (c < f.sma20)).astype(int)
    S.append(("Squeeze breakout", "BB/KC", sig, None, "ny"))
    # 13 NR7 breakout
    rng = h - l
    nr7 = pd.Series(rng).rolling(7).min().to_numpy() == rng
    pn = np.roll(nr7, 1)
    sig = (pn & (c > np.roll(h, 1))).astype(int) - (pn & (c < np.roll(l, 1))).astype(int)
    S.append(("NR7 breakout", "", sig, None, "ny"))
    # 14 Trend pullback: EMA50>EMA200, close crosses back above EMA20
    sig = (cross_up(c, f.e[20]) & (f.e[50] > f.e[200])).astype(int) - (cross_up(f.e[20], c) & (f.e[50] < f.e[200])).astype(int)
    S.append(("EMA trend pullback", "20/50/200", sig, None, "ny"))
    # 15 Liquidity sweep -> FVG (simplified ICT, market entry)
    ll20 = pd.Series(l).rolling(20).min().shift(1).to_numpy(); hh20 = pd.Series(h).rolling(20).max().shift(1).to_numpy()
    swl = (l < ll20) & (c > ll20); swh = (h > hh20) & (c < hh20)
    body = c - o
    fup = (l > np.roll(h, 2)) & (np.roll(body, 1) >= 0.7 * np.roll(mk.atr, 1))
    fdn = (h < np.roll(l, 2)) & (-np.roll(body, 1) >= 0.7 * np.roll(mk.atr, 1))
    recent_l = pd.Series(swl.astype(float)).rolling(5).max().shift(1).to_numpy() > 0
    recent_h = pd.Series(swh.astype(float)).rolling(5).max().shift(1).to_numpy() > 0
    sig = (fup & recent_l).astype(int) - (fdn & recent_h).astype(int)
    S.append(("Sweep + FVG (ICT)", "", sig, None, "lonny"))
    return S


FILTERS = {
    "none": lambda f, sig: sig,
    "1H bias": lambda f, sig: np.where(np.sign(sig) == f.bias, sig, 0),
    "VWAP side": lambda f, sig: np.where(np.sign(sig) == np.sign(f.mk.c - f.vwap), sig, 0),
    "ADX>25 trend": lambda f, sig: np.where(f.adx > 25, sig, 0),
    "ADX<20 range": lambda f, sig: np.where(f.adx < 20, sig, 0),
}
