"""Simulate "SMC Sniper Pro - Quant Flow Labs" on NQ (US100) 5-minute bars (all 3 models).

Bar-by-bar port (Fixed RR take-profit, default filters ON):
  * Sweep of the last confirmed swing (pivot 5/5) starts a setup (stage 1); a new sweep
    always restarts it; stage 1 expires after 60 bars.
  * The MSS block runs for EVERY model (as in the script): close beyond the last swing
    -> stage 2 + equilibrium level. Model 1 therefore also fires on MSS, and Model 3
    (CISD, needs stage 1) is pre-empted when MSS comes first.
  * Model 1: stage 2 (MSS or an opposing FVG inverted after the sweep) -> signal while
    filters pass (no expiry once at stage 2, as written).
    Model 2: stage 2 and the bar wicks through the EQ level and closes back.
    Model 3: stage 1 and close beyond the sweep bar's opposite extreme (CISD).
  * FVG = low[1] > high[3] (bull) / high[1] < low[3] (bear) with displacement bar [2];
    max 20 stored zones.
  * Filters: 2 of 3 HTF biases (1H / 4H / 1D: close vs EMA50) agree with the direction,
    and the last CLOSED 1H bar shows a fresh FVG (request.security lookahead_off).
  * Bracket: entry = signal close, stop = sweep extreme -/+ 0.25 ATR, target = 2R.
Execution: only signals on RTH 5m closes (09:30-15:50 ET) are traded, filled at the next
1m open + 1 tick, stop/target checked minute by minute (stop first, target must trade
through). $150 risk on MNQ, $1.24 RT commission.
  "script rules": hold until stop / target, flat 15:55.
  "Lucid rules":  + 60-minute max hold, FOMC/ISM blackout, 2-loss / -$400 day lock.
Usage: python smc_sim.py <raw_parquet_dir> <out_dir>
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
SWING, MAXZ, FIB, RR = 5, 20, 0.5, 2.0
MODELS = ("Model 1 IFVG", "Model 2 MSS+EQ", "Model 3 CISD")
ACCOUNTS = {"script rules": (dict(bt.RULES, max_hold=10 ** 6, max_losses=99, max_day_loss=-1e12), False),
            "Lucid rules": (bt.RULES, True)}


def load():
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    df = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    df = df[~df.index.duplicated()].sort_index()
    df.index = df.index.tz_localize("UTC").tz_convert(TZ)
    df = df[["open", "high", "low", "close", "volume"]]
    df.columns = ["o", "h", "l", "c", "v"]
    return df.loc[START:END + " 23:59"]


def agg(df, rule, **kw):
    return df.resample(rule, label="left", closed="left", **kw).agg(
        {"o": "first", "h": "max", "l": "min", "c": "last"}).dropna(subset=["o"])


def closed_map(b5_index, starts, ends):
    """index of the last HTF bar whose end <= the 5m bar's close (lookahead_off)."""
    order = np.argsort(ends.values)
    pos = np.searchsorted(ends.values[order], (b5_index + pd.Timedelta(minutes=5)).values, side="right") - 1
    return np.where(pos >= 0, order[np.maximum(pos, 0)], -1)


def main():
    os.makedirs(OUT, exist_ok=True)
    m1 = load()
    b5 = agg(m1, "5min")
    ts = b5.index
    o, h, l, c = (b5[k].values for k in "ohlc")
    n = len(b5)
    etmin = (ts.hour * 60 + ts.minute).values
    dates = ts.tz_localize(None).normalize()

    # ---- HTF series
    def bias_of(frame):
        return np.where(frame.c.values > frame.c.ewm(span=50, adjust=False).mean().values, 1, -1)

    h1 = agg(m1, "60min")
    h4 = agg(m1, "4h", offset="2h")  # 4H bars aligned to the 18:00 ET session open
    sess = (ts.tz_localize(None) + pd.Timedelta(hours=6)).floor("D")
    codes, _ = pd.factorize(sess)
    dC = b5.c.groupby(codes).last().values
    dBias = np.where(dC > pd.Series(dC).ewm(span=50, adjust=False).mean().values, 1, -1)
    is_last = np.r_[codes[1:] != codes[:-1], True]
    di = np.where(is_last, codes, codes - 1)
    biasD = np.where(di >= 0, dBias[np.maximum(di, 0)], 0)
    i1 = closed_map(ts, h1.index, h1.index + pd.Timedelta(hours=1))
    i4 = closed_map(ts, h4.index, h4.index + pd.Timedelta(hours=4))
    b1, b4 = bias_of(h1), bias_of(h4)
    bias1 = np.where(i1 >= 0, b1[np.maximum(i1, 0)], 0)
    bias4 = np.where(i4 >= 0, b4[np.maximum(i4, 0)], 0)
    hh, hl, ho, hc = h1.h.values, h1.l.values, h1.o.values, h1.c.values
    fv = np.zeros(len(h1), bool)
    fv[3:] = ((hl[2:-1] > hh[:-3]) & (hc[1:-2] > ho[1:-2])) | ((hh[2:-1] < hl[:-3]) & (hc[1:-2] < ho[1:-2]))
    htfFVG = np.where(i1 >= 0, fv[np.maximum(i1, 0)], False)

    # ---- 5m series
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values.copy()
    atr[:14] = np.nan
    hs, ls = pd.Series(h), pd.Series(l)
    ch, cl = hs.shift(SWING).values, ls.shift(SWING).values
    ph = np.where((ch > hs.shift(SWING + 1).rolling(SWING).max().values) & (ch >= hs.rolling(SWING).max().values), ch, np.nan)
    pl = np.where((cl < ls.shift(SWING + 1).rolling(SWING).min().values) & (cl <= ls.rolling(SWING).min().values), cl, np.nan)

    signals = {m: [] for m in MODELS}
    viz = dict(sweeps=[], lsh=np.full(n, np.nan), lsl=np.full(n, np.nan))
    for model in MODELS:
        lsh = lsl = np.nan
        dirn, stage, sweepL, cisdL, sweepBar, since, eq = 0, 0, np.nan, np.nan, -1, 0, np.nan
        zones = []  # [top, bot, dir, bar, active]
        for i in range(n):
            if ph[i] == ph[i]:
                lsh = ph[i]
            if pl[i] == pl[i]:
                lsl = pl[i]
            if model == MODELS[0]:
                viz["lsh"][i], viz["lsl"][i] = lsh, lsl
            if i >= 3:
                if l[i - 1] > h[i - 3] and c[i - 2] > o[i - 2]:
                    zones.append([l[i - 1], h[i - 3], 1, i - 2, True])
                    if len(zones) > MAXZ:
                        zones.pop(0)
                if h[i - 1] < l[i - 3] and c[i - 2] < o[i - 2]:
                    zones.append([l[i - 3], h[i - 1], -1, i - 2, True])
                    if len(zones) > MAXZ:
                        zones.pop(0)
            bull_sw = lsl == lsl and l[i] < lsl and c[i] > lsl
            bear_sw = lsh == lsh and h[i] > lsh and c[i] < lsh
            if bull_sw:
                dirn, stage, sweepL, cisdL, sweepBar, since = 1, 1, l[i], h[i], i, 0
            if bear_sw:
                dirn, stage, sweepL, cisdL, sweepBar, since = -1, 1, h[i], l[i], i, 0
            if model == MODELS[0] and (bull_sw or bear_sw):
                viz["sweeps"].append((i, -1 if bear_sw else 1))
            if stage >= 1:
                since += 1
            if stage == 1 and since > 60:
                stage, dirn = 0, 0
            if dirn == 1 and stage == 1 and lsh == lsh and c[i] > lsh:
                stage, eq = 2, sweepL + (lsh - sweepL) * (1 - FIB)
            if dirn == -1 and stage == 1 and lsl == lsl and c[i] < lsl:
                stage, eq = 2, sweepL - (sweepL - lsl) * (1 - FIB)
            bull_inv = bear_inv = False
            for z in zones:
                if z[4] and sweepBar >= 0 and z[3] > sweepBar:
                    if dirn == 1 and z[2] == -1 and c[i] > z[0]:
                        bull_inv, z[4] = True, False
                    if dirn == -1 and z[2] == 1 and c[i] < z[1]:
                        bear_inv, z[4] = True, False
            if model == MODELS[0] and stage == 1 and ((dirn == 1 and bull_inv) or (dirn == -1 and bear_inv)):
                stage = 2
            cnt = int(bias1[i] == dirn) + int(bias4[i] == dirn) + int(biasD[i] == dirn)
            ok = cnt >= 2 and bool(htfFVG[i])
            if model == MODELS[0]:
                lg, sg = dirn == 1 and stage == 2 and ok, dirn == -1 and stage == 2 and ok
            elif model == MODELS[1]:
                lg = dirn == 1 and stage == 2 and eq == eq and l[i] <= eq < c[i] and ok
                sg = dirn == -1 and stage == 2 and eq == eq and h[i] >= eq > c[i] and ok
            else:
                lg = dirn == 1 and stage == 1 and c[i] > cisdL and ok
                sg = dirn == -1 and stage == 1 and c[i] < cisdL and ok
            if lg or sg:
                side = 1 if lg else -1
                a = atr[i] if atr[i] == atr[i] else 0.0
                stop = min(sweepL, cisdL) - a * 0.25 if side == 1 else max(sweepL, cisdL) + a * 0.25
                risk = abs(c[i] - stop)
                signals[model].append(dict(i=i, side=side, px=float(c[i]), stop=float(stop),
                                           tp=float(c[i] + side * risk * RR)))
                stage, dirn = 0, 0

    # ---- execution
    t1 = m1.index.hour * 60 + m1.index.minute
    rth = m1[(t1 >= 570) & (t1 < 960) & (m1.index.dayofweek < 5)]
    recs = {}
    for d, g in rth.groupby(rth.index.date):
        if len(g) >= 300:
            recs[d] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32), m1=g[["o", "h", "l", "c"]].values)
    cal = sorted(recs)
    news = bt.news_windows(cal)
    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal),
                   signals_all_hours={m: len(v) for m, v in signals.items()})
    curves = {}
    for model, sl_ in signals.items():
        by_day = {}
        for s in sl_:
            if 570 <= etmin[s["i"]] < 950:
                by_day.setdefault(dates[s["i"]].date(), []).append(dict(s, t=int(etmin[s["i"]] + 5)))
        for acct, (rules, use_news) in ACCOUNTS.items():
            trades = []
            for d in cal:
                got = bt.run_day_mgmt(recs[d], by_day.get(d, []), "NQ", news.get(d, []) if use_news else [], 20, rules)
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
                                dd_date=str(ddc.idxmin()), rth_signals=sum(len(v) for v in by_day.values()),
                                exits=pd.Series([t_["why"] for t_ in trades], dtype=object).value_counts().to_dict())
            pd.DataFrame(trades).to_csv(os.path.join(OUT, f"smc_trades_{model.split()[1]}_{acct.split()[0]}.csv"),
                                        index=False)
            curves[key] = (trades, eqc, ddc)
            ov = summary[key]["overall"]
            print(f"{key:28s} trades {ov['trades']:5d} win {ov['win']:5.1f}% PF {ov['pf']:.2f} net ${ov['net']:10,.0f} "
                  f"maxDD ${ov['maxdd']:9,.0f} $/wk {ov['per_week']:7.1f} exits {summary[key]['exits']}", flush=True)
    json.dump(summary, open(os.path.join(OUT, "smc_summary.json"), "w"), indent=1, default=str)

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    BULL, BEAR = "#0ECB81", "#F6465D"
    COLS = {MODELS[0]: "#2962FF", MODELS[1]: "#E91E63", MODELS[2]: "#FFB74D"}
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10, "legend.facecolor": BG, "legend.edgecolor": GRID, "text.parse_math": False})
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7.5), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    for model in MODELS:
        trades, eqc, ddc = curves[f"{model} script rules"]
        s_ = summary[f"{model} script rules"]["overall"]
        x = pd.to_datetime(eqc.index)
        ax1.plot(x, eqc.values, color=COLS[model], lw=1.8,
                 label=f"{model}: net ${s_['net']:,.0f}, PF {s_['pf']:.2f}, {s_['trades']} trades")
        ax2.plot(x, ddc.values, color=COLS[model], lw=1.2, label=f"{model}: max DD ${s_['maxdd']:,.0f}")
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"SMC Sniper Pro on NQ / US100 5m, script rules at $150 risk  |  {cal[0]} to {cal[-1]}", loc="left")
    ax1.set_ylabel("Cumulative P&L ($, MNQ, after costs)")
    ax1.legend(loc="lower left", fontsize=9)
    ax1.grid(True, lw=0.6)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.text(pd.to_datetime(cal[0]), -1000, "  Lucid 25K max drawdown -$1,000", va="bottom", color="#FF9800", fontsize=9)
    ax2.set_ylabel("Drawdown ($)")
    ax2.legend(loc="lower left", fontsize=9)
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "smc_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample day: last day with >= 2 Model 1 trades (script rules), 06:30-16:00 ET
    trades = curves[f"{MODELS[0]} script rules"][0]
    cnt = pd.Series([t_["date"] for t_ in trades]).value_counts()
    day = max(d for d in cnt.index if cnt[d] >= 2)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 390) & (etmin < 960))[0]
    i0, i_1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8))
    for i in range(i0, i_1 + 1):
        if 420 <= etmin[i] < 600:
            ax.axvspan(i - 0.5, i + 0.5, color=BULL, alpha=0.06, lw=0)
        col = BULL if c[i] >= o[i] else BEAR
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
    for i, sd in viz["sweeps"]:
        if i0 <= i <= i_1:
            ax.scatter([i], [h[i] + 3 if sd < 0 else l[i] - 3], marker="x", s=30, color=BEAR if sd < 0 else BULL)
    ax.plot(range(i0, i_1 + 1), viz["lsh"][i0:i_1 + 1], color=BEAR, alpha=0.4, lw=1, drawstyle="steps-post")
    ax.plot(range(i0, i_1 + 1), viz["lsl"][i0:i_1 + 1], color=BULL, alpha=0.4, lw=1, drawstyle="steps-post")
    for t_ in [t_ for t_ in trades if t_["date"] == day]:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.hlines(t_["entry"], xe - 1, xe + 14, color=MUTED, lw=1, ls="--")
        ax.hlines(t_["stop"], xe - 1, xe + 14, color=BEAR, lw=1, ls="--")
        ax.hlines(t_["tp"], xe - 1, xe + 14, color=BULL, lw=1, ls="--")
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["tp"])), max(xx - xe, 1), abs(t_["tp"] - t_["entry"]),
                               color="#4CAF50", alpha=0.25, lw=0))
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([xe - 1], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=120,
                   color=BULL if t_["side"] > 0 else BEAR, zorder=5)
        ax.annotate(f"{'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (xe, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    lo_, hi2 = l[i0:i_1 + 1].min(), h[i0:i_1 + 1].max()
    pad = (hi2 - lo_) * 0.12
    ax.set_ylim(lo_ - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i_1 + 4)
    ticks = [k for k in range(i0, i_1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    dp = sum(t_["pnl"] for t_ in trades if t_["date"] == day)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  SMC Sniper Pro Model 1  |  sweeps x, last swing high/low steps, "
                 f"entry gray / SL red / TP green (2R), NY killzone green  |  day P&L {'+' if dp >= 0 else '-'}${abs(dp):.0f}",
                 loc="left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "smc_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
