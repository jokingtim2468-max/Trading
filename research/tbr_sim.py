"""Simulate the TradingView script "TBR Sessions: Sweeps, Fib Auto-Adjust & 3-Drive" on
NQ (US100) 5-minute bars and trade its lines in the New York window.

Port notes:
  * Bar-by-bar port of the TBR state machine for Asia (17-20 form / 20-24 trade),
    London (02-05 / 05-08) and New York (07:00-09:30 / 09:30-12:00), ET, with the
    script's break / wait / reset / body-break / extension / double-break logic and the
    default "TBR Bound" Fibonacci basis (anchor = TBR high/low, auto-adjusting to the
    newest extreme). 3-drive pivots (3/3) are ported for the chart only.
The script has no entries, so two literal readings are traded (NY window only):
  A "0.618 line":  after a NY body break (close beyond the 07:00-09:30 range) a limit
     order rests on the labelled 0.618 Fib line (re-placed each 5m close as the Fib
     auto-adjusts, only while price is beyond it). Stop = TBR bound -/+ 1 tick
     (Fib 0), target = break extreme (Fib 1.0). One trade per direction per day.
  B "sweep": a 5m bar wicks beyond the NY TBR high/low and closes back inside before
     any body break -> market entry against the sweep. Stop = sweep extreme +/- 1 tick,
     target = opposite TBR bound, taken only if reward >= risk. One per side per day.
Lucid rules from bt.py: $150 risk on MNQ, $1.24 RT commission, 1 tick slippage on market
fills, limits fill only when traded through, 60 min max hold, flat 15:55, 2 losses /
-$400 day lock, FOMC/ISM blackout.
Usage: python tbr_sim.py <raw_parquet_dir> <out_dir>
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
TICK = 0.25
SESS = {"Asia": ((1020, 1200), (1200, 1440)), "London": ((120, 300), (300, 480)),
        "New York": ((420, 570), (570, 720))}
KEYS = ("hi", "lo", "formed", "bU", "bD", "bodyU", "bodyD", "extH", "extL", "bbU", "bbD", "dU", "dD", "e2H", "e2L",
        "trading", "formStart")


def load():
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    df = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    df = df[~df.index.duplicated()].sort_index()
    df.index = df.index.tz_localize("UTC").tz_convert(TZ)
    df = df[["open", "high", "low", "close", "volume"]]
    df.columns = ["o", "h", "l", "c", "v"]
    return df.loc[START:END + " 23:59"]


def tbr(h, l, c, etmin, form, trade):
    """Port of TBR.update(); returns per-bar state AFTER each bar."""
    n = len(h)
    inF = (etmin >= form[0]) & (etmin < form[1])
    inT = (etmin >= trade[0]) & (etmin < trade[1])
    out = {k: np.full(n, np.nan) for k in KEYS}
    fH = fL = hi = lo = extH = extL = e2H = e2L = np.nan
    formed = bU = bD = bodyU = bodyD = wU = wD = dU = dD = False
    bbU = bbD = -1
    fstart = -1
    for i in range(n):
        formEnd = (not inF[i]) and i > 0 and inF[i - 1]
        tStart = inT[i] and not (i > 0 and inT[i - 1])
        if inF[i]:
            if fH != fH:
                fstart = i
            fH = h[i] if fH != fH else max(fH, h[i])
            fL = l[i] if fL != fL else min(fL, l[i])
        if formEnd:
            hi, lo, formed = fH, fL, True
            fH = fL = np.nan
            bU = bD = bodyU = bodyD = wU = wD = dU = dD = False
            extH = extL = e2H = e2L = np.nan
            bbU = bbD = -1
        if inT[i] and tStart:
            if wU:
                bU, wU = False, False
            if wD:
                bD, wD = False, False
        tr = bool(inT[i])
        if formed and hi == hi and lo == lo:
            if not bU and h[i] > hi:
                bU, extH, bbU = True, h[i], i
                if not tr:
                    wU = True
            if bU and h[i] > extH:
                extH = h[i]
            if not bodyU and tr and c[i] > hi:
                bodyU = True
            if not bD and l[i] < lo:
                bD, extL, bbD = True, l[i], i
                if not tr:
                    wD = True
            if bD and l[i] < extL:
                extL = l[i]
            if not bodyD and tr and c[i] < lo:
                bodyD = True
            rng = hi - lo
            if bU and tr and not dU and rng > 0 and h[i] > hi + rng:
                dU, e2H = True, h[i]
            if dU and h[i] > e2H:
                e2H = h[i]
            if bD and tr and not dD and rng > 0 and l[i] < lo - rng:
                dD, e2L = True, l[i]
            if dD and l[i] < e2L:
                e2L = l[i]
        for k, v in zip(KEYS, (hi, lo, formed, bU, bD, bodyU, bodyD, extH, extL, bbU, bbD, dU, dD, e2H, e2L, tr,
                               fstart)):
            out[k][i] = v
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    m1 = load()
    b5 = m1.resample("5min", label="left", closed="left").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"}).dropna(subset=["o"])
    ts = b5.index
    o, h, l, c = (b5[k].values for k in "ohlc")
    etmin = (ts.hour * 60 + ts.minute).values
    dates = ts.tz_localize(None).normalize()
    st = {name: tbr(h, l, c, etmin, f, t) for name, (f, t) in SESS.items()}
    ny = st["New York"]

    # ---- signals (NY trading window bars 09:30-11:55, acted on at the bar close)
    sigA, sigB = {}, {}
    for i in np.where((etmin >= 570) & (etmin < 720))[0]:
        if not ny["formed"][i]:
            continue
        d = dates[i].date()
        t = int(etmin[i] + 5)
        hi, lo = ny["hi"][i], ny["lo"][i]
        if ny["bodyU"][i] and ny["extH"][i] == ny["extH"][i]:
            lvl = hi + (ny["extH"][i] - hi) * 0.618
            if c[i] > lvl:
                sigA.setdefault(d, []).append(dict(t=t, side=1, px=float(lvl), stop=float(hi - TICK),
                                                   tp=float(ny["extH"][i]), kind="lmt", expiry=5, group="A+"))
        if ny["bodyD"][i] and ny["extL"][i] == ny["extL"][i]:
            lvl = lo + (ny["extL"][i] - lo) * 0.618
            if c[i] < lvl:
                sigA.setdefault(d, []).append(dict(t=t, side=-1, px=float(lvl), stop=float(lo + TICK),
                                                   tp=float(ny["extL"][i]), kind="lmt", expiry=5, group="A-"))
        if not ny["bodyU"][i] and h[i] > hi and c[i] < hi:
            stp = ny["extH"][i] + TICK
            if c[i] - lo >= stp - c[i]:
                sigB.setdefault(d, []).append(dict(t=t, side=-1, px=float(c[i]), stop=float(stp), tp=float(lo),
                                                   kind="mkt", group="B-"))
        if not ny["bodyD"][i] and l[i] < lo and c[i] > lo:
            stp = ny["extL"][i] - TICK
            if hi - c[i] >= c[i] - stp:
                sigB.setdefault(d, []).append(dict(t=t, side=1, px=float(c[i]), stop=float(stp), tp=float(hi),
                                                   kind="mkt", group="B+"))

    t1 = m1.index.hour * 60 + m1.index.minute
    rth = m1[(t1 >= 570) & (t1 < 960) & (m1.index.dayofweek < 5)]
    recs = {}
    for dday, g in rth.groupby(rth.index.date):
        if len(g) >= 300:
            recs[dday] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32),
                              m1=g[["o", "h", "l", "c"]].values)
    cal = sorted(recs)
    news = bt.news_windows(cal)
    models = {"A_fib618": sigA, "B_sweep": sigB}
    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal))
    curves = {}
    for name, sigs in models.items():
        trades = []
        for dday in cal:
            for tr_ in bt.run_day(recs[dday], sigs.get(dday, []), "NQ", news.get(dday, []), 4):
                tr_["date"] = dday
                trades.append(tr_)
        daily = pd.Series({dd: 0.0 for dd in cal})
        for t_ in trades:
            daily[t_["date"]] += t_["pnl"]
        eqc = daily.cumsum()
        ddc = eqc - eqc.cummax()
        years = {}
        for y in sorted({dd.year for dd in cal}):
            yd = [dd for dd in cal if dd.year == y]
            years[str(y)] = bt.stats([t_ for t_ in trades if t_["date"].year == y], len(yd))
        summary[name] = dict(overall=bt.stats(trades, len(cal)), years=years,
                             exits=pd.Series([t_["why"] for t_ in trades]).value_counts().to_dict(),
                             worst_day=float(daily.min()), dd_date=str(ddc.idxmin()),
                             signal_days=len(sigs))
        pd.DataFrame(trades).to_csv(os.path.join(OUT, f"tbr_trades_{name}.csv"), index=False)
        curves[name] = (trades, eqc, ddc)
    json.dump(summary, open(os.path.join(OUT, "tbr_summary.json"), "w"), indent=1, default=str)
    print(json.dumps({k: (v if not isinstance(v, dict) or "overall" not in v else
                          dict(overall=v["overall"], exits=v["exits"], worst_day=v["worst_day"], dd_date=v["dd_date"]))
                      for k, v in summary.items()}, indent=1, default=str))

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    UP, DN = "#089981", "#F23645"
    BULL, BEAR = "#2DD4BF", "#FB923C"
    SCOL = {"Asia": "#60A5FA", "London": "#C084FC", "New York": "#FACC15"}
    LINE = {"A_fib618": ("#2962FF", "A: 0.618 Fib line"), "B_sweep": ("#E91E63", "B: sweep reversal")}
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10, "legend.facecolor": BG, "legend.edgecolor": GRID})

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    for name, (trades, eqc, ddc) in curves.items():
        col, lab = LINE[name]
        s_ = summary[name]["overall"]
        x = pd.to_datetime(eqc.index)
        ax1.plot(x, eqc.values, color=col, lw=2,
                 label=f"{lab}: net ${s_['net']:,.0f}, PF {s_['pf']:.2f}, {s_['trades']} trades")
        ax1.annotate(lab.split(":")[0], (x[-1], eqc.values[-1]), xytext=(6, 0), textcoords="offset points",
                     color=TXT, va="center", fontsize=9)
        ax2.plot(x, ddc.values, color=col, lw=1.3, label=f"{lab}: max DD ${s_['maxdd']:,.0f}")
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"TBR Sessions traded in the NY window, NQ / US100 5m  |  {cal[0]} to {cal[-1]}", loc="left")
    ax1.set_ylabel("Cumulative P&L ($, MNQ, after costs)")
    ax1.legend(loc="lower left", fontsize=9)
    ax1.grid(True, lw=0.6)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.text(pd.to_datetime(cal[0]), -1000, "  Lucid 25K max drawdown -$1,000", va="bottom", color="#FF9800",
             fontsize=9)
    ax2.set_ylabel("Drawdown ($)")
    ax2.legend(loc="lower left", fontsize=9)
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "tbr_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample session: last day with a model-A trade, 06:30-12:30 ET (state snapshot at 12:30)
    trA = curves["A_fib618"][0]
    day = max(t_["date"] for t_ in trA)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 390) & (etmin < 750))[0]
    i0, i1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8))
    for i in range(i0, i1 + 1):
        for nm, (f, _) in SESS.items():
            if f[0] <= etmin[i] < f[1]:
                ax.axvspan(i - 0.5, i + 0.5, color=SCOL[nm], alpha=0.07, lw=0)
        col = UP if c[i] >= o[i] else DN
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
    for nm, s_ in st.items():
        if not s_["formed"][i1]:
            continue
        start = i1
        while start > 0 and s_["hi"][start - 1] == s_["hi"][i1]:
            start -= 1
        x0 = max(start, i0)
        ax.hlines(s_["hi"][i1], x0, i1, color=SCOL[nm], lw=2)
        ax.hlines(s_["lo"][i1], x0, i1, color=SCOL[nm], lw=2, ls="--")
        ax.annotate(f"{nm} TBR", (i1, s_["hi"][i1]), xytext=(4, 2), textcoords="offset points", color=SCOL[nm],
                    fontsize=8)
        for side, bk, ek, ak, bb in (("U", "bU", "extH", "hi", "bbU"), ("D", "bD", "extL", "lo", "bbD")):
            if s_[bk][i1] and s_[ek][i1] == s_[ek][i1]:
                anc, ext = s_[ak][i1], s_[ek][i1]
                for r in (0.236, 0.5, 0.618, 0.786):
                    lv = anc + (ext - anc) * r
                    ax.hlines(lv, max(int(s_[bb][i1]), i0), i1, color=SCOL[nm], alpha=0.65, lw=1)
                ax.annotate(f"{nm} 0.618: {anc + (ext - anc) * 0.618:.2f}", (i1, ext), xytext=(-60, 6 if side == "U"
                            else -14), textcoords="offset points", color=SCOL[nm], fontsize=8,
                            bbox=dict(facecolor=BG, edgecolor=SCOL[nm], alpha=0.8, pad=1.5))
            dk, e2 = ("dU", "e2H") if side == "U" else ("dD", "e2L")
            if s_[dk][i1]:
                ax.annotate(f"{nm} 2x Break", (i1, s_[e2][i1]), xytext=(-40, 8 if side == "U" else -16),
                            textcoords="offset points", color="white", fontsize=7,
                            bbox=dict(facecolor="#F23645", edgecolor="none", alpha=0.6, pad=1))
    # 3-drive (pivots 3/3) inside the window
    hs, ls_ = pd.Series(h[i0 - 200:i1 + 1]), pd.Series(l[i0 - 200:i1 + 1])
    base = i0 - 200
    phs, pls = [], []
    for j in range(base + 6, i1 + 1):
        k = j - 3
        if h[k] > h[k - 3:k].max() and h[k] >= h[k + 1:j + 1].max():
            phs.append((k, h[k]))
            if len(phs) >= 3 and phs[-3][1] < phs[-2][1] < phs[-1][1] and phs[-3][0] >= i0:
                ax.plot([p[0] for p in phs[-3:]], [p[1] for p in phs[-3:]], color=BEAR, lw=2)
                ax.annotate("3 Drives Up", phs[-1], xytext=(0, 8), textcoords="offset points", ha="center",
                            fontsize=7, color="white", bbox=dict(facecolor=BEAR, alpha=0.4, edgecolor="none"))
        if l[k] < l[k - 3:k].min() and l[k] <= l[k + 1:j + 1].min():
            pls.append((k, l[k]))
            if len(pls) >= 3 and pls[-3][1] > pls[-2][1] > pls[-1][1] and pls[-3][0] >= i0:
                ax.plot([p[0] for p in pls[-3:]], [p[1] for p in pls[-3:]], color=BULL, lw=2)
                ax.annotate("3 Drives Down", pls[-1], xytext=(0, -14), textcoords="offset points", ha="center",
                            fontsize=7, color="white", bbox=dict(facecolor=BULL, alpha=0.4, edgecolor="none"))
    day_tr = [t_ for t_ in trA if t_["date"] == day] + [t_ for t_ in curves["B_sweep"][0] if t_["date"] == day]
    for t_ in day_tr:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["tp"])), max(xx - xe, 1), abs(t_["tp"] - t_["entry"]),
                               color="#4CAF50", alpha=0.25, lw=0))
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([xe], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=120,
                   color=UP if t_["side"] > 0 else DN, zorder=5)
        model = "A" if t_ in trA else "B"
        ax.annotate(f"{model}: {'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (xe, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    lo_, hi2 = l[i0:i1 + 1].min(), h[i0:i1 + 1].max()
    pad = (hi2 - lo_) * 0.12
    ax.set_ylim(lo_ - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i1 + 10)
    ticks = [k for k in range(i0, i1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    dp = sum(t_["pnl"] for t_ in day_tr)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  TBR high solid / low dashed, Fib 0.236-0.786 from the break, "
                 f"London purple, NY yellow  |  day P&L {'+' if dp >= 0 else '-'}${abs(dp):.0f}", loc="left",
                 fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "tbr_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
