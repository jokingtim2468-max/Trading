"""Small 5-minute backtest engine: one position at a time, market entry at next bar open,
ATR stop / R-multiple target, max-hold time stop, forced flat 16:35 NY (Lucid closes 16:45)."""
import numpy as np, pandas as pd


def load(path):
    df = pd.read_csv(path, sep="\t", header=None, names=["t", "o", "h", "l", "c", "v"])
    df["t"] = pd.to_datetime(df["t"]).dt.tz_localize("UTC")      # file is UTC (18:00 NY open = 22:00/23:00)
    ny = df["t"].dt.tz_convert("America/New_York")
    df["ny"] = ny
    df["m"] = (ny.dt.hour * 60 + ny.dt.minute).to_numpy()
    df["dow"] = ny.dt.dayofweek.to_numpy()
    # trading day rolls at 18:00 NY (futures session)
    df["tday"] = (ny + pd.Timedelta(hours=6)).dt.strftime("%Y%m%d").astype(int)
    return df.reset_index(drop=True)


def rma(x, n):
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    out[n - 1] = np.nanmean(x[:n])
    a = 1.0 / n
    for i in range(n, len(x)):
        out[i] = out[i - 1] + a * (x[i] - out[i - 1])
    return out


def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().to_numpy()


class Market:
    def __init__(self, df, cost):
        self.df = df
        self.o, self.h, self.l, self.c = (df[k].to_numpy(float) for k in "ohlc")
        self.m = df["m"].to_numpy(); self.dow = df["dow"].to_numpy(); self.tday = df["tday"].to_numpy()
        self.n = len(df); self.cost = cost
        self.ts = ((df["t"] - df["t"].iloc[0]).dt.total_seconds() // 60).to_numpy()  # minutes
        c = self.c
        tr = np.maximum(self.h - self.l, np.maximum(abs(self.h - np.roll(c, 1)), abs(self.l - np.roll(c, 1))))
        tr[0] = self.h[0] - self.l[0]
        self.atr = rma(tr, 14)
        # forced-flat bars: 16:35-18:00 NY, weekend, or new trading day
        flat = ((self.m >= 995) & (self.m < 1080)) | (self.dow >= 5)
        flat[1:] |= self.tday[1:] != self.tday[:-1]
        nxt = np.empty(self.n, int); k = self.n
        for j in range(self.n - 1, -1, -1):
            if flat[j]:
                k = j
            nxt[j] = k
        self.next_flat = nxt
        self.cut = None  # index where out-of-sample starts

    def window(self, start, end):
        """bars whose CLOSE time is in [start, end) NY, Mon-Fri"""
        mc = (self.m + 5) % 1440
        return (mc >= start) & (mc < end) & (self.dow < 5)

    def run(self, sig, ok, sl_atr, rr, hold, exit_sig=None, maxday=4):
        o, h, l, n = self.o, self.h, self.l, self.n
        out = []
        free = 0; daycnt = {}
        for i in np.flatnonzero(sig):
            if i < free or i + 2 >= n or not ok[i] or np.isnan(self.atr[i]):
                continue
            td = self.tday[i]
            if daycnt.get(td, 0) >= maxday:
                continue
            d = int(np.sign(sig[i])); s = i + 1; e = o[s]
            if self.next_flat[s] == s:
                continue
            risk = sl_atr * self.atr[i]
            sl = e - d * risk
            tp = e + d * rr * risk if rr > 0 else np.nan
            end = min(s + hold, self.next_flat[s], n - 1)
            hh, ll = h[s:end], l[s:end]
            hs = (ll <= sl) if d == 1 else (hh >= sl)
            ht = ((hh >= tp) if d == 1 else (ll <= tp)) if rr > 0 else np.zeros(end - s, bool)
            ks = np.argmax(hs) if hs.any() else 10**9
            kt = np.argmax(ht) if ht.any() else 10**9
            kx = 10**9
            if exit_sig is not None:
                ex = exit_sig[s:end] * d > 0
                if ex.any():
                    kx = np.argmax(ex)
            k = min(ks, kt, kx)
            if k == 10**9:
                j = end; x = o[end]; why = "time"
                if self.ts[end] - self.ts[end - 1] > 10:   # data gap: flatten at the last real bar
                    x = self.c[end - 1]
            elif k == ks:              # stop first on ties (conservative); gap through stop fills at open
                j = s + k; x = min(o[j], sl) if d == 1 else max(o[j], sl); why = "sl"
                if j == s: x = sl
            elif k == kt:
                j = s + k; x = tp; why = "tp"
            else:
                j = s + k + 1; x = o[j]; why = "exit"
            pnl = d * (x - e) - self.cost
            out.append((i, d, e, x, pnl, pnl / risk if risk > 0 else 0, j - s, why))
            daycnt[td] = daycnt.get(td, 0) + 1
            free = j
        return pd.DataFrame(out, columns=["i", "d", "e", "x", "pts", "R", "bars", "why"])


def stats(t, mk, part=None):
    if part == "is":
        t = t[t.i < mk.cut]
    elif part == "oos":
        t = t[t.i >= mk.cut]
    if len(t) == 0:
        return dict(n=0, net=0.0, pf=0.0, win=0.0, dd=0.0, R=0.0)
    p = t.pts.to_numpy()
    eq = np.cumsum(p); dd = np.max(np.maximum.accumulate(np.r_[0, eq])[1:] - eq)
    gl = -p[p < 0].sum()
    return dict(n=len(t), net=p.sum(), pf=p[p > 0].sum() / gl if gl > 0 else 99.0,
                win=(p > 0).mean() * 100, dd=dd, R=t.R.sum())
