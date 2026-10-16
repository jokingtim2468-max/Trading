"""Run TradeX QuantORB (same port and fills as orb_sim.py) on one recent week of NQ
1-minute bars from a CSV (columns: timestamp ET, o, h, l, c, v).

Usage: python orb_week.py <week_csv> <out_dir>
"""
import json
import os
import sys

import numpy as np
import pandas as pd

import bt

CSV, OUT = sys.argv[1], sys.argv[2]
PRESETS = {"V4.1": dict(rr=2.0, be=1.0, stop_frac=0.0), "V3.1": dict(rr=1.5, be=0.75, stop_frac=0.25)}
ACCOUNTS = {
    "as written ($500)": (dict(bt.RULES, risk=500.0, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
    "script rules ($150)": (dict(bt.RULES, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
    "Lucid rules ($150)": (bt.RULES, True),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    df = pd.read_csv(CSV, index_col=0)
    df.index = pd.to_datetime(df.index, utc=True).tz_convert("America/New_York")
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
    days = sorted(recs)
    # ISM = 1st / 3rd trading day of the month, so build the whole month's calendar
    month = [x.date() for x in pd.bdate_range(days[0].replace(day=1), (pd.Timestamp(days[0]) + pd.offsets.MonthEnd(0)))]
    news = bt.news_windows(month)

    rows, out = [], {}
    for preset, p in PRESETS.items():
        sigs, ors = {}, {}
        for d, b in bars5.items():
            orb = b[(b.t >= 570) & (b.t < 585)]
            hi, lo = orb.h.max(), orb.l.min()
            rng = hi - lo
            ors[d] = (hi, lo, rng)
            s = []
            if 10.0 <= rng <= 100.0:
                for t, c in zip(b.t.values, b.c.values):
                    if 585 <= t < 720 and c > hi:
                        stp = lo + rng * p["stop_frac"]
                        s.append(dict(t=int(t + 5), side=1, px=float(c), stop=float(stp), tp=float(c + (c - stp) * p["rr"])))
                    elif 585 <= t < 720 and c < lo:
                        stp = hi - rng * p["stop_frac"]
                        s.append(dict(t=int(t + 5), side=-1, px=float(c), stop=float(stp), tp=float(c - (stp - c) * p["rr"])))
            sigs[d] = s
        for acct, (rules, use_news) in ACCOUNTS.items():
            trades = []
            for d in days:
                got = bt.run_day_mgmt(recs[d], sigs[d], "NQ", news.get(d, []) if use_news else [], 2, rules, be_r=p["be"])
                for tr_ in got:
                    tr_["date"] = d
                trades += got
            key = f"{preset} {acct}"
            st = bt.stats(trades, len(days))
            daily = {str(d): round(sum(t_["pnl"] for t_ in trades if t_["date"] == d), 2) for d in days}
            out[key] = dict(stats=st, daily=daily, trades=[{k: (str(v) if k == "date" else v) for k, v in t_.items()}
                                                            for t_ in trades], ors={str(k): v for k, v in ors.items()})
            rows.append((key, st, daily))
            print(f"{key:28s} trades {st['trades']}  win {st['win']:5.1f}%  net ${st['net']:8,.2f}  maxDD ${st['maxdd']:7,.2f}  "
                  f"daily {daily}")
    json.dump(out, open(os.path.join(OUT, "orb_week_summary.json"), "w"), indent=1, default=float)

    # ---- chart: one panel per day, V4.1 as written
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    UP, DN, TEAL, ORANGE = "#089981", "#F23645", "#089981", "#FF9800"
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 9, "text.parse_math": False})
    key = "V4.1 as written ($500)"
    trades = [dict(t_, date=pd.Timestamp(t_["date"]).date()) for t_ in out[key]["trades"]]
    fig, axes = plt.subplots(1, len(days), figsize=(4.2 * len(days), 6.5))
    for ax, d in zip(np.atleast_1d(axes), days):
        b = bars5[d][(bars5[d].t >= 570) & (bars5[d].t < 960)]
        t0 = b.t.values[0]
        hi, lo, rng = ors[d] if d in ors else (np.nan, np.nan, np.nan)
        hi, lo, rng = out[key]["ors"][str(d)]
        ax.add_patch(Rectangle((-0.5, lo), 3, hi - lo, color=MUTED, alpha=0.25, lw=0))
        ax.hlines([hi, lo], 3, len(b) - 1, color=MUTED, lw=1)
        for k, (o_, h_, l_, c_) in enumerate(b[["o", "h", "l", "c"]].values):
            col = UP if c_ >= o_ else DN
            ax.vlines(k, l_, h_, color=col, lw=0.8)
            ax.add_patch(Rectangle((k - 0.35, min(o_, c_)), 0.7, max(abs(c_ - o_), 0.25), color=col))
        for t_ in [x for x in trades if x["date"] == d]:
            ke, kx = (t_["t_in"] - t0) / 5, (t_["t_out"] - t0) / 5
            ax.add_patch(Rectangle((ke, min(t_["entry"], t_["tp"])), max(kx - ke, 1), abs(t_["tp"] - t_["entry"]),
                                   color="#4CAF50", alpha=0.25, lw=0))
            ax.add_patch(Rectangle((ke, min(t_["entry"], t_["stop"])), max(kx - ke, 1), abs(t_["stop"] - t_["entry"]),
                                   color="#F44336", alpha=0.25, lw=0))
            ax.scatter([ke - 1], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=80,
                       color=TEAL if t_["side"] > 0 else ORANGE, zorder=5)
            ax.annotate(f"{'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']}\n{t_['why'].upper()} "
                        f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (ke, t_["entry"]),
                        xytext=(4, 10 if t_["side"] > 0 else -24), textcoords="offset points", fontsize=7.5, color=TXT)
        dp = out[key]["daily"][str(d)]
        filt = "" if 10 <= rng <= 100 else f"  (no trade: OR {rng:.0f} pts > 100)"
        ax.set_title(f"{pd.Timestamp(d):%a %b %d}  |  {'+' if dp >= 0 else '-'}${abs(dp):,.0f}{filt}", loc="left",
                     fontsize=9)
        ticks = [k for k, t in enumerate(b.t.values) if t in (570, 660, 780, 900)]
        ax.set_xticks(ticks, [f"{b.t.values[k] // 60:02d}:{b.t.values[k] % 60:02d}" for k in ticks])
        ax.grid(True, lw=0.4)
    tot = out[key]["stats"]["net"]
    fig.suptitle(f"TradeX QuantORB V4.1 as written on NQ (US100), week of {days[0]} to {days[-1]}  |  "
                 f"week P&L {'+' if tot >= 0 else '-'}${abs(tot):,.0f} on MNQ after costs", x=0.01, ha="left",
                 color=TXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "orb_week.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
