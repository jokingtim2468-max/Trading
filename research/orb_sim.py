"""Simulate the TradingView script "TradeX QuantORB" on NQ (US100) 5-minute bars.

The script defines its own trade, ported exactly:
  * Opening range 09:30-09:45 ET (bars 09:30/09:35/09:40). Trade only if
    10 <= range <= 100 points.
  * Entry: first 5m close above OR high (long) / below OR low (short) from 09:45 until the
    12:00 cutoff, no trade open, max 2 trades per session.
  * V4.1: stop = opposite OR side, target 2R, stop -> entry once price reaches 1R.
    V3.1: stop = opposite side moved 25% into the range, target 1.5R, break-even at 0.75R.
  * Flatten 15:55 ET.
Fills are realistic: the script marks stop/target hits using the SAME bar it enters on
(price action before its own entry); here the entry fills at the next 1m open + 1 tick and
stops/targets are checked minute by minute from then on (stop first if both in one minute,
targets must trade through, break-even effective from the next minute).
Two account versions:
  "as written": the script's own $500 risk per trade (MNQ, $2/pt), no time limit.
  "script $150": the script's own rules sized at the Lucid $150 risk (comparable to the
                 other script simulations).
  "Lucid":      $150 risk, 60-minute max hold, FOMC/ISM blackout, 2-loss / -$400 day lock.
Usage: python orb_sim.py <raw_parquet_dir> <out_dir>
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
PRESETS = {"V4.1": dict(rr=2.0, be=1.0, stop_frac=0.0), "V3.1": dict(rr=1.5, be=0.75, stop_frac=0.25)}
ACCOUNTS = {
    "as written": (dict(bt.RULES, risk=500.0, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
    "script $150": (dict(bt.RULES, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
    "Lucid": (bt.RULES, True),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    df = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    df = df[~df.index.duplicated()].sort_index()
    df.index = df.index.tz_localize("UTC").tz_convert(TZ)
    df = df[["open", "high", "low", "close"]].loc[START:END + " 23:59"]
    df.columns = ["o", "h", "l", "c"]
    t1 = df.index.hour * 60 + df.index.minute
    rth = df[(t1 >= 570) & (t1 < 960) & (df.index.dayofweek < 5)]
    recs, bars5 = {}, {}
    for d, g in rth.groupby(rth.index.date):
        if len(g) < 300:
            continue
        recs[d] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32), m1=g[["o", "h", "l", "c"]].values)
        b = g.resample("5min", label="left", closed="left").agg({"o": "first", "h": "max", "l": "min", "c": "last"}).dropna()
        b["t"] = b.index.hour * 60 + b.index.minute
        bars5[d] = b
    cal = sorted(recs)
    news = bt.news_windows(cal)

    def signals(preset):
        p = PRESETS[preset]
        out, ors = {}, {}
        for d, b in bars5.items():
            orb = b[(b.t >= 570) & (b.t < 585)]
            if len(orb) < 3:
                continue
            hi, lo = orb.h.max(), orb.l.min()
            rng = hi - lo
            ors[d] = (hi, lo)
            if not (10.0 <= rng <= 100.0):
                continue
            s = []
            for t, c in zip(b.t.values, b.c.values):
                if t < 585 or t >= 720:
                    continue
                if c > hi:
                    stp = lo + rng * p["stop_frac"]
                    s.append(dict(t=int(t + 5), side=1, px=float(c), stop=float(stp), tp=float(c + (c - stp) * p["rr"])))
                elif c < lo:
                    stp = hi - rng * p["stop_frac"]
                    s.append(dict(t=int(t + 5), side=-1, px=float(c), stop=float(stp), tp=float(c - (stp - c) * p["rr"])))
            out[d] = s
        return out, ors

    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal))
    curves = {}
    for preset in PRESETS:
        sigs, ors = signals(preset)
        for acct, (rules, use_news) in ACCOUNTS.items():
            trades, skipped = [], 0
            for d in cal:
                got = bt.run_day_mgmt(recs[d], sigs.get(d, []), "NQ", news.get(d, []) if use_news else [], 2, rules,
                                      be_r=PRESETS[preset]["be"])
                for tr_ in got:
                    tr_["date"] = d
                trades += got
            daily = pd.Series({dd: 0.0 for dd in cal})
            for t_ in trades:
                daily[t_["date"]] += t_["pnl"]
            eqc = daily.cumsum()
            ddc = eqc - eqc.cummax()
            key = f"{preset} {acct}"
            years = {str(y): bt.stats([t_ for t_ in trades if t_["date"].year == y], sum(dd.year == y for dd in cal))
                     for y in sorted({dd.year for dd in cal})}
            summary[key] = dict(overall=bt.stats(trades, len(cal)), years=years, worst_day=float(daily.min()),
                                dd_date=str(ddc.idxmin()),
                                exits=pd.Series([t_["why"] for t_ in trades]).value_counts().to_dict())
            pd.DataFrame(trades).to_csv(os.path.join(OUT, f"orb_trades_{preset}_{acct.replace(' ', '_')}.csv"), index=False)
            curves[key] = (trades, eqc, ddc, ors)
            o = summary[key]["overall"]
            print(f"{key:16s} trades {o['trades']:5d} win {o['win']:5.1f}% PF {o['pf']:.2f} net ${o['net']:9,.0f} "
                  f"maxDD ${o['maxdd']:8,.0f} $/wk {o['per_week']:7.1f} micros {o['micros']:4.1f} exits {summary[key]['exits']}",
                  flush=True)
    json.dump(summary, open(os.path.join(OUT, "orb_summary.json"), "w"), indent=1, default=str)

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    UP, DN, TEAL, ORANGE = "#089981", "#F23645", "#089981", "#FF9800"
    COLS = {"V4.1 as written": "#2962FF", "V4.1 script $150": "#7E57C2", "V4.1 Lucid": "#26C6DA",
            "V3.1 as written": "#E91E63", "V3.1 script $150": "#F06292", "V3.1 Lucid": "#FFB74D"}
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10, "legend.facecolor": BG, "legend.edgecolor": GRID, "text.parse_math": False})
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7.5), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    for key, (trades, eqc, ddc, _) in curves.items():
        if key.startswith("V3.1"):
            continue  # V3.1 is in the table/summary; keep the chart readable
        s_ = summary[key]["overall"]
        x = pd.to_datetime(eqc.index)
        ax1.plot(x, eqc.values, color=COLS[key], lw=1.8,
                 label=f"{key}: net ${s_['net']:,.0f}, PF {s_['pf']:.2f}, {s_['trades']} trades")
        ax2.plot(x, ddc.values, color=COLS[key], lw=1.2, label=f"{key}: max DD ${s_['maxdd']:,.0f}")
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"TradeX QuantORB on NQ / US100 5m  |  {cal[0]} to {cal[-1]}  |  MNQ, after costs", loc="left")
    ax1.set_ylabel("Cumulative P&L ($)")
    ax1.legend(loc="upper left", fontsize=8.5)
    ax1.grid(True, lw=0.6)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.text(pd.to_datetime(cal[0]), -1000, "  Lucid 25K max drawdown -$1,000", va="bottom", color="#FF9800", fontsize=9)
    ax2.set_ylabel("Drawdown ($)")
    ax2.legend(loc="lower left", fontsize=8.5)
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "orb_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample day: last day with 2 trades, V4.1 as written
    trades, _, _, ors = curves["V4.1 as written"]
    cnt = pd.Series([t_["date"] for t_ in trades]).value_counts()
    day = max(d for d in cnt.index if cnt[d] >= 2)
    b = bars5[day]
    b = b[(b.t >= 555) & (b.t < 960)]
    xs = np.arange(len(b))
    tpos = {t: k for k, t in enumerate(b.t.values)}
    fig, ax = plt.subplots(figsize=(15, 8))
    hi, lo = ors[day]
    k0 = tpos[570]
    ax.add_patch(Rectangle((k0 - 0.5, lo), 3, hi - lo, color=MUTED, alpha=0.25, lw=0))
    ax.hlines([hi, lo], tpos[585], xs[-1], color=MUTED, lw=1.2)
    day_tr = [t_ for t_ in trades if t_["date"] == day]
    for t_ in day_tr:
        ke = (t_["t_in"] - b.t.values[0]) / 5
        kx = (t_["t_out"] - b.t.values[0]) / 5
        col = TEAL if t_["side"] > 0 else ORANGE
        ax.axvspan(ke - 0.5, kx + 0.5, color=col, alpha=0.08, lw=0)
        ax.hlines(t_["stop"], ke, kx, color=ORANGE, lw=1.2, ls="--")
        ax.hlines(t_["tp"], ke, kx, color=TEAL, lw=1.2, ls="--")
        ax.add_patch(Rectangle((ke, min(t_["entry"], t_["tp"])), max(kx - ke, 1), abs(t_["tp"] - t_["entry"]),
                               color="#4CAF50", alpha=0.25, lw=0))
        ax.add_patch(Rectangle((ke, min(t_["entry"], t_["stop"])), max(kx - ke, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([ke - 1], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=120, color=col, zorder=5)
        mk = {"stop": ("x", DN), "breakeven": ("x", MUTED), "tp": ("o", TEAL)}.get(t_["why"], ("s", MUTED))
        ax.scatter([kx], [t_["exit"]], marker=mk[0], s=90, color=mk[1], zorder=6)
        ax.annotate(f"{'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (ke - 1, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    for k, (o_, h_, l_, c_) in enumerate(b[["o", "h", "l", "c"]].values):
        col = UP if c_ >= o_ else DN
        ax.vlines(k, l_, h_, color=col, lw=1)
        ax.add_patch(Rectangle((k - 0.35, min(o_, c_)), 0.7, max(abs(c_ - o_), 0.25), color=col))
    ax.text(0.99, 0.98, f"Preset V4.1\nOR High {hi:.2f}\nOR Low {lo:.2f}\nOR Range {hi - lo:.2f}\nTrades {len(day_tr)}",
            transform=ax.transAxes, ha="right", va="top", fontsize=9, bbox=dict(facecolor="#2a2e39", edgecolor=GRID))
    ticks = [k for k, t in enumerate(b.t.values) if t % 60 == 0 or t == 570]
    ax.set_xticks(ticks, [f"{b.t.values[k] // 60:02d}:{b.t.values[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    dp = sum(t_["pnl"] for t_ in day_tr)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  QuantORB V4.1 as written  |  OR box gray, stop orange dashed, "
                 f"target teal dashed  |  day P&L {'+' if dp >= 0 else '-'}${abs(dp):.0f}", loc="left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "orb_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
