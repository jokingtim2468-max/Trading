"""Simulate "Liquidity DOL Scoring Engine" (Day Trading mode) on NQ (US100) 5-minute bars.

Port:
  * Levels = 5m pivots 3/3 (max 15, oldest dropped), mitigated on first touch.
    Density = number of the 20 bars before the pivot whose high/low is within 0.1 ATR.
  * Score of each unmitigated level within 3 ATR = weighted (30/25/25/20) proximity,
    freshness (half-life 50 bars), confluence with PDH/PDL/daily open/EQ (+20 if the 1H
    bias agrees) and density. Best score = DOL; PoT = min(95, score).
  * request.security(lookahead_off) on historical bars only returns HTF values once the
    HTF bar has closed: PDH/PDL (high[1]/low[1] of 1D) are two sessions old for most of
    the day and the "daily open" is the previous session's open; the 1H bias (pivot 2/2
    break state) is the last closed hour's.
  * New DOL = best level's birth bar or price changes (no index bug in this script).
Trading (the script has no entries): on a NEW DOL at an RTH 5m close, trade toward it.
Target = level price, stop = same distance beyond entry (1:1), skip if closer than
0.5 ATR. $150 risk on MNQ, $1.24 RT commission, 1 tick slippage, target must trade through.
  "script rules": hold to target/stop, flat 15:55.  "Lucid rules": + 60-min cap,
  FOMC/ISM blackout, 2-loss / -$400 day lock.  Variants: every new DOL, or PoT >= 60% only.
Also measures how often price really touches the DOL within 60 minutes, by PoT bucket.
Usage: python liqdol_sim.py <raw_parquet_dir> <out_dir>
"""
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

import bt

RAW, OUT = sys.argv[1], sys.argv[2]
START, END = "2015-01-01", "2025-05-30"
TZ = "America/New_York"
LB, MAXL, MAXATR, HALF = 3, 15, 3.0, 50.0
W = dict(prox=30.0, fresh=25.0, conf=25.0, dens=20.0)
ACCOUNTS = {"script rules": (dict(bt.RULES, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
            "Lucid rules": (bt.RULES, True)}


def agg(df, rule):
    return df.resample(rule, label="left", closed="left").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last"}).dropna(subset=["o"])


def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    m1 = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    m1 = m1[~m1.index.duplicated()].sort_index()
    m1.index = m1.index.tz_localize("UTC").tz_convert(TZ)
    m1 = m1[["open", "high", "low", "close"]].loc[START:END + " 23:59"]
    m1.columns = ["o", "h", "l", "c"]
    b5 = agg(m1, "5min")
    ts = b5.index
    o, h, l, c = (b5[k].values for k in "ohlc")
    n = len(c)
    etmin = (ts.hour * 60 + ts.minute).values
    dates = ts.tz_localize(None).normalize()

    # daily (CME session) with lookahead_off semantics
    sess = (ts.tz_localize(None) + pd.Timedelta(hours=6)).floor("D")
    codes, _ = pd.factorize(sess)
    dO = b5.o.groupby(codes).first().values
    dH = b5.h.groupby(codes).max().values
    dL = b5.l.groupby(codes).min().values
    is_last = np.r_[codes[1:] != codes[:-1], True]
    d = np.where(is_last, codes, codes - 1)
    pdh = np.where(d >= 1, dH[np.maximum(d - 1, 0)], np.nan)
    pdl = np.where(d >= 1, dL[np.maximum(d - 1, 0)], np.nan)
    dOpen = np.where(d >= 0, dO[np.maximum(d, 0)], np.nan)
    eq = (pdh + pdl) / 2

    # 1H bias (pivot 2/2 break state), last closed hour
    h1 = agg(m1, "60min")
    hh, hl, hc = h1.h.values, h1.l.values, h1.c.values
    bias = np.zeros(len(h1))
    lh = ll = np.nan
    b = 0
    for k in range(len(h1)):
        j = k - 2
        if j >= 2 and hh[j] > hh[j - 2:j].max() and hh[j] >= hh[j + 1:k + 1].max():
            lh = hh[j]
        if j >= 2 and hl[j] < hl[j - 2:j].min() and hl[j] <= hl[j + 1:k + 1].min():
            ll = hl[j]
        if lh == lh and hc[k] > lh:
            b = 1
        if ll == ll and hc[k] < ll:
            b = -1
        bias[k] = b
    ends = (h1.index + pd.Timedelta(hours=1)).values
    hi_idx = np.searchsorted(ends, (ts + pd.Timedelta(minutes=5)).values, side="right") - 1
    biasH = np.where(hi_idx >= 0, bias[np.maximum(hi_idx, 0)], 0)

    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values.copy()
    atr[:14] = np.nan
    hs, ls = pd.Series(h), pd.Series(l)
    ch, cl = hs.shift(LB).values, ls.shift(LB).values
    ph = np.where((ch > hs.shift(LB + 1).rolling(LB).max().values) & (ch >= hs.rolling(LB).max().values), ch, np.nan)
    pl = np.where((cl < ls.shift(LB + 1).rolling(LB).min().values) & (cl <= ls.rolling(LB).min().values), cl, np.nan)

    levels = []  # [price, birth, type, mitigated, dens]
    newDol = np.zeros(n, bool)
    dolP = np.full(n, np.nan)
    pot = np.full(n, np.nan)
    dol_typ = np.zeros(n, int)
    dolBar, dolPrice = -1, np.nan
    segs = []  # [start(birth), price, end_bar or None]

    def dens(i, price, is_high):
        if i < 20:
            return 0
        tol = atr[i] * 0.1 if atr[i] == atr[i] else 0.0
        src = h if is_high else l
        seg = src[i - (LB + 20):i - LB]
        return int((np.abs(seg - price) <= tol).sum())

    sw = sum(W.values())
    for i in range(n):
        a = atr[i]
        aok = a == a and a > 0
        if ph[i] == ph[i]:
            levels.append([ph[i], i - LB, 1, False, dens(i, ph[i], True)])
            if len(levels) > MAXL:
                levels.pop(0)
        if pl[i] == pl[i]:
            levels.append([pl[i], i - LB, -1, False, dens(i, pl[i], False)])
            if len(levels) > MAXL:
                levels.pop(0)
        for lv in levels:
            if not lv[3] and ((h[i] >= lv[0]) if lv[2] == 1 else (l[i] <= lv[0])):
                lv[3] = True
        best, bestS = -1, 0.0
        for k, lv in enumerate(levels):
            if lv[3]:
                continue
            price = lv[0]
            dATR = abs(c[i] - price) / a if aok else 0.0
            prox = 0.0 if dATR > MAXATR else 100.0 * (1.0 - dATR / MAXATR)
            fresh = 100.0 * 0.5 ** ((i - lv[1]) / HALF)
            if aok:
                ds = [abs(price - x) / a for x in (pdh[i], pdl[i], dOpen[i], eq[i]) if x == x]
                mcd = min(ds) if len(ds) == 4 else 99.0
            else:
                mcd = 99.0
            cb = 0.0 if mcd > 0.5 else 100.0 * (1.0 - mcd / 0.5)
            al = (lv[2] == 1 and biasH[i] == 1) or (lv[2] == -1 and biasH[i] == -1)
            conf = min(100.0, cb + 20.0) if al else cb
            dsc = min(100.0, lv[4] * 15.0)
            total = (prox * W["prox"] + fresh * W["fresh"] + conf * W["conf"] + dsc * W["dens"]) / sw
            if dATR <= MAXATR and total > bestS:
                bestS, best = total, k
        if best >= 0:
            bp, bb = levels[best][0], levels[best][1]
            if bb != dolBar or bp != dolPrice:
                newDol[i] = True
                if segs:
                    segs[-1][2] = i - 1
                segs.append([bb, bp, None, i])
                dolBar, dolPrice = bb, bp
            dolP[i], pot[i], dol_typ[i] = bp, min(95.0, bestS), levels[best][2]

    # ---- PoT calibration: does price touch the DOL within 60 minutes (same day)?
    cal_rows = []
    for i in np.where(newDol & (etmin >= 570) & (etmin < 900))[0]:
        j1 = min(n, i + 13)
        same = dates[i + 1:j1] == dates[i]
        hh_, ll_ = h[i + 1:j1][same], l[i + 1:j1][same]
        hit = (hh_ >= dolP[i]).any() if dol_typ[i] == 1 else (ll_ <= dolP[i]).any()
        cal_rows.append((pot[i], bool(hit)))
    cdf = pd.DataFrame(cal_rows, columns=["pot", "hit"])
    cdf["bucket"] = pd.cut(cdf.pot, [0, 20, 40, 60, 80, 95.01], right=False,
                           labels=["0-20%", "20-40%", "40-60%", "60-80%", "80-95%"])
    calib = cdf.groupby("bucket", observed=False).agg(events=("hit", "size"), touch_rate=("hit", "mean"),
                                                      avg_pot=("pot", "mean"))
    calib["touch_rate"] = (calib.touch_rate * 100).round(1)
    calib["avg_pot"] = calib.avg_pot.round(1)
    print("PoT calibration (touch within 60 min):\n", calib.to_string())

    # ---- trades
    t1 = m1.index.hour * 60 + m1.index.minute
    rth = m1[(t1 >= 570) & (t1 < 960) & (m1.index.dayofweek < 5)]
    recs = {}
    for dd, g in rth.groupby(rth.index.date):
        if len(g) >= 300:
            recs[dd] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32), m1=g[["o", "h", "l", "c"]].values)
    calz = sorted(recs)
    news = bt.news_windows(calz)
    variants = {"all DOLs": 0.0, "PoT>=60%": 60.0}
    sigs = {v: {} for v in variants}
    for i in np.where(newDol & (etmin >= 570) & (etmin < 950))[0]:
        a = atr[i]
        dist = abs(dolP[i] - c[i])
        if not (a > 0) or dist < 0.5 * a:
            continue
        side = 1 if dolP[i] > c[i] else -1
        s = dict(t=int(etmin[i] + 5), side=side, px=float(c[i]), stop=float(c[i] - side * dist), tp=float(dolP[i]))
        for v, mn in variants.items():
            if pot[i] >= mn:
                sigs[v].setdefault(dates[i].date(), []).append(s)
    summary = dict(period=[str(calz[0]), str(calz[-1])], days=len(calz),
                   calibration=calib.reset_index().astype({"bucket": str}).to_dict("records"))
    curves = {}
    for v in variants:
        for acct, (rules, use_news) in ACCOUNTS.items():
            trades = []
            for dd in calz:
                got = bt.run_day_mgmt(recs[dd], sigs[v].get(dd, []), "NQ", news.get(dd, []) if use_news else [], 100, rules)
                for tr_ in got:
                    tr_["date"] = dd
                trades += got
            daily = pd.Series({x: 0.0 for x in calz})
            for t_ in trades:
                daily[t_["date"]] += t_["pnl"]
            eqc = daily.cumsum()
            ddc = eqc - eqc.cummax()
            key = f"{v} {acct}"
            years = {str(y): bt.stats([t_ for t_ in trades if t_["date"].year == y], sum(x.year == y for x in calz))
                     for y in sorted({x.year for x in calz})}
            summary[key] = dict(overall=bt.stats(trades, len(calz)), years=years, worst_day=float(daily.min()),
                                dd_date=str(ddc.idxmin()),
                                exits=pd.Series([t_["why"] for t_ in trades], dtype=object).value_counts().to_dict())
            pd.DataFrame(trades).to_csv(os.path.join(OUT, f"liqdol_trades_{v.replace('>=', 'ge').replace('%', '')}_"
                                                          f"{acct.split()[0]}.csv"), index=False)
            curves[key] = (trades, eqc, ddc)
            ov = summary[key]["overall"]
            print(f"{key:24s} trades {ov['trades']:5d} win {ov['win']:5.1f}% PF {ov['pf']:.2f} net ${ov['net']:10,.0f} "
                  f"maxDD ${ov['maxdd']:9,.0f} $/wk {ov['per_week']:7.1f} micros {ov['micros']:.1f} "
                  f"exits {summary[key]['exits']}", flush=True)
    json.dump(summary, open(os.path.join(OUT, "liqdol_summary.json"), "w"), indent=1, default=str)

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    BULL, BEAR, DOLC = "#26a69a", "#ef5350", "#00e5ff"
    COLS = {"all DOLs script rules": "#2962FF", "all DOLs Lucid rules": "#26C6DA",
            "PoT>=60% script rules": "#E91E63", "PoT>=60% Lucid rules": "#FFB74D"}
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10, "legend.facecolor": BG, "legend.edgecolor": GRID, "text.parse_math": False})
    fig = plt.figure(figsize=(13, 8.5))
    gs = fig.add_gridspec(2, 2, height_ratios=[2.2, 1], width_ratios=[2.4, 1])
    ax1, ax2, ax3 = fig.add_subplot(gs[0, 0]), fig.add_subplot(gs[1, 0]), fig.add_subplot(gs[:, 1])
    for key, (trades, eqc, ddc) in curves.items():
        s_ = summary[key]["overall"]
        x = pd.to_datetime(eqc.index)
        ax1.plot(x, eqc.values, color=COLS[key], lw=1.6,
                 label=f"{key}: net ${s_['net']:,.0f}, PF {s_['pf']:.2f}, {s_['trades']} tr")
        ax2.plot(x, ddc.values, color=COLS[key], lw=1.1, label=f"max DD ${s_['maxdd']:,.0f}")
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title("Liquidity DOL Scoring Engine on NQ / US100 5m, trade to the DOL (1:1), $150 risk", loc="left",
                  fontsize=10)
    ax1.set_ylabel("Cumulative P&L ($)")
    ax1.legend(loc="lower left", fontsize=8)
    ax1.grid(True, lw=0.6)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.set_ylabel("Drawdown ($)")
    ax2.legend(loc="lower left", fontsize=8)
    ax2.grid(True, lw=0.6)
    xb = np.arange(len(calib))
    ax3.bar(xb - 0.2, calib.avg_pot.fillna(0).values, width=0.38, color=DOLC, label="PoT the script shows")
    ax3.bar(xb + 0.2, calib.touch_rate.fillna(0).values, width=0.38, color="#FFB74D", label="actual touch within 60 min")
    for k, (ev, tr_, ap) in enumerate(zip(calib.events.values, calib.touch_rate.values, calib.avg_pot.values)):
        if ev:
            ax3.annotate(f"{tr_:.0f}%", (k + 0.2, tr_), xytext=(0, 3), textcoords="offset points", ha="center", fontsize=8)
            ax3.annotate(f"n={ev}", (k, 0), xytext=(0, -26), textcoords="offset points", ha="center", fontsize=7,
                         color=MUTED)
    ax3.set_xticks(xb, calib.index.astype(str), fontsize=8)
    ax3.set_ylim(0, 100)
    ax3.set_ylabel("%")
    ax3.set_title("Is the PoT % honest?", loc="left", fontsize=10)
    ax3.legend(loc="upper left", fontsize=8)
    ax3.grid(True, axis="y", lw=0.5)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "liqdol_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample day: last day with >= 3 trades (all DOLs, Lucid), 09:00-16:00
    trades = curves["all DOLs Lucid rules"][0]
    cnt = pd.Series([t_["date"] for t_ in trades]).value_counts()
    day = max(x for x in cnt.index if cnt[x] >= 3)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 540) & (etmin < 960))[0]
    i0, i1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8))
    # iFVG boxes (visual only): replay the FVG state machine from 2 days before
    fv = []
    for i in range(max(2, i0 - 600), i1 + 1):
        if l[i] > h[i - 2]:
            fv.append(dict(top=l[i], bot=h[i - 2], typ=1, st=0, cnt=0, start=i - 2, end=i, gone=False))
        if h[i] < l[i - 2]:
            fv.append(dict(top=l[i - 2], bot=h[i], typ=2, st=0, cnt=0, start=i - 2, end=i, gone=False))
        for z in fv:
            if z["gone"]:
                continue
            if z["st"] == 0:
                if (c[i] < z["bot"]) if z["typ"] == 1 else (c[i] > z["top"]):
                    z["st"] = 1
                z["end"] = i
            else:
                if z["bot"] <= c[i] <= z["top"]:
                    z["cnt"] += 1
                if z["cnt"] >= 3:
                    z["gone"] = True
                else:
                    z["end"] = i
    for z in fv:
        if z["gone"] or z["end"] < i0:
            continue
        col = (BULL if z["typ"] == 1 else BEAR) if z["st"] == 0 else (BEAR if z["typ"] == 1 else BULL)
        ax.add_patch(Rectangle((max(z["start"], i0) - 0.5, z["bot"]), z["end"] - max(z["start"], i0) + 1,
                               z["top"] - z["bot"], color=col, alpha=0.15 if z["st"] == 0 else 0.25, lw=0))
    for st_b, p, end_b, made in segs:
        if made > i1 or (end_b is not None and end_b < i0):
            continue
        buf = atr[made] * 0.1
        x0 = max(st_b, i0)
        if end_b is not None and end_b <= i1:
            ax.add_patch(Rectangle((x0, p - buf), end_b - x0, 2 * buf, facecolor=(0.47, 0.48, 0.53, 0.10),
                                   edgecolor=(0.47, 0.48, 0.53, 0.4), lw=0.8))
        else:
            ax.add_patch(Rectangle((x0, p - buf), i1 + 6 - x0, 2 * buf, facecolor=(0, 0.9, 1, 0.15), edgecolor=DOLC, lw=1))
            ax.annotate(f"DOL  PoT {pot[i1]:.1f}%", (i1 + 1, p), xytext=(4, 0), textcoords="offset points", fontsize=8,
                        color=DOLC, va="center")
    for i in range(i0, i1 + 1):
        col = BULL if c[i] >= o[i] else BEAR
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
    for t_ in [t_ for t_ in trades if t_["date"] == day]:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["tp"])), max(xx - xe, 1), abs(t_["tp"] - t_["entry"]),
                               color="#4CAF50", alpha=0.25, lw=0))
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([xe - 1], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=110,
                   color=BULL if t_["side"] > 0 else BEAR, zorder=5)
        ax.annotate(f"{'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (xe, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    lo_, hi2 = l[i0:i1 + 1].min(), h[i0:i1 + 1].max()
    pad = (hi2 - lo_) * 0.1
    ax.set_ylim(lo_ - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i1 + 14)
    ticks = [k for k in range(i0, i1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    bt_ = {1: "Bullish", -1: "Bearish"}.get(int(biasH[i1]), "Neutral")
    ax.text(0.99, 0.98, f"HTF 60: {bt_}", transform=ax.transAxes, ha="right", va="top",
            bbox=dict(facecolor="#2a2e39", edgecolor=GRID))
    dp = sum(t_["pnl"] for t_ in trades if t_["date"] == day)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  DOL zone cyan, ghost trail gray, FVG / iFVG boxes, trades to the DOL "
                 f"(Lucid rules)  |  day P&L {'+' if dp >= 0 else '-'}${abs(dp):.0f}", loc="left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "liqdol_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
