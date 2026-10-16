"""Simulate the TradingView script "iFVG Ultimate+" on NQ (US100) 5-minute bars and
trade its own lines.

Port notes:
  * Bar-by-bar port of the sweep -> FVG -> inversion state machine (pending zones are
    tested before new ones are added, confirmations allowed until age 16, confirmed
    zones invalidated on a close back through the gap), exactly as in the script.
  * SMT (QQQ) only feeds the "grade" panel; QQQ data is not available here, so SMT is
    treated as false. It does not affect any entry, stop or line.
Trading rule (the script's own lines):
  * Entry = close of the 5m bar that confirms the iFVG (filled at the next open +1 tick).
  * Stop  = the script's SL line (gap edge +/- 0.25 ATR).
  * Break-even line (1R): once price trades to it the stop moves to the entry fill.
  * No target line exists, so the trade exits on the script's invalidation (5m close
    back through the gap), the 60-minute max hold, 15:55 ET, or the news blackout.
  * Variant "2R target": same plus a 2R take-profit limit.
  * Only confirmations during RTH (09:30-15:50 ET) are traded. Lucid rules from bt.py:
    $150 risk on MNQ ($2/pt), $1.24 RT commission, 1 tick slippage on market fills,
    limit TP must trade through, max 20 micros, 2 losses / -$400 day lock.
Usage: python ifvg_sim.py <raw_parquet_dir> <out_dir>
"""
import glob
import json
import math
import os
import sys

import numpy as np
import pandas as pd

import bt

RAW, OUT = sys.argv[1], sys.argv[2]
START, END = "2015-01-01", "2025-05-30"
P = dict(swing=5, atrMult=1.2, invWindow=15, sweepLook=10, stopAtr=0.25)
TZ = "America/New_York"


def load():
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    df = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    df = df[~df.index.duplicated()].sort_index()
    df.index = df.index.tz_localize("UTC").tz_convert(TZ)
    df = df[["open", "high", "low", "close", "volume"]]
    df.columns = ["o", "h", "l", "c", "v"]
    return df.loc[START:END + " 23:59"]


def run_day_be(rec, sigs, news, tp_r=None, rules=bt.RULES):
    """bt.run_day with break-even stop management and a per-signal forced exit time."""
    tick, pv = bt.SPEC["NQ"]["tick"], bt.SPEC["NQ"]["pv"]
    slip, comm = tick * rules["slip"], rules["comm"]
    T, M = rec["m1_t"], rec["m1"]
    idx = {int(t): i for i, t in enumerate(T)}
    flat_t = rules["flat"]
    flatten_at = [ev - 2 for ev, _, _ in news]
    trades, free_t, losses, dpnl = [], 0, 0, 0.0
    for s in sorted(sigs, key=lambda x: x["t"]):
        if losses >= rules["max_losses"] or dpnl <= rules["max_day_loss"]:
            break
        if s["t"] < free_t or s["t"] >= flat_t - 5 or s["t"] not in idx:
            continue
        side, px, stop0 = s["side"], s["px"], s["stop"]
        if side * (px - stop0) <= 0:
            continue
        risk = abs(px - stop0)
        n = min(rules["max_micros"], int(math.floor(rules["risk"] / ((risk + 2 * slip) * pv + comm))))
        if n < 1:
            continue
        k = idx[s["t"]]
        te = int(T[k])
        if any(a <= te < b for _, a, b in news):
            continue
        entry = M[k, 0] + side * slip
        be = px + side * risk
        tp = px + side * tp_r * risk if tp_r else None
        stop, moved = stop0, False
        cands = [te + rules["max_hold"], flat_t] + [f for f in flatten_at if f > te]
        if s.get("inval_t") is not None and s["inval_t"] > te:
            cands.append(s["inval_t"])
        deadline = min(cands)
        exit_px, why = None, None
        while k < len(T):
            o, h, l, c = M[k]
            if T[k] >= deadline:
                exit_px = o - side * slip
                why = "invalidated" if s.get("inval_t") == T[k] else "time"
                break
            if (l <= stop) if side > 0 else (h >= stop):
                exit_px = (min(stop, o) if side > 0 else max(stop, o)) - side * slip
                why = "breakeven" if moved else "stop"
                break
            if tp is not None and ((h >= tp + tick) if side > 0 else (l <= tp - tick)):
                exit_px, why = (max(tp, o) if side > 0 else min(tp, o)), "tp"
                break
            if not moved and ((h >= be) if side > 0 else (l <= be)):
                stop, moved = entry, True  # takes effect from the next minute
            k += 1
        if exit_px is None:
            k = len(T) - 1
            exit_px, why = M[k, 3] - side * slip, "eod"
        pnl = side * (exit_px - entry) * pv * n - comm * n
        trades.append(dict(t_in=te, t_out=int(T[k]), side=side, n=n, entry=entry, exit=exit_px, stop=stop0,
                           be=be, tp=tp, pnl=pnl, R=pnl / (risk * pv * n), why=why, grade=s["grade"]))
        dpnl += pnl
        losses += pnl < 0
        free_t = int(T[k]) + 1
    return trades


def main():
    os.makedirs(OUT, exist_ok=True)
    m1 = load()
    b5 = m1.resample("5min", label="left", closed="left").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"}).dropna(subset=["o"])
    ts = b5.index
    o, h, l, c = (b5[k].values for k in "ohlc")
    n = len(b5)
    etmin = (ts.hour * 60 + ts.minute).values
    hourNY = ts.hour.values

    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values.copy()
    atr[:14] = np.nan
    L = R = P["swing"]
    hs, ls = pd.Series(h), pd.Series(l)
    ch, cl = hs.shift(R).values, ls.shift(R).values
    ph = np.where((ch > hs.shift(R + 1).rolling(L).max().values) & (ch >= hs.rolling(R).max().values), ch, np.nan)
    pl = np.where((cl < ls.shift(R + 1).rolling(L).min().values) & (cl <= ls.rolling(R).min().values), cl, np.nan)
    o1, c1 = np.r_[np.nan, o[:-1]], np.r_[np.nan, c[:-1]]
    h1, l1 = np.r_[np.nan, h[:-1]], np.r_[np.nan, l[:-1]]
    h2, l2 = np.r_[np.nan, np.nan, h[:-2]], np.r_[np.nan, np.nan, l[:-2]]
    body, rng = np.abs(c1 - o1), h1 - l1
    with np.errstate(invalid="ignore", divide="ignore"):
        disp = (rng > 0) & (body / rng >= 0.6) & (body >= atr * P["atrMult"])
    bearF = (l2 > h) & disp
    bullF = (h2 < l) & disp

    lsh = lsl = np.nan
    lsh_arr, lsl_arr = np.full(n, np.nan), np.full(n, np.nan)
    sweepH = sweepL = None
    pending = []    # dict(top, bot, bar, typ, end)
    confirmed = []  # dict(id, top, bot, typ)
    confs = []      # every confirmation
    zones_log = []  # every pending zone (for drawing)
    for i in range(n):
        if ph[i] == ph[i]:
            lsh = ph[i]
        if pl[i] == pl[i]:
            lsl = pl[i]
        lsh_arr[i], lsl_arr[i] = lsh, lsl
        sh = lsh == lsh and h[i] > lsh and c[i] < lsh
        sl = lsl == lsl and l[i] < lsl and c[i] > lsl
        if sh:
            sweepH = i
        if sl:
            sweepL = i
        a = atr[i]
        # 1) pending zones: inversion or expiry
        for z in list(reversed(pending)):
            resolved = False
            if z["typ"] == -1 and c[i] > z["top"] and i > z["bar"]:
                stop = z["bot"] - a * P["stopAtr"]
                cf = dict(id=len(confs), bar=i, zbar=z["bar"], side=1, entry=c[i], stop=stop,
                          be=c[i] + (c[i] - stop), top=z["top"], bot=z["bot"], inval=None)
                resolved = True
            elif z["typ"] == 1 and c[i] < z["bot"] and i > z["bar"]:
                stop = z["top"] + a * P["stopAtr"]
                cf = dict(id=len(confs), bar=i, zbar=z["bar"], side=-1, entry=c[i], stop=stop,
                          be=c[i] - (stop - c[i]), top=z["top"], bot=z["bot"], inval=None)
                resolved = True
            if resolved:
                sess_now = hourNY[i] >= 20 or 2 <= hourNY[i] < 5
                cf["grade"] = "B" if (1 + int(disp[i]) + int(sess_now)) == 3 else "C"  # SMT unavailable
                confs.append(cf)
                confirmed.append(cf)
                pending.remove(z)
                z["end"] = i
            elif i - z["bar"] > P["invWindow"]:
                pending.remove(z)
                z["end"] = i
        # 2) confirmed zones: invalidation
        for cf in list(reversed(confirmed)):
            if (cf["side"] == 1 and c[i] < cf["bot"]) or (cf["side"] == -1 and c[i] > cf["top"]):
                cf["inval"] = i
                confirmed.remove(cf)
        # 3) new pending zones
        if bearF[i] and sweepH is not None and i - sweepH <= P["sweepLook"]:
            z = dict(top=l2[i], bot=h[i], bar=i, typ=-1, end=None)
            pending.append(z)
            zones_log.append(z)
        if bullF[i] and sweepL is not None and i - sweepL <= P["sweepLook"]:
            z = dict(top=l[i], bot=h2[i], bar=i, typ=1, end=None)
            pending.append(z)
            zones_log.append(z)

    # ---- trades
    dates = ts.tz_localize(None).normalize()
    t1 = m1.index.hour * 60 + m1.index.minute
    rth = m1[(t1 >= 570) & (t1 < 960) & (m1.index.dayofweek < 5)]
    recs = {}
    for dday, g in rth.groupby(rth.index.date):
        if len(g) >= 300:
            recs[dday] = dict(m1_t=(g.index.hour * 60 + g.index.minute).values.astype(np.int32),
                              m1=g[["o", "h", "l", "c"]].values)
    cal = sorted(recs)
    news = bt.news_windows(cal)
    sigs = {}
    for cf in confs:
        i = cf["bar"]
        if not (570 <= etmin[i] < 950) or not (atr[i] > 0):
            continue
        dday = dates[i].date()
        inval_t = None
        if cf["inval"] is not None and dates[cf["inval"]].date() == dday:
            inval_t = int(etmin[cf["inval"]] + 5)
        sigs.setdefault(dday, []).append(dict(t=int(etmin[i] + 5), side=cf["side"], px=float(cf["entry"]),
                                              stop=float(cf["stop"]), inval_t=inval_t, grade=cf["grade"], cid=cf["id"]))
    results = {}
    for name, tp_r in (("script_lines", None), ("2R_target", 2.0)):
        trades = []
        for dday in cal:
            for tr_ in run_day_be(recs[dday], sigs.get(dday, []), news.get(dday, []), tp_r):
                tr_["date"] = dday
                trades.append(tr_)
        results[name] = trades

    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal),
                   confirmations_total=len(confs), rth_signals=int(sum(len(v) for v in sigs.values())))
    for name, trades in results.items():
        daily = pd.Series({dd: 0.0 for dd in cal})
        for t_ in trades:
            daily[t_["date"]] += t_["pnl"]
        eqc = daily.cumsum()
        ddc = eqc - eqc.cummax()
        years = {}
        for y in sorted({dd.year for dd in cal}):
            yd = [dd for dd in cal if dd.year == y]
            years[str(y)] = bt.stats([t_ for t_ in trades if t_["date"].year == y], len(yd))
        why = pd.Series([t_["why"] for t_ in trades]).value_counts().to_dict()
        summary[name] = dict(overall=bt.stats(trades, len(cal)), years=years, exits=why,
                             avg_R=float(np.mean([t_["R"] for t_ in trades])), worst_day=float(daily.min()),
                             dd_date=str(ddc.idxmin()))
        pd.DataFrame(trades).to_csv(os.path.join(OUT, f"ifvg_trades_{name}.csv"), index=False)
        results[name] = (trades, eqc, ddc)
    json.dump(summary, open(os.path.join(OUT, "ifvg_summary.json"), "w"), indent=1, default=str)
    print(json.dumps(summary, indent=1, default=str))

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    TEAL, MAROON, UP, DN = "#089981", "#880E4F", "#089981", "#F23645"
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10})

    trades, eqc, ddc = results["script_lines"]
    st = summary["script_lines"]["overall"]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    x = pd.to_datetime(eqc.index)
    ax1.plot(x, eqc.values, color="#2962FF", lw=2)
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"iFVG Ultimate+ traded on its own lines, NQ / US100 5m  |  {cal[0]} to {cal[-1]}  |  "
                  f"net ${st['net']:,.0f}, PF {st['pf']:.2f}, {st['trades']} trades", loc="left")
    ax1.set_ylabel("Cumulative P&L ($, MNQ, after costs)")
    ax1.grid(True, lw=0.6)
    ax2.fill_between(x, ddc.values, 0, color=DN, alpha=0.35, lw=0)
    ax2.plot(x, ddc.values, color=DN, lw=1.2)
    ax2.axhline(-1000, color="#FF9800", lw=1.2, ls="--")
    ax2.text(x[0], -1000, "  Lucid 25K max drawdown -$1,000", va="bottom", color="#FF9800", fontsize=9)
    ax2.set_ylabel("Drawdown ($)")
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "ifvg_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample session: last day with >= 2 trades, 07:00-16:00 ET
    td = pd.Series([t_["date"] for t_ in trades]).value_counts()
    day = max(dd for dd in td.index if td[dd] >= 2)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 420) & (etmin < 960))[0]
    i0, i1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8))
    for i in range(i0, i1 + 1):
        if 2 <= hourNY[i] < 5:
            ax.axvspan(i - 0.5, i + 0.5, color="#9C27B0", alpha=0.08, lw=0)
        col = UP if c[i] >= o[i] else DN
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
        if etmin[i] == 510:
            ax.annotate("DATA.H", (i, h[i]), xytext=(0, 8), textcoords="offset points", ha="center", fontsize=7,
                        color="white", bbox=dict(facecolor="#FF9800", edgecolor="none", pad=1))
            ax.annotate("DATA.L", (i, l[i]), xytext=(0, -14), textcoords="offset points", ha="center", fontsize=7,
                        color="white", bbox=dict(facecolor="#FF9800", edgecolor="none", pad=1))
    ax.scatter(range(i0, i1 + 1), lsh_arr[i0:i1 + 1], s=6, color=DN, alpha=0.5)
    ax.scatter(range(i0, i1 + 1), lsl_arr[i0:i1 + 1], s=6, color=UP, alpha=0.5)
    for z in zones_log:  # pending zones still open at the end of the window (boxes are deleted when resolved)
        if z["bar"] <= i1 and (z["end"] is None or z["end"] > i1) and z["bar"] >= i0 - 20:
            ax.add_patch(Rectangle((z["bar"] - 2, min(z["top"], z["bot"])), i1 + 8 - (z["bar"] - 2),
                                   abs(z["top"] - z["bot"]), facecolor=(0.47, 0.48, 0.53, 0.15),
                                   edgecolor=MAROON if z["typ"] == -1 else TEAL))
    for cf in confs:
        if i0 <= cf["bar"] <= i1:
            col = TEAL if cf["side"] > 0 else MAROON
            lvl = cf["top"] if cf["side"] > 0 else cf["bot"]
            ax.hlines(lvl, cf["zbar"], cf["bar"], color=col, lw=2.5)
            ax.annotate("iFVG+" if cf["side"] > 0 else "iFVG-", (cf["bar"], lvl),
                        xytext=(0, -16 if cf["side"] > 0 else 10), textcoords="offset points", ha="center",
                        fontsize=8, color="white", bbox=dict(facecolor=col, edgecolor="none", pad=1.5))
            x2 = cf["bar"] + P["invWindow"]
            ax.hlines(cf["entry"], cf["bar"], x2, color=col, lw=1.2, ls=":")
            ax.hlines(cf["stop"], cf["bar"], x2, color="#F44336", lw=1.2, ls="--")
            ax.hlines(cf["be"], cf["bar"], x2, color="#FFEB3B", lw=1.2, ls="--")
    for t_ in [t_ for t_ in trades if t_["date"] == day]:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([xe], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=120,
                   color=UP if t_["side"] > 0 else DN, zorder=5)
        ax.annotate(f"{'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (xe, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    lo_, hi2 = l[i0:i1 + 1].min(), h[i0:i1 + 1].max()
    pad = (hi2 - lo_) * 0.12
    ax.set_ylim(lo_ - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i1 + 8)
    ticks = [k for k in range(i0, i1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    dpnl = sum(t_["pnl"] for t_ in trades if t_["date"] == day)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  entry dotted, SL red dashed, BE yellow dashed, pending FVG gray box, "
                 f"London purple  |  day P&L {'+' if dpnl >= 0 else '-'}${abs(dpnl):.0f}", loc="left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "ifvg_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
