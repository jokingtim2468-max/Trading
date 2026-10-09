"""Train the Day Range Predictor on recent market data.

Pulls daily and hourly history from Yahoo Finance (NQ=F Nasdaq e-mini, GC=F gold),
cross-checks the latest prices against Google Finance, then tunes:

  * the predicted high/low lines (lookback days, ATR length, max-line percentile)
  * the BUY/SELL signal filters (zone, filters required, wick, RSI, target)

Every setting is chosen on older data and then scored on the most recent data it
never saw (the holdout), so the numbers in the report are what the settings did
on "unseen" days. Results are written to:

  presets/DRP_US100.set, presets/DRP_XAUUSD.set   MT5 input presets
  reports/training_report.md                     what was tested and how it scored
  experts/DayRangePredictor.mq5, pine/DayRangePredictor.pine
                                                 the TRAINED PRESETS block is rewritten

Run:  python tools/train_drp.py            (Windows: py tools\\train_drp.py)
Needs: pip install -r tools/requirements.txt
"""

import argparse
import datetime as dt
import itertools
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ai import short_model as SM  # noqa: E402
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# Yahoo symbol, Google Finance quote id, session (NY minutes), round-trip cost in price units
MARKETS = {
    "NQ": {"name": "Nasdaq e-mini / US100", "yahoo": "NQ=F", "google": "NQW00:CME_EMINIS",
           "session": (9 * 60 + 30, 16 * 60), "cost": 2.0, "set": "DRP_US100.set"},
    "GC": {"name": "Gold / XAUUSD", "yahoo": "GC=F", "google": "GCW00:COMEX",
           "session": (3 * 60, 12 * 60), "cost": 0.40, "set": "DRP_XAUUSD.set"},
}

TARGET_HELD = 0.95          # each max line should hold on at least this share of days
HOLDOUT_DAYS = 250          # most recent days kept unseen for the line test
SIGNAL_HOLDOUT = 0.30       # most recent share of hourly bars kept unseen for signals
MIN_TRAIN_TRADES = 15
START = "// === TRAINED PRESETS START (rewritten by tools/train_drp.py, don't edit by hand)"
END = "// === TRAINED PRESETS END ==="


# ---------------------------------------------------------------- data
def fetch(url):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.read().decode("utf-8", errors="ignore")


def yahoo(symbol, rng, interval):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(symbol)}?range={rng}&interval={interval}"
    res = json.loads(fetch(url))["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    idx = pd.to_datetime(res["timestamp"], unit="s", utc=True).tz_convert("America/New_York")
    df = pd.DataFrame({"o": q["open"], "h": q["high"], "l": q["low"], "c": q["close"], "v": q["volume"]}, index=idx)
    return df.dropna(subset=["o", "h", "l", "c"])


def google_quote(qid):
    """Google Finance has no history download; read the latest settlement/open/high/low for a cross-check."""
    try:
        html = fetch(f"https://www.google.com/finance/quote/{qid}")
    except Exception as e:  # network or layout change: the cross-check is optional
        return {"error": str(e)}
    out = {}
    for k, v in re.findall(r'class="SwQK7">([^<]*)</div><div class="dO6ijd">([^<]*)', html):
        num = re.sub(r"[^0-9.]", "", v)
        if num and k not in out:
            try:
                out[k] = float(num)
            except ValueError:
                pass
    return out


# ---------------------------------------------------------------- lines
def line_table(d, lookback, atr_len, pcts):
    tr = np.maximum(d.h, d.c.shift()) - np.minimum(d.l, d.c.shift())
    atr = tr.rolling(atr_len).mean().shift()
    up, dn = (d.h - d.o) / atr, (d.o - d.l) / atr
    out = pd.DataFrame({"o": d.o, "h": d.h, "l": d.l, "atr": atr})
    minp = min(lookback, 100)
    for p in pcts:
        out[f"u{p}"] = up.rolling(lookback, min_periods=minp).quantile(p / 100, interpolation="linear").shift()
        out[f"d{p}"] = dn.rolling(lookback, min_periods=minp).quantile(p / 100, interpolation="linear").shift()
    return out


def held_rates(t, p):
    t = t.dropna(subset=[f"u{p}", f"d{p}", "atr"])
    hi = t.h <= t.o + t[f"u{p}"] * t.atr
    lo = t.l >= t.o - t[f"d{p}"] * t.atr
    width = (t[f"u{p}"] + t[f"d{p}"]).mean()
    return hi.mean(), lo.mean(), (hi & lo).mean(), width, len(t)


def train_lines(daily):
    pcts = [round(x, 1) for x in np.arange(90, 99.01, 0.5)]
    train_end = len(daily) - HOLDOUT_DAYS
    best = None
    rows = []
    for lb, al in itertools.product([60, 120, 180, 250, 375, 500], [5, 10, 14, 20]):
        t = line_table(daily, lb, al, pcts)
        tr = t.iloc[max(0, train_end - 750):train_end]       # ~3 years before the holdout
        for p in pcts:
            hi, lo, both, width, n = held_rates(tr, p)
            if n < 200 or min(hi, lo) < TARGET_HELD:
                continue
            rows.append((lb, al, p, hi, lo, width))
            if best is None or width < best[5]:
                best = (lb, al, p, hi, lo, width)
            break                                             # narrowest percentile that meets target
    lb, al, p = best[:3]
    t = line_table(daily, lb, al, [50, p])
    hold = t.iloc[train_end:]
    hi, lo, both, width, n = held_rates(hold, p)
    base_t = line_table(daily, 250, 14, [95])
    bhi, blo, bboth, bwidth, bn = held_rates(base_t.iloc[train_end:], 95)
    return {
        "lookback": lb, "atr": al, "outer": p, "inner": 50.0,
        "train_hi": best[3], "train_lo": best[4], "train_width": best[5],
        "hold_hi": hi, "hold_lo": lo, "hold_both": both, "hold_width": width, "hold_days": n,
        "base_hi": bhi, "base_lo": blo, "base_both": bboth, "base_width": bwidth,
        "candidates": len(rows),
    }


# ---------------------------------------------------------------- signals
def rsi(c, n=14):
    d = c.diff()
    g = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    l_ = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + g / l_)


def prep_bars(h1, daily, lines, session, zone_pcts):
    df = h1.copy()
    df["day"] = (df.index + pd.Timedelta(hours=6)).date     # CME trade date (rolls at 18:00 New York)
    df["rsi"] = rsi(df.c)
    tp = (df.h + df.l + df.c) / 3
    v = df.v.replace(0, np.nan).fillna(1)
    cv, cpv, cp2 = v.groupby(df.day).cumsum(), (tp * v).groupby(df.day).cumsum(), (tp * tp * v).groupby(df.day).cumsum()
    df["vw"] = cpv / cv
    df["sd"] = np.sqrt((cp2 / cv - df.vw ** 2).clip(lower=0))
    t = line_table(daily, lines["lookback"], lines["atr"], sorted(set(zone_pcts + [lines["outer"]])))
    cols = ["atr"] + [c for c in t.columns if c[0] in "ud"]
    df = df.join(t[["o"] + cols].rename(columns={"o": "do"}), on="day").dropna(subset=["atr", "do"])
    mins = df.index.hour * 60 + df.index.minute
    df["sess"] = (mins >= session[0]) & (mins < session[1])
    df["rmax"] = df.rsi.rolling(3).max()
    df["rmin"] = df.rsi.rolling(3).min()
    df["rprev"] = df.rsi.shift()
    return df


def simulate(df, outer, zp, min_score, wick, ob, rr, cost, vk=2.0, tol=0.10, buf=0.05):
    os_ = 100 - ob
    o, h, l, c = df.o.values, df.h.values, df.l.values, df.c.values
    r, rmax, rmin, rprev = df.rsi.values, df.rmax.values, df.rmin.values, df.rprev.values
    vu, vl = (df.vw + vk * df.sd).values, (df.vw - vk * df.sd).values
    do, atr, sess, day = df["do"].values, df.atr.values, df.sess.values, df.day.values
    zh = do + df[f"u{zp}"].values * atr
    zl = do - df[f"d{zp}"].values * atr
    oh = do + df[f"u{outer}"].values * atr
    ol = do - df[f"d{outer}"].values * atr
    res = []
    tdir, sl, tp_, risk = 0, 0.0, 0.0, 1.0
    sold = bought = None
    for i in range(3, len(c)):
        if tdir:
            hit_sl = h[i] >= sl if tdir < 0 else l[i] <= sl
            hit_tp = l[i] <= tp_ if tdir < 0 else h[i] >= tp_
            if hit_sl:
                res.append(-1 - cost / risk); tdir = 0
            elif hit_tp:
                res.append(rr - cost / risk); tdir = 0
            continue
        rng = h[i] - l[i]
        if rng <= 0 or np.isnan(zh[i]):
            continue
        s1 = h[i] >= zh[i] - tol * atr[i]
        if s1 and sold != day[i]:
            sc = 1 + (c[i] < o[i] and h[i] - max(o[i], c[i]) >= wick * rng and c[i] < oh[i]) \
                + (rmax[i] >= ob and r[i] < rprev[i]) + (h[i] >= vu[i]) + bool(sess[i])
            if sc >= min_score:
                sl = h[i] + buf * atr[i]; risk = sl - c[i]; tp_ = c[i] - rr * risk
                tdir, sold = -1, day[i]
                continue
        b1 = l[i] <= zl[i] + tol * atr[i]
        if b1 and bought != day[i]:
            sc = 1 + (c[i] > o[i] and min(o[i], c[i]) - l[i] >= wick * rng and c[i] > ol[i]) \
                + (rmin[i] <= os_ and r[i] > rprev[i]) + (l[i] <= vl[i]) + bool(sess[i])
            if sc >= min_score:
                sl = l[i] - buf * atr[i]; risk = c[i] - sl; tp_ = c[i] + rr * risk
                tdir, bought = 1, day[i]
    a = np.array(res)
    return {"n": len(a), "win": float((a > 0).mean()) if len(a) else 0.0, "netR": float(a.sum()) if len(a) else 0.0}


def train_signals(h1, daily, lines, mk):
    zones = [75, 80, 85, 90]
    df = prep_bars(h1, daily, lines, mk["session"], zones)
    split = int(len(df) * (1 - SIGNAL_HOLDOUT))
    tr, ho = df.iloc[:split], df.iloc[split:]
    grid = list(itertools.product(zones, [4, 5], [0.3, 0.4, 0.5], [65, 70, 75], [0.5, 0.75, 1.0, 1.5]))
    scored = []
    for zp, ms, wk, ob, rr in grid:
        s = simulate(tr, lines["outer"], zp, ms, wk, ob, rr, mk["cost"])
        if s["n"] >= MIN_TRAIN_TRADES:
            scored.append((s["netR"] / s["n"], (zp, ms, wk, ob, rr), s))
    scored.sort(key=lambda x: x[0], reverse=True)
    default = (85, 5, 0.4, 70, 1.0)
    out = {"tested": len(grid), "eligible": len(scored),
           "train_from": str(tr.index[0].date()), "hold_from": str(ho.index[0].date()), "hold_to": str(ho.index[-1].date()),
           "default_hold": simulate(ho, lines["outer"], *default, mk["cost"])}
    if not scored:
        out.update(best=default, train=None, hold=out["default_hold"], edge=False, params=default)
        return out
    _, params, strain = scored[0]
    shold = simulate(ho, lines["outer"], *params, mk["cost"])
    edge = strain["netR"] > 0 and shold["netR"] > 0 and shold["n"] >= 5
    # Only ship tuned filters that also made money on data they never saw; otherwise keep the strict defaults.
    out.update(best=params, train=strain, hold=shold, edge=edge, params=params if edge else default)
    return out


# ---------------------------------------------------------------- live high / low / build-up
PROF_STEP = 0.05     # profile bin size in daily ATRs (must match the scripts)
PROF_HALF = 60       # bins each side of the open -> covers +/- 3 ATR
LIVE_HOLDOUT_DAYS = 120


def live_bars(h1, daily, atr_len, session):
    """Per hourly bar: hours since the day's first bar, range so far, position in it, build-up so far."""
    tr = np.maximum(daily.h, daily.c.shift()) - np.minimum(daily.l, daily.c.shift())
    atr = tr.rolling(atr_len).mean().shift()
    df = h1.copy()
    df["day"] = (df.index + pd.Timedelta(hours=6)).date
    df = df.join(atr.rename("atr"), on="day").dropna(subset=["atr"])
    rows = []
    for day, g in df.groupby("day"):
        if len(g) < 12:
            continue
        a = g.atr.iloc[0]
        step = PROF_STEP * a
        base = g.o.iloc[0] - PROF_HALF * step
        prof = np.zeros(2 * PROF_HALF + 1)
        t0 = g.index[0]
        H, L = g.h.max(), g.l.min()
        hs, ls = -np.inf, np.inf
        hi_hr = int((g.h.idxmax() - t0).total_seconds() // 3600)
        lo_hr = int((g.l.idxmin() - t0).total_seconds() // 3600)
        mins = g.index.hour * 60 + g.index.minute
        sess_seen = False
        for ts, o, h, l, c, m in zip(g.index, g.o, g.h, g.l, g.c, mins):
            hs, ls = max(hs, h), min(ls, l)
            b0 = max(0, int(np.floor((l - base) / step)))
            b1 = min(len(prof) - 1, int(np.floor((h - base) / step)))
            if b1 >= b0:
                prof[b0:b1 + 1] += 1
            hr = min(23, int((ts - t0).total_seconds() // 3600))
            pos = 1 if hs <= ls else min(2, int((c - ls) / (hs - ls) * 3))
            in_sess = session[0] <= m < session[1]
            first_sess = in_sess and not sess_seen
            sess_seen = sess_seen or in_sess
            rows.append((day, hr, pos, hs, ls, base + (np.argmax(prof) + 0.5) * step, H, L, a, hi_hr, lo_hr, first_sess))
    r = pd.DataFrame(rows, columns=["day", "hr", "pos", "hs", "ls", "poc", "H", "L", "atr", "hi_hr", "lo_hr", "first_sess"])
    r["eu"] = (r.H - r.hs) / r.atr
    r["ed"] = (r.ls - r.L) / r.atr
    fin = r.groupby("day").poc.last()
    r["fpoc"] = r.day.map(fin)
    return r


def fit_live(r):
    eu = r.groupby(["hr", "pos"]).eu.median()
    ed = r.groupby(["hr", "pos"]).ed.median()
    eu_h, ed_h = r.groupby("hr").eu.median(), r.groupby("hr").ed.median()
    up, dn, w, thi, tlo = [], [], [], [], []
    for hr in range(24):
        for pos in range(3):
            up.append(float(eu.get((hr, pos), eu_h.get(hr, 0.0))))
            dn.append(float(ed.get((hr, pos), ed_h.get(hr, 0.0))))
    up, dn = [round(x, 3) for x in up], [round(x, 3) for x in dn]
    tab = {"up": up, "dn": dn}
    r = r.assign(lh=r.hs + r.hr.mul(3).add(r.pos).map(dict(enumerate(up))) * r.atr,
                 ll=r.ls - r.hr.mul(3).add(r.pos).map(dict(enumerate(dn))) * r.atr)
    r["mid"] = (r.lh + r.ll) / 2
    for hr in range(24):
        g = r[r.hr == hr]
        if len(g) < 30:
            w.append(w[-1] if w else 0.0)
        else:
            ws = np.linspace(0, 1, 21)
            w.append(round(float(ws[np.argmin([np.abs(g.mid * (1 - x) + g.poc * x - g.fpoc).mean() for x in ws])]), 2))
        later_hi = r[(r.hr == hr) & (r.hi_hr > hr)].drop_duplicates("day").hi_hr
        later_lo = r[(r.hr == hr) & (r.lo_hr > hr)].drop_duplicates("day").lo_hr
        thi.append(float(later_hi.median() + 0.5) if len(later_hi) >= 10 else float(min(23.5, hr + 1)))
        tlo.append(float(later_lo.median() + 0.5) if len(later_lo) >= 10 else float(min(23.5, hr + 1)))
    tab.update(w=w, thi=thi, tlo=tlo)
    return tab


def apply_live(r, tab):
    k = (r.hr * 3 + r.pos).to_numpy()
    lh = r.hs + np.take(tab["up"], k) * r.atr
    ll = r.ls - np.take(tab["dn"], k) * r.atr
    w = np.take(tab["w"], r.hr.to_numpy())
    bu = (lh + ll) / 2 * (1 - w) + r.poc * w
    return lh, ll, bu


def train_live(h1, daily, lines, mk):
    r = live_bars(h1, daily, lines["atr"], mk["session"])
    days = sorted(r.day.unique())
    cut = days[-LIVE_HOLDOUT_DAYS]
    tr, ho = r[r.day < cut], r[r.day >= cut]
    tab = fit_live(tr)
    lh, ll, bu = apply_live(ho, tab)
    ho = ho.assign(mh=(lh - ho.H).abs() / ho.atr, ml=(ll - ho.L).abs() / ho.atr, mb=(bu - ho.fpoc).abs() / ho.atr)
    # the old fixed "likely" lines (P50 at the open), same days, for comparison
    t = line_table(daily, lines["lookback"], lines["atr"], [50])
    fx = ho.drop_duplicates("day").join(t[["o", "u50", "d50"]], on="day")
    fixed = ((fx.o + fx.u50 * fx.atr - fx.H).abs() / fx.atr).mean(), ((fx.o - fx.d50 * fx.atr - fx.L).abs() / fx.atr).mean()
    first = ho.groupby("day").head(1)
    sess = ho[ho.first_sess]
    last_atr = float(r.atr.iloc[-1])
    ev = {
        "days": ho.day.nunique(), "from": str(cut), "atr": last_atr,
        "fixed": fixed,
        "open": (first.mh.mean(), first.ml.mean(), first.mb.mean()),
        "session": (sess.mh.mean(), sess.ml.mean(), sess.mb.mean()),
        "all": (ho.mh.mean(), ho.ml.mean(), ho.mb.mean()),
        "near": float(((ho.mh <= 0.1) & (ho.ml <= 0.1)).mean()),
        "by_hr": ho.groupby("hr")[["mh", "ml", "mb"]].mean(),
    }
    return fit_live(r), ev       # ship tables fitted on all days, including the most recent ones


# ---------------------------------------------------------------- short-term AI (quick trades)
def train_short(daily, lines, mk):
    """Fit the quick-trade direction model and pick TP/SL multiples on 5-minute bars.
    The last 30% of days are held out; the shipped model is refit on all days."""
    b = yahoo(mk["yahoo"], "60d", "5m")
    b = b[b.v > 0] if (b.v > 0).mean() > 0.5 else b
    tr = np.maximum(daily.h, daily.c.shift()) - np.minimum(daily.l, daily.c.shift())
    day_atr = tr.rolling(lines["atr"]).mean().shift().to_dict()
    days = sorted(set((b.index + pd.Timedelta(hours=6)).date))
    cut = days[int(len(days) * 0.7)]
    h1 = yahoo(mk["yahoo"], "730d", "1h")
    r = live_bars(h1, daily, lines["atr"], mk["session"])
    live_tr = fit_live(r[r.day < cut])                          # day tables known before the holdout

    def dataset(live):
        F, atr = SM.features(b, day_atr, live)
        fwd = b.c.shift(-SM.HOLD_BARS) - b.c
        ok = F.notna().all(axis=1) & fwd.notna() & atr.notna()
        return F[ok], atr[ok], fwd[ok]

    F, atr, fwd = dataset(live_tr)
    bars = b.loc[F.index]
    is_tr = np.array([(t + pd.Timedelta(hours=6)).date() < cut for t in F.index])
    mu, sd = F[is_tr].mean(), F[is_tr].std().replace(0, 1)
    coef = SM.fit_logistic(((F[is_tr] - mu) / sd).to_numpy(), (fwd[is_tr] > 0).astype(float).to_numpy())
    m = {"mu": mu.tolist(), "sd": sd.tolist(), "coef": coef.tolist()}
    p = SM.predict(F, m)
    y = (fwd > 0).to_numpy()
    acc_tr, acc_ho = float(((p > 0.5) == y)[is_tr].mean()), float(((p > 0.5) == y)[~is_tr].mean())
    best = None
    for thr, tpm, slm in itertools.product([0.5, 0.52, 0.55], [0.75, 1.0, 1.5, 2.0, 3.0], [0.5, 0.75, 1.0, 1.5, 2.0]):
        dirs = np.where(p >= thr, 1, np.where(p <= 1 - thr, -1, 0))
        st = SM.simulate(bars[is_tr], atr[is_tr], dirs[is_tr], tpm, slm, mk["cost"])
        if st["n"] >= 40 and (best is None or st["ev"] > best[0]["ev"]):
            best = (st, thr, tpm, slm)
    st_tr, thr, tpm, slm = best
    dirs = np.where(p >= thr, 1, np.where(p <= 1 - thr, -1, 0))
    st_ho = SM.simulate(bars[~is_tr], atr[~is_tr], dirs[~is_tr], tpm, slm, mk["cost"])
    # ship: refit on every day with the full-data day tables
    F2, _, fwd2 = dataset(fit_live(r))
    mu2, sd2 = F2.mean(), F2.std().replace(0, 1)
    coef2 = SM.fit_logistic(((F2 - mu2) / sd2).to_numpy(), (fwd2 > 0).astype(float).to_numpy())
    return {"features": SM.FEATURES, "mu": [round(x, 6) for x in mu2], "sd": [round(x, 6) for x in sd2],
            "coef": [round(x, 6) for x in coef2], "thr": thr, "tpm": tpm, "slm": slm, "hold_bars": SM.HOLD_BARS,
            "acc_train": acc_tr, "acc_hold": acc_ho, "train": st_tr, "hold": st_ho,
            "edge": bool(st_tr["ev"] > 0 and st_ho["ev"] > 0 and st_ho["n"] >= 30),
            "hold_from": str(cut), "bars": int(len(F))}


# ---------------------------------------------------------------- outputs
def write_set(path, lines, sig):
    zp, ms, wk, ob, rr = sig["params"]
    vals = {
        "InpUseTrained": "false",  # the .set carries the values itself
        "InpLookbackDays": lines["lookback"], "InpAtrDays": lines["atr"],
        "InpInnerPct": lines["inner"], "InpOuterPct": lines["outer"],
        "InpShowSignals": "true", "InpZonePct": zp, "InpMinScore": ms,
        "InpWickPct": int(wk * 100), "InpRsiOB": ob, "InpRsiOS": 100 - ob, "InpRR": rr,
    }
    text = "; Day Range Predictor preset generated by tools/train_drp.py on " + dt.date.today().isoformat() + "\r\n"
    text += "".join(f"{k}={v}\r\n" for k, v in vals.items())
    path.write_bytes(b"\xff\xfe" + text.encode("utf-16-le"))   # MT5 saves .set files as UTF-16 LE


def preset_values(res):
    out = {}
    for key, r in res.items():
        zp, ms, wk, ob, rr = r["sig"]["params"]
        out[key] = dict(lookback=r["lines"]["lookback"], atr=r["lines"]["atr"], inner=r["lines"]["inner"],
                        outer=r["lines"]["outer"], zone=float(zp), score=ms, wick=float(wk * 100),
                        ob=float(ob), os=float(100 - ob), rr=float(rr))
    return out


def rewrite_block(path, start, end, body):
    s = path.read_text(encoding="utf-8")
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pat.search(s):
        raise SystemExit(f"Preset markers not found in {path}")
    path.write_text(pat.sub(lambda _: start + "\n" + body + end, s), encoding="utf-8")


def update_sources(res, stamp):
    v = preset_values(res)
    nq, gc = v["NQ"], v["GC"]
    note = f"trained {stamp} on Yahoo Finance NQ=F / GC=F by tools/train_drp.py"
    pine = [f"// {note}"]
    mql = [f"// {note}"]
    for key, tag in (("NQ", "Nq"), ("GC", "Gc")):
        p = v[key]
        for name, k in (("Lookback", "lookback"), ("Atr", "atr"), ("Inner", "inner"), ("Outer", "outer"), ("Zone", "zone"),
                        ("Score", "score"), ("Wick", "wick"), ("OB", "ob"), ("OS", "os"), ("RR", "rr")):
            pine.append(f"t{tag}{name} = {p[k]}")
        mql.append(f"const int    T_{key}_LOOKBACK = {p['lookback']}, T_{key}_ATR = {p['atr']}, T_{key}_SCORE = {p['score']};")
        mql.append(f"const double T_{key}_INNER = {p['inner']}, T_{key}_OUTER = {p['outer']}, T_{key}_ZONE = {p['zone']}, T_{key}_WICK = {p['wick']},")
        mql.append(f"             T_{key}_OB = {p['ob']}, T_{key}_OS = {p['os']}, T_{key}_RR = {p['rr']};")
        sm = res[key]["short"]
        for name, vals in (("SMu", sm["mu"]), ("SSd", sm["sd"]), ("SCoef", sm["coef"])):
            pine.append(f"var t{tag}{name} = array.from({', '.join(str(x) for x in vals)})")
            mql.append(f"double T_{key}_{name.upper()}[{len(vals)}] = {{{', '.join(str(x) for x in vals)}}};")
        for name, val in (("SThr", sm["thr"]), ("STp", sm["tpm"]), ("SSl", sm["slm"]), ("SWin", round(sm["hold"]["win"], 3)),
                          ("SEv", round(sm["hold"]["ev"], 3)), ("SEdge", 1.0 if sm["edge"] else 0.0)):
            pine.append(f"t{tag}{name} = {float(val)}")
            mql.append(f"const double T_{key}_{name.upper()} = {float(val)};")
        lv = res[key]["live"]
        for name, k in (("ExtUp", "up"), ("ExtDn", "dn"), ("BuildW", "w"), ("THi", "thi"), ("TLo", "tlo")):
            pine.append(f"var t{tag}{name} = array.from({', '.join(str(x) for x in lv[k])})")
            mql.append(f"double T_{key}_{name.upper()}[{len(lv[k])}] = {{{', '.join(str(x) for x in lv[k])}}};")
    rewrite_block(ROOT / "pine/DayRangePredictor.pine", START, END, "\n".join(pine) + "\n")
    rewrite_block(ROOT / "experts/DayRangePredictor.mq5", START, END, "\n".join(mql) + "\n")


def fmt3(t):
    return "/".join(f"{x:.3f}" for x in t)


def write_model(res, stamp):
    """Everything the AI service needs, so it doesn't have to retrain at startup."""
    out = {"trained": stamp, "symbols": {}}
    for key, r in res.items():
        out["symbols"][key] = {"yahoo": MARKETS[key]["yahoo"], "atr_days": r["lines"]["atr"], "live": r["live"],
                               "short": r["short"], "cost": MARKETS[key]["cost"]}
    (ROOT / "ai").mkdir(exist_ok=True)
    (ROOT / "ai/model.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def pct(x):
    return f"{100 * x:.1f}%"


def report(res, stamp):
    L = [f"# Day Range Predictor training report", "",
         f"Trained {stamp} by `tools/train_drp.py`. Data: Yahoo Finance (daily 10y, hourly 730d), "
         f"cross-checked against Google Finance quotes. Every number under \"holdout\" comes from recent data "
         f"the settings were not tuned on.", ""]
    for key, r in res.items():
        mk, ln, sg, ck = MARKETS[key], r["lines"], r["sig"], r["check"]
        zp, ms, wk, ob, rr = sg["best"]
        L += [f"## {mk['name']} ({mk['yahoo']})", ""]
        L += [f"Data through {r['last_day']}. Google Finance cross-check: {ck}", ""]
        L += ["### Predicted high/low lines", "",
              f"Chosen: lookback **{ln['lookback']} days**, ATR **{ln['atr']}**, max line **P{ln['outer']}** "
              f"(the narrowest setting that held ≥{int(TARGET_HELD*100)}% per side on the 3 years before the holdout).", "",
              "| | High held | Low held | Both held | Width (× ATR) |", "| --- | --- | --- | --- | --- |",
              f"| Trained, holdout last {ln['hold_days']} days | {pct(ln['hold_hi'])} | {pct(ln['hold_lo'])} | {pct(ln['hold_both'])} | {ln['hold_width']:.2f} |",
              f"| Old default (250d, ATR 14, P95), same days | {pct(ln['base_hi'])} | {pct(ln['base_lo'])} | {pct(ln['base_both'])} | {ln['base_width']:.2f} |", ""]
        ev, a = r["lev"], r["lev"]["atr"]
        pts = lambda x: f"{x:.2f} ATR (≈{x * a:,.0f})" if key == "NQ" else f"{x:.2f} ATR (≈${x * a:,.1f})"
        L += ["### Live high / low / build-up lines (update every bar)", "",
              f"Green high = high so far + expected extra move, red low = low so far − expected extra move, both looked up "
              f"by hour of the day and where price sits in the range. Yellow build-up = blend of the predicted midpoint and "
              f"the price where the most trading has happened so far. Holdout: {ev['days']} unseen days from {ev['from']}. "
              f"Average distance between the line and the day's real high / low / build-up:", "",
              "| When | High miss | Low miss | Build-up miss |", "| --- | --- | --- | --- |",
              f"| Old fixed lines at the open | {pts(ev['fixed'][0])} | {pts(ev['fixed'][1])} | n/a |",
              f"| Live, at the day open | {pts(ev['open'][0])} | {pts(ev['open'][1])} | {pts(ev['open'][2])} |",
              f"| Live, at session start | {pts(ev['session'][0])} | {pts(ev['session'][1])} | {pts(ev['session'][2])} |",
              f"| Live, average over the day | {pts(ev['all'][0])} | {pts(ev['all'][1])} | {pts(ev['all'][2])} |", "",
              f"Share of bars where both live lines were within 0.1 ATR of the real high and low: {pct(ev['near'])}.", ""]
        sm = r["short"]
        L += ["### Quick-trade AI TP/SL (5-minute bars, 1-hour max hold, after costs)", "",
              f"Price-only direction model (news is added live by the AI service and can't be backtested). "
              f"{sm['bars']:,} bars, holdout from {sm['hold_from']}. Direction accuracy: training {pct(sm['acc_train'])}, "
              f"holdout {pct(sm['acc_hold'])}. Chosen: TP {sm['tpm']}× / SL {sm['slm']}× the 5-minute ATR, "
              f"setup when confidence ≥ {sm['thr']:.0%}.", "",
              "| | Trades | Win rate | Avg result (× 5m ATR) |", "| --- | --- | --- | --- |",
              f"| Training | {sm['train']['n']} | {pct(sm['train']['win'])} | {sm['train']['ev']:+.3f} |",
              f"| Holdout (unseen) | {sm['hold']['n']} | {pct(sm['hold']['win'])} | {sm['hold']['ev']:+.3f} |", "",
              "**Verdict:** " + ("positive on unseen data. Small sample; paper trade first." if sm["edge"] else
                                 "no proven edge after costs. The TP/SL lines show sensible placement and the odds, "
                                 "not a reason to trade."), ""]
        L += ["### Signals (hourly bars, after estimated spread/commission)", "",
              f"Tested {sg['tested']} filter combinations; {sg['eligible']} had at least {MIN_TRAIN_TRADES} trades in training "
              f"({sg['train_from']} to {sg['hold_from']}). Holdout: {sg['hold_from']} to {sg['hold_to']}.", "",
              f"Best in training: zone P{zp}, {ms}/5 filters, wick ≥{int(wk*100)}%, RSI {ob}/{100-ob}, target {rr}R.", "",
              "| | Trades | Win rate | Net R |", "| --- | --- | --- | --- |"]
        if sg["train"]:
            L.append(f"| Best combination, training | {sg['train']['n']} | {pct(sg['train']['win'])} | {sg['train']['netR']:+.1f} |")
        L.append(f"| Best combination, holdout (unseen) | {sg['hold']['n']} | {pct(sg['hold']['win'])} | {sg['hold']['netR']:+.1f} |")
        d = sg["default_hold"]
        L.append(f"| Strict default (P85, 5/5, 1R), holdout | {d['n']} | {pct(d['win'])} | {d['netR']:+.1f} |")
        L += ["", "**Verdict:** " + ("the best combination stayed profitable on unseen data, so it is now the trained preset. "
                                     "Still a small sample; paper trade first."
                                     if sg["edge"] else
                                     "the best training combination did not hold up on unseen data (overfitting), so the presets keep "
                                     "the strict defaults. Treat the signals as a warning, not as trade entries."), ""]
    L += ["No indicator is right 100% of the time. Past results are not a promise. Not financial advice."]
    (ROOT / "reports").mkdir(exist_ok=True)
    (ROOT / "reports/training_report.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def cross_check(key, daily, h1):
    g = google_quote(MARKETS[key]["google"])
    if "error" in g or "Settlement price" not in g:
        return "Google Finance unavailable, skipped."
    settle = g["Settlement price"]
    closes = daily.c.iloc[-3:].tolist() + [h1.c.iloc[-1]]
    diff = min(abs(c - settle) / settle for c in closes)
    flag = "OK" if diff < 0.01 else "WARNING: Yahoo and Google disagree by more than 1%"
    return f"Google settlement {settle:,.2f} vs Yahoo recent closes {', '.join(f'{c:,.2f}' for c in closes)} → {flag}."


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-write", action="store_true", help="print results only, don't touch any files")
    args = ap.parse_args()
    stamp = dt.date.today().isoformat()
    res = {}
    for key, mk in MARKETS.items():
        print(f"\n== {mk['name']}: downloading {mk['yahoo']} from Yahoo Finance")
        d10 = yahoo(mk["yahoo"], "10y", "1d")
        h1 = yahoo(mk["yahoo"], "730d", "1h")
        # Yahoo's daily futures bars use the CME trade date, the same day key the hourly bars get below
        daily = d10[["o", "h", "l", "c"]].copy()
        daily.index = daily.index.date
        print(f"   {len(daily)} daily bars to {daily.index[-1]}, {len(h1)} hourly bars to {h1.index[-1]:%Y-%m-%d %H:%M} NY")
        check = cross_check(key, daily, h1)
        print("   " + check)
        lines = train_lines(daily)
        print(f"   lines: lookback {lines['lookback']}d, ATR {lines['atr']}, P{lines['outer']} -> holdout high {pct(lines['hold_hi'])}, "
              f"low {pct(lines['hold_lo'])}, both {pct(lines['hold_both'])}, width {lines['hold_width']:.2f}x ATR "
              f"(old default: {pct(lines['base_hi'])}/{pct(lines['base_lo'])}, width {lines['base_width']:.2f})")
        live, lev = train_live(h1, daily, lines, mk)
        print(f"   live lines (holdout {lev['days']} days, miss in ATRs high/low/build-up): at open {fmt3(lev['open'])}, "
              f"session start {fmt3(lev['session'])}, all bars {fmt3(lev['all'])}; old fixed lines {lev['fixed'][0]:.3f}/{lev['fixed'][1]:.3f}")
        short = train_short(daily, lines, mk)
        print(f"   quick-trade AI (price only): direction accuracy holdout {pct(short['acc_hold'])}, TP {short['tpm']}x / SL {short['slm']}x "
              f"5m ATR, threshold {short['thr']}; holdout {short['hold']['n']} trades, win {pct(short['hold']['win'])}, "
              f"EV {short['hold']['ev']:+.3f} ATR -> edge={short['edge']}")
        sig = train_signals(h1, daily, lines, mk)
        print(f"   signals: best {sig['best']} train {sig['train']} holdout {sig['hold']} edge={sig['edge']} -> preset {sig['params']}")
        res[key] = {"lines": lines, "sig": sig, "check": check, "last_day": str(daily.index[-1]), "live": live, "lev": lev, "short": short}
    if args.no_write:
        return
    (ROOT / "presets").mkdir(exist_ok=True)
    for key, r in res.items():
        write_set(ROOT / "presets" / MARKETS[key]["set"], r["lines"], r["sig"])
    update_sources(res, stamp)
    write_model(res, stamp)
    report(res, stamp)
    print("\nWrote presets/*.set, reports/training_report.md and refreshed the TRAINED PRESETS blocks.")


if __name__ == "__main__":
    sys.exit(main())
