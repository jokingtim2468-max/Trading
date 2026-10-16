"""Simulate "Smart Money Concepts Suite" on NQ (US100) 5-minute bars.

Port (defaults): swing structure pivots 50/50, internal 5/5, BOS/CHoCH on a close
beyond the last unbroken swing; on a swing break the order block = the most recent
opposite candle within 15 bars (max 6 per side, oldest dropped), mitigated on a wick
touch (checked on the creation bar too, as written); sweeps = wick beyond the swing
level and close back inside.
The script has no trades, so three SMC readings are traded (RTH only, 2R targets):
  A "OB retest":  a limit rests at the OB edge (top for bullish, bottom for bearish)
     until the OB is mitigated (= touched) or dropped; it fills only if price trades
     1 tick through during RTH. Stop = far side of the OB -/+ 1 tick.
  B "sweep reversal": market at the SWEEP bar close against the sweep. Stop = sweep
     bar extreme +/- 1 tick.
  C "BOS/CHoCH continuation": market at the swing-break close in the break direction.
     Stop = far side of the new OB -/+ 1 tick (skipped if no OB).
$150 risk on MNQ, $1.24 RT commission, 1 tick slippage on market fills, flat 15:55.
  "script rules": hold to target / stop.  "Lucid rules": + 60-min cap, FOMC/ISM
  blackout, 2-loss / -$400 day lock.
Usage: python smcsuite_sim.py <raw_parquet_dir> <out_dir>
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
SW, IN, OBLB, OBMAX, RR, TICK = 50, 5, 15, 6, 2.0, 0.25
ACCOUNTS = {"script rules": (dict(bt.RULES, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
            "Lucid rules": (bt.RULES, True)}
READINGS = ("A OB retest", "B sweep reversal", "C BOS/CHoCH continuation")


def pivots(h, l, n):
    hs, ls = pd.Series(h), pd.Series(l)
    ch, cl = hs.shift(n).values, ls.shift(n).values
    ph = np.where((ch > hs.shift(n + 1).rolling(n).max().values) & (ch >= hs.rolling(n).max().values), ch, np.nan)
    pl = np.where((cl < ls.shift(n + 1).rolling(n).min().values) & (cl <= ls.rolling(n).min().values), cl, np.nan)
    return ph, pl


def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    m1 = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    m1 = m1[~m1.index.duplicated()].sort_index()
    m1.index = m1.index.tz_localize("UTC").tz_convert(TZ)
    m1 = m1[["open", "high", "low", "close"]].loc[START:END + " 23:59"]
    m1.columns = ["o", "h", "l", "c"]
    b5 = m1.resample("5min", label="left", closed="left").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last"}).dropna()
    ts = b5.index
    o, h, l, c = (b5[k].values for k in "ohlc")
    n = len(c)
    etmin = (ts.hour * 60 + ts.minute).values
    dates = ts.tz_localize(None).normalize()
    phS, plS = pivots(h, l, SW)
    phI, plI = pivots(h, l, IN)

    swH = swL = inH = inL = np.nan
    swHB = swLB = inHB = inLB = True
    swT = inT = 0
    trend = np.zeros(n, int)
    swH_a, swL_a = np.full(n, np.nan), np.full(n, np.nan)
    labels = []      # (bar, text, side, kind) for the chart
    obs = {1: [], -1: []}
    ob_log = []      # dict(id, side, top, bot, made, start, mit, dropped)
    sigA, sigB, sigC = [], [], []
    for i in range(n):
        if phS[i] == phS[i]:
            swH, swHB = phS[i], False
        if plS[i] == plS[i]:
            swL, swLB = plS[i], False
        bull = bear = False
        if swH == swH and not swHB and c[i] > swH:
            swHB = True
            labels.append((i, "CHoCH" if swT == -1 else "BOS", 1, "swing"))
            swT, bull = 1, True
        if swL == swL and not swLB and c[i] < swL:
            swLB = True
            labels.append((i, "CHoCH" if swT == 1 else "BOS", -1, "swing"))
            swT, bear = -1, True
        trend[i] = swT
        swH_a[i], swL_a[i] = swH, swL
        if phI[i] == phI[i]:
            inH, inHB = phI[i], False
        if plI[i] == plI[i]:
            inL, inLB = plI[i], False
        if inH == inH and not inHB and c[i] > inH:
            inHB = True
            labels.append((i, "iCHoCH" if inT == -1 else "iBOS", 1, "internal"))
            inT = 1
        if inL == inL and not inLB and c[i] < inL:
            inLB = True
            labels.append((i, "iCHoCH" if inT == 1 else "iBOS", -1, "internal"))
            inT = -1
        for side, flag in ((1, bull), (-1, bear)):
            if not flag:
                continue
            off = next((k for k in range(1, OBLB + 1) if i - k >= 0 and
                        ((c[i - k] < o[i - k]) if side == 1 else (c[i - k] > o[i - k]))), None)
            if off is None:
                continue
            ob = dict(id=len(ob_log), side=side, top=h[i - off], bot=l[i - off], made=i, start=i - off, mit=None,
                      dropped=None)
            ob_log.append(ob)
            obs[side].append(ob)
            if len(obs[side]) > OBMAX:
                obs[side].pop(0)["dropped"] = i
            stop = ob["bot"] - TICK if side == 1 else ob["top"] + TICK
            if side * (c[i] - stop) > 0:
                sigC.append(dict(i=i, side=side, px=c[i], stop=stop))
        for side in (1, -1):
            for ob in list(reversed(obs[side])):
                if (l[i] <= ob["top"]) if side == 1 else (h[i] >= ob["bot"]):
                    ob["mit"] = i
                    obs[side].remove(ob)
        if swL == swL and l[i] < swL and c[i] > swL:
            labels.append((i, "SWEEP", 1, "sweep"))
            sigB.append(dict(i=i, side=1, px=c[i], stop=l[i] - TICK))
        if swH == swH and h[i] > swH and c[i] < swH:
            labels.append((i, "SWEEP", -1, "sweep"))
            sigB.append(dict(i=i, side=-1, px=c[i], stop=h[i] + TICK))
    for ob in ob_log:  # A: the resting limit can only fill on the bar that mitigates the OB
        if ob["mit"] is not None and ob["mit"] > ob["made"]:
            side = ob["side"]
            px = ob["top"] if side == 1 else ob["bot"]
            stop = ob["bot"] - TICK if side == 1 else ob["top"] + TICK
            sigA.append(dict(i=ob["mit"], side=side, px=px, stop=stop, lmt=True))

    t1 = m1.index.hour * 60 + m1.index.minute
    rth = m1[(t1 >= 570) & (t1 < 960) & (m1.index.dayofweek < 5)]
    recs = {}
    for dd, g in rth.groupby(rth.index.date):
        if len(g) >= 300:
            recs[dd] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32), m1=g[["o", "h", "l", "c"]].values)
    cal = sorted(recs)
    news = bt.news_windows(cal)

    def to_day(sl, limit):
        out = {}
        for s in sl:
            i = s["i"]
            t = int(etmin[i]) if limit else int(etmin[i] + 5)  # limit rests from the bar's start
            if not (570 <= t < 950):
                continue
            risk = abs(s["px"] - s["stop"])
            out.setdefault(dates[i].date(), []).append(dict(
                t=t, side=s["side"], px=float(s["px"]), stop=float(s["stop"]),
                tp=float(s["px"] + s["side"] * RR * risk), kind="lmt" if limit else "mkt", expiry=5))
        return out

    sigs = {READINGS[0]: to_day(sigA, True), READINGS[1]: to_day(sigB, False), READINGS[2]: to_day(sigC, False)}
    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal),
                   raw_signals={READINGS[0]: len(sigA), READINGS[1]: len(sigB), READINGS[2]: len(sigC)},
                   order_blocks=len(ob_log),
                   obs_mitigated_on_creation_bar=int(sum(ob["mit"] == ob["made"] for ob in ob_log)))
    curves = {}
    for r, sg in sigs.items():
        for acct, (rules, use_news) in ACCOUNTS.items():
            trades = []
            for dd in cal:
                got = bt.run_day(recs[dd], sg.get(dd, []), "NQ", news.get(dd, []) if use_news else [], 100, rules=rules)
                for tr_ in got:
                    tr_["date"] = dd
                trades += got
            daily = pd.Series({x: 0.0 for x in cal})
            for t_ in trades:
                daily[t_["date"]] += t_["pnl"]
            eqc = daily.cumsum()
            ddc = eqc - eqc.cummax()
            key = f"{r} {acct}"
            years = {str(y): bt.stats([t_ for t_ in trades if t_["date"].year == y], sum(x.year == y for x in cal))
                     for y in sorted({x.year for x in cal})}
            summary[key] = dict(overall=bt.stats(trades, len(cal)), years=years, worst_day=float(daily.min()),
                                dd_date=str(ddc.idxmin()),
                                exits=pd.Series([t_["why"] for t_ in trades], dtype=object).value_counts().to_dict())
            pd.DataFrame(trades).to_csv(os.path.join(OUT, f"smcsuite_trades_{r.split()[0]}_{acct.split()[0]}.csv"),
                                        index=False)
            curves[key] = (trades, eqc, ddc)
            ov = summary[key]["overall"]
            print(f"{key:40s} trades {ov['trades']:5d} win {ov['win']:5.1f}% PF {ov['pf']:.2f} net ${ov['net']:10,.0f} "
                  f"maxDD ${ov['maxdd']:9,.0f} $/wk {ov['per_week']:7.1f} micros {ov['micros']:.1f} "
                  f"exits {summary[key]['exits']}", flush=True)
    print({k: summary[k] for k in ("raw_signals", "order_blocks", "obs_mitigated_on_creation_bar")})
    json.dump(summary, open(os.path.join(OUT, "smcsuite_summary.json"), "w"), indent=1, default=str)

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    BULL, BEAR = "#2962FF", "#FF5252"
    COLS = {f"{READINGS[0]} script rules": "#2962FF", f"{READINGS[0]} Lucid rules": "#82B1FF",
            f"{READINGS[1]} script rules": "#E91E63", f"{READINGS[1]} Lucid rules": "#F48FB1",
            f"{READINGS[2]} script rules": "#FFB300", f"{READINGS[2]} Lucid rules": "#FFE082"}
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10, "legend.facecolor": BG, "legend.edgecolor": GRID, "text.parse_math": False})
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    for key, (trades, eqc, ddc) in curves.items():
        s_ = summary[key]["overall"]
        x = pd.to_datetime(eqc.index)
        ls_ = "-" if "script" in key else "--"
        ax1.plot(x, eqc.values, color=COLS[key], lw=1.5, ls=ls_,
                 label=f"{key}: net ${s_['net']:,.0f}, PF {s_['pf']:.2f}, {s_['trades']} tr")
        ax2.plot(x, ddc.values, color=COLS[key], lw=1.1, ls=ls_, label=f"max DD ${s_['maxdd']:,.0f}")
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"Smart Money Concepts Suite on NQ / US100 5m, 2R targets, $150 risk  |  {cal[0]} to {cal[-1]}",
                  loc="left")
    ax1.set_ylabel("Cumulative P&L ($)")
    ax1.legend(loc="lower left", fontsize=8)
    ax1.grid(True, lw=0.6)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.set_ylabel("Drawdown ($)")
    ax2.legend(loc="lower left", fontsize=8, ncol=2)
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "smcsuite_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample day: last day with an OB-retest trade (script rules), 08:00-16:00
    trades = curves[f"{READINGS[0]} script rules"][0]
    day = max(t_["date"] for t_ in trades)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 480) & (etmin < 960))[0]
    i0, i1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8.5))
    hi_, lo_ = swH_a[i1], swL_a[i1]
    if hi_ == hi_ and lo_ == lo_ and hi_ > lo_:
        rg = hi_ - lo_
        for top, bot, col in ((hi_, lo_ + rg * 0.79, BEAR), (lo_ + rg * 0.55, lo_ + rg * 0.45, MUTED),
                              (lo_ + rg * 0.21, lo_, BULL)):
            ax.axhspan(bot, top, color=col, alpha=0.06, lw=0)
    for ob in ob_log:
        if ob["made"] > i1:
            continue
        end = ob["mit"] if ob["mit"] is not None else ob["dropped"]
        if end is not None and end < i0 or (ob["dropped"] is not None and ob["dropped"] <= i1):
            continue
        active = ob["mit"] is None or ob["mit"] > i1
        x0 = max(ob["start"], i0 - 0.5)
        x1 = i1 + 6 if active else ob["mit"]
        col = (BULL if ob["side"] == 1 else BEAR) if active else MUTED
        ax.add_patch(Rectangle((x0, ob["bot"]), x1 - x0, ob["top"] - ob["bot"], facecolor=col,
                               alpha=0.22 if active else 0.12, edgecolor=col, lw=0.8))
    # FVGs (close mitigation, min 0.1 ATR) replayed from 3 days before the window
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    fv = []
    for i in range(max(2, i0 - 830), i1 + 1):
        if l[i] - h[i - 2] > atr[i] * 0.1:
            fv.append(dict(top=l[i], bot=h[i - 2], s=1, x=i - 2, end=None))
        if l[i - 2] - h[i] > atr[i] * 0.1:
            fv.append(dict(top=l[i - 2], bot=h[i], s=-1, x=i - 2, end=None))
        for z in fv:
            if z["end"] is None and ((c[i] <= z["bot"]) if z["s"] == 1 else (c[i] >= z["top"])):
                z["end"] = i
    for z in fv:
        if z["end"] is not None and z["end"] < i0:
            continue
        x0 = max(z["x"], i0 - 0.5)
        x1 = z["end"] if z["end"] is not None else i1 + 6
        ax.add_patch(Rectangle((x0, z["bot"]), x1 - x0, z["top"] - z["bot"],
                               color="#00BCD4" if z["s"] == 1 else "#FF7043", alpha=0.18, lw=0))
    for i in range(i0, i1 + 1):
        col = BULL if trend[i] == 1 else BEAR if trend[i] == -1 else MUTED
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
    for i, txt, side, kind in labels:
        if i0 <= i <= i1 and kind != "internal":
            y = l[i] if side == 1 else h[i]
            ax.annotate(txt, (i, y), xytext=(0, -14 if side == 1 else 8), textcoords="offset points", ha="center",
                        fontsize=7, color="white",
                        bbox=dict(facecolor=BULL if side == 1 else BEAR, alpha=0.9 if kind == "swing" else 0.5,
                                  edgecolor="none", pad=1))
    for t_ in [t_ for t_ in trades if t_["date"] == day]:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["tp"])), max(xx - xe, 1), abs(t_["tp"] - t_["entry"]),
                               color="#4CAF50", alpha=0.25, lw=0))
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([xe], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=110,
                   color="#00E676" if t_["side"] > 0 else "#FF1744", zorder=5)
        ax.annotate(f"OB RETEST {'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (xe, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    lo2, hi2 = l[i0:i1 + 1].min(), h[i0:i1 + 1].max()
    pad = (hi2 - lo2) * 0.12
    ax.set_ylim(lo2 - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i1 + 6)
    ticks = [k for k in range(i0, i1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    dp = sum(t_["pnl"] for t_ in trades if t_["date"] == day)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  candles colored by swing trend, BOS/CHoCH & SWEEP labels, OB boxes "
                 f"(gray = mitigated), FVGs, premium/discount  |  day P&L {'+' if dp >= 0 else '-'}${abs(dp):.0f}",
                 loc="left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "smcsuite_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
