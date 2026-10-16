"""Simulate "SUPER INDIBOT - EMA Ribbon Trend" on NQ (US100) 5-minute bars.

Port: EMAs 5/11/15/18/21/24/28/34 on the 24h 5m close (TradingView chart default);
BUY = ribbon turns fully bullish (all 7 adjacent pairs ordered) after not being fully
bullish on the previous bar, SELL = the mirror (the script's wasBull/wasBear logic).
The script has no stop or exit, so two readings are traded (RTH signals only):
  A "arrow to arrow": enter on BUY/SELL, exit on the opposite arrow (and reverse).
  B "strong trend only": enter on BUY/SELL, exit when the ribbon is no longer fully aligned.
Stop for sizing = slow ribbon edge (EMA 34) -/+ 0.25 ATR(14) at the signal. Entries fill at
the next 1m open + 1 tick, signal exits at the open after the exit bar closes (+1 tick).
$150 risk on MNQ, $1.24 RT commission, flat 15:55.
  "script rules": no other limits.   "Lucid rules": + 60-minute cap, FOMC/ISM blackout,
  2-loss / -$400 day lock.
Usage: python ribbon_sim.py <raw_parquet_dir> <out_dir>
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
LENS = (5, 11, 15, 18, 21, 24, 28, 34)
ACCOUNTS = {"script rules": (dict(bt.RULES, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
            "Lucid rules": (bt.RULES, True)}


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
    etmin = (ts.hour * 60 + ts.minute).values
    dates = ts.tz_localize(None).normalize()
    E = np.vstack([b5.c.ewm(span=n, adjust=False).mean().values for n in LENS])
    bull = (np.diff(E, axis=0) < 0).sum(axis=0)          # ema_k > ema_{k+1}
    fullB, fullS = bull == 7, bull == 0
    prevB, prevS = np.r_[False, fullB[:-1]], np.r_[False, fullS[:-1]]
    buy, sell = fullB & ~prevB, fullS & ~prevS
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values

    n = len(c)
    nxt_sell = np.full(n, n)  # index of the next SELL / BUY at or after i
    nxt_buy = np.full(n, n)
    ns = nb = n
    for i in range(n - 1, -1, -1):
        if sell[i]:
            ns = i
        if buy[i]:
            nb = i
        nxt_sell[i], nxt_buy[i] = ns, nb
    nxt_notB = np.full(n, n)
    nxt_notS = np.full(n, n)
    a_ = b_ = n
    for i in range(n - 1, -1, -1):
        if not fullB[i]:
            a_ = i
        if not fullS[i]:
            b_ = i
        nxt_notB[i], nxt_notS[i] = a_, b_

    def exit_time(i, j):
        """exit minute for a trade from signal bar i whose exit bar is j (same day only)."""
        if j >= n or dates[j] != dates[i]:
            return None
        return int(etmin[j] + 5)

    sigs = {"A arrow-to-arrow": {}, "B strong-trend-only": {}}
    for i in np.where((buy | sell) & (etmin >= 570) & (etmin < 950))[0]:
        side = 1 if buy[i] else -1
        stop = E[-1, i] - side * 0.25 * atr[i]
        d = dates[i].date()
        base = dict(t=int(etmin[i] + 5), side=side, px=float(c[i]), stop=float(stop), tp=None)
        ja = nxt_sell[i + 1] if side > 0 else nxt_buy[i + 1]
        jb = nxt_notB[i + 1] if side > 0 else nxt_notS[i + 1]
        sigs["A arrow-to-arrow"].setdefault(d, []).append(dict(base, exit_t=exit_time(i, ja)))
        sigs["B strong-trend-only"].setdefault(d, []).append(dict(base, exit_t=exit_time(i, jb)))

    t1 = m1.index.hour * 60 + m1.index.minute
    rth = m1[(t1 >= 570) & (t1 < 960) & (m1.index.dayofweek < 5)]
    recs = {}
    for d, g in rth.groupby(rth.index.date):
        if len(g) >= 300:
            recs[d] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32), m1=g[["o", "h", "l", "c"]].values)
    cal = sorted(recs)
    news = bt.news_windows(cal)
    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal),
                   rth_arrows=int(sum(len(v) for v in sigs["A arrow-to-arrow"].values())))
    curves = {}
    for model, sg in sigs.items():
        for acct, (rules, use_news) in ACCOUNTS.items():
            trades = []
            for d in cal:
                got = bt.run_day_mgmt(recs[d], sg.get(d, []), "NQ", news.get(d, []) if use_news else [], 100, rules)
                for tr_ in got:
                    tr_["date"] = d
                trades += got
            daily = pd.Series({dd: 0.0 for dd in cal})
            for t_ in trades:
                daily[t_["date"]] += t_["pnl"]
            eqc = daily.cumsum()
            ddc = eqc - eqc.cummax()
            key = f"{model} {acct}"
            years = {str(y): bt.stats([t_ for t_ in trades if t_["date"].year == y], sum(dd.year == y for dd in cal))
                     for y in sorted({dd.year for dd in cal})}
            summary[key] = dict(overall=bt.stats(trades, len(cal)), years=years, worst_day=float(daily.min()),
                                dd_date=str(ddc.idxmin()),
                                exits=pd.Series([t_["why"] for t_ in trades], dtype=object).value_counts().to_dict(),
                                avg_hold_min=float(np.mean([t_["t_out"] - t_["t_in"] for t_ in trades])))
            pd.DataFrame(trades).to_csv(os.path.join(OUT, f"ribbon_trades_{model.split()[0]}_{acct.split()[0]}.csv"),
                                        index=False)
            curves[key] = (trades, eqc, ddc)
            ov = summary[key]["overall"]
            print(f"{key:34s} trades {ov['trades']:5d} win {ov['win']:5.1f}% PF {ov['pf']:.2f} net ${ov['net']:10,.0f} "
                  f"maxDD ${ov['maxdd']:9,.0f} $/wk {ov['per_week']:7.1f} hold {summary[key]['avg_hold_min']:.0f}m "
                  f"micros {ov['micros']:.1f} exits {summary[key]['exits']}", flush=True)
    json.dump(summary, open(os.path.join(OUT, "ribbon_summary.json"), "w"), indent=1, default=str)

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    BULL, BEAR = "#00c2a8", "#ff8a3d"
    UP, DN = "#089981", "#F23645"
    COLS = {"A arrow-to-arrow script rules": "#2962FF", "A arrow-to-arrow Lucid rules": "#26C6DA",
            "B strong-trend-only script rules": "#E91E63", "B strong-trend-only Lucid rules": "#FFB74D"}
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10, "legend.facecolor": BG, "legend.edgecolor": GRID, "text.parse_math": False})
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7.5), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    for key, (trades, eqc, ddc) in curves.items():
        s_ = summary[key]["overall"]
        x = pd.to_datetime(eqc.index)
        ax1.plot(x, eqc.values, color=COLS[key], lw=1.6,
                 label=f"{key}: net ${s_['net']:,.0f}, PF {s_['pf']:.2f}, {s_['trades']} trades")
        ax2.plot(x, ddc.values, color=COLS[key], lw=1.1, label=f"{key}: max DD ${s_['maxdd']:,.0f}")
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"SUPER INDIBOT EMA Ribbon on NQ / US100 5m, $150 risk  |  {cal[0]} to {cal[-1]}", loc="left")
    ax1.set_ylabel("Cumulative P&L ($, MNQ, after costs)")
    ax1.legend(loc="lower left", fontsize=8.5)
    ax1.grid(True, lw=0.6)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.set_ylabel("Drawdown ($)")
    ax2.legend(loc="lower left", fontsize=8.5)
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "ribbon_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample day (A, script rules): last day with >= 3 trades, 09:00-16:00
    trades = curves["A arrow-to-arrow script rules"][0]
    cnt = pd.Series([t_["date"] for t_ in trades]).value_counts()
    day = max(d for d in cnt.index if cnt[d] >= 3)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 540) & (etmin < 960))[0]
    i0, i1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8))
    xs = np.arange(i0, i1 + 1)
    strength = bull[i0:i1 + 1] / 7.0
    cmap = matplotlib.colors.LinearSegmentedColormap.from_list("rib", [BEAR, BULL])
    for k in range(8):
        for x0 in range(len(xs) - 1):
            ax.plot(xs[x0:x0 + 2], E[k, i0 + x0:i0 + x0 + 2], color=cmap(strength[x0 + 1]), lw=2 if k == 7 else 0.9,
                    alpha=0.9)
    for x0 in range(len(xs) - 1):
        ax.fill_between(xs[x0:x0 + 2], E[0, i0 + x0:i0 + x0 + 2], E[7, i0 + x0:i0 + x0 + 2],
                        color=cmap(strength[x0 + 1]), alpha=0.15, lw=0)
    for i in range(i0, i1 + 1):
        col = UP if c[i] >= o[i] else DN
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
        if buy[i]:
            ax.annotate("BUY", (i, l[i]), xytext=(0, -16), textcoords="offset points", ha="center", fontsize=7,
                        color="white", bbox=dict(facecolor=BULL, edgecolor="none", pad=1))
        if sell[i]:
            ax.annotate("SELL", (i, h[i]), xytext=(0, 8), textcoords="offset points", ha="center", fontsize=7,
                        color="white", bbox=dict(facecolor=BEAR, edgecolor="none", pad=1))
    for t_ in [t_ for t_ in trades if t_["date"] == day]:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.2, lw=0))
        ax.plot([xe, xx], [t_["entry"], t_["exit"]], color="#4CAF50" if t_["pnl"] >= 0 else "#F44336", lw=1.5, ls=":")
        ax.annotate(f"{'L' if t_['side'] > 0 else 'S'} {t_['n']}  {'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}",
                    (xx, t_["exit"]), xytext=(3, 0), textcoords="offset points", fontsize=7.5, color=TXT)
    lo_, hi2 = l[i0:i1 + 1].min(), h[i0:i1 + 1].max()
    pad = (hi2 - lo_) * 0.1
    ax.set_ylim(lo_ - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i1 + 6)
    ticks = [k for k in range(i0, i1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    dp = sum(t_["pnl"] for t_ in trades if t_["date"] == day)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  EMA ribbon (orange = bearish, teal = bullish), BUY/SELL flips, "
                 f"trades arrow-to-arrow, stop zone red  |  day P&L {'+' if dp >= 0 else '-'}${abs(dp):.0f}",
                 loc="left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "ribbon_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
