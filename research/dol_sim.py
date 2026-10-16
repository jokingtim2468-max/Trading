"""Simulate the TradingView script "TradeAxis DOL (Draw on Liquidity)" on NQ (US100)
5-minute bars, bar by bar, and trade toward the DOL line.

Port notes (matching TradingView's historical behaviour):
  * Chart = NQ continuous futures, 5-minute, full 24h session (TradingView default).
  * request.security(..., lookahead_off) on historical bars only sees a higher-timeframe
    bar once it has closed, so "pdh"/"pdl" (high[1]/low[1] of 1D) are TWO sessions old
    for most of the day, sessOpen is the previous session's open, and htfBias is from
    the last closed daily bar. Daily bars use the CME session (18:00-17:00 ET).
  * Everything else (pivots, FVG/OB detection, eviction by lowest score, sweep /
    inversion / ejection, scoring, DOL index handling, LVN bins) follows the script.
Trading rule (the script has none - this is the literal "trade to the line"):
  * When a NEW DOL target appears on a closed RTH 5m bar, enter at market toward it.
    Target = DOL line price, stop = same distance on the other side (1:1).
    Skip lines closer than 0.5 x ATR(14).
  * Lucid-style rules from bt.py: $150 risk on MNQ ($2/pt), $1.24 RT commission,
    1 tick slippage on market fills, limit TP must trade through, 60 min max hold,
    2 losses / -$400 day lock, flat 15:55 ET, FOMC/ISM blackout.
Usage: python dol_sim.py <raw_parquet_dir> <out_dir> [fixed]
  "fixed": the script never removes dead (inactive) levels, so after ~18 months of
  history its 14 slots fill with them and the DOL stops updating. "fixed" evicts
  dead levels first, which matches how the script behaves on a freshly loaded chart.
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
FIXED = len(sys.argv) > 3 and sys.argv[3] == "fixed"  # evict dead levels first (bug fix)
START, END = "2015-01-01", "2025-05-30"
P = dict(L=5, R=5, maxPool=14, maxAtr=3.0, halfLife=150.0, minFvgAtr=0.25, mitCl=3, lvnLook=100)
TRADE = dict(min_dist_atr=0.5, max_trades=20)
BULL_TYPES = {"BSL", "FVGB", "OBB", "IFVGB", "BRKB"}
TZ = "America/New_York"


def load():
    files = sorted(glob.glob(os.path.join(RAW, "NQ_1min_20*.parquet")))
    df = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
    df = df[~df.index.duplicated()].sort_index()
    df.index = df.index.tz_localize("UTC").tz_convert(TZ)
    df = df[["open", "high", "low", "close", "volume"]]
    df.columns = ["o", "h", "l", "c", "v"]
    return df.loc[START:END + " 23:59"]


def resample(df, rule):
    return df.resample(rule, label="left", closed="left").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"}).dropna(subset=["o"])


def htf_map(b5_index, frame, rule_end):
    """For each 5m bar: index of the last HTF bar that has CLOSED by the 5m bar's close."""
    ends = frame.index + rule_end
    return np.searchsorted(ends.values, (b5_index + pd.Timedelta(minutes=5)).values, side="right") - 1


def main():
    os.makedirs(OUT, exist_ok=True)
    m1 = load()
    b5 = resample(m1, "5min")
    ts = b5.index
    o, h, l, c = (b5[k].values for k in "ohlc")
    n = len(b5)
    etmin = (ts.hour * 60 + ts.minute).values

    # ---- daily (CME session 18:00-17:00) with lookahead_off semantics
    sess = (ts.tz_localize(None) + pd.Timedelta(hours=6)).floor("D")
    codes, uniq = pd.factorize(sess)
    dO = b5.o.groupby(codes).first().values
    dH = b5.h.groupby(codes).max().values
    dL = b5.l.groupby(codes).min().values
    dC = b5.c.groupby(codes).last().values
    dEma = pd.Series(dC).ewm(span=50, adjust=False).mean().values
    dBias = np.sign(dC - dEma)
    is_last = np.r_[codes[1:] != codes[:-1], True]
    d = np.where(is_last, codes, codes - 1)
    pdh = np.where(d >= 1, dH[np.maximum(d - 1, 0)], np.nan)
    pdl = np.where(d >= 1, dL[np.maximum(d - 1, 0)], np.nan)
    sopen = np.where(d >= 0, dO[np.maximum(d, 0)], np.nan)
    htf = np.where(d >= 0, dBias[np.maximum(d, 0)], np.nan)
    eq = (pdh + pdl) / 2

    # ---- 1H series for LVN, and 60/15 bias for the table
    h1 = resample(m1, "60min")
    hi = htf_map(ts, h1, pd.Timedelta(hours=1))
    h1c, h1v, h1t = h1.c.values[hi], h1.v.values[hi], hi

    # ---- ATR(14) (RMA), stdev(close,10), pivots, FVGs
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values.copy()
    atr[:14] = np.nan
    sd = pd.Series(c).rolling(P["L"] + P["R"]).std(ddof=0).values
    L, R = P["L"], P["R"]
    hs, ls = pd.Series(h), pd.Series(l)
    ch, cl = hs.shift(R).values, ls.shift(R).values
    ph = np.where((ch > hs.shift(R + 1).rolling(L).max().values) & (ch >= hs.rolling(R).max().values), ch, np.nan)
    pl = np.where((cl < ls.shift(R + 1).rolling(L).min().values) & (cl <= ls.rolling(R).min().values), cl, np.nan)
    o1, c1, h1_, l1 = np.r_[np.nan, o[:-1]], np.r_[np.nan, c[:-1]], np.r_[np.nan, h[:-1]], np.r_[np.nan, l[:-1]]
    h2, l2 = np.r_[np.nan, np.nan, h[:-2]], np.r_[np.nan, np.nan, l[:-2]]
    o2, c2 = np.r_[np.nan, np.nan, o[:-2]], np.r_[np.nan, np.nan, c[:-2]]
    body, rng = np.abs(c1 - o1), h1_ - l1
    with np.errstate(invalid="ignore", divide="ignore"):
        bullF = (h2 < l) & (rng > 0) & (body / rng >= 0.5) & (c1 > o1) & (body >= atr * P["minFvgAtr"])
        bearF = (l2 > h) & (rng > 0) & (body / rng >= 0.5) & (c1 < o1) & (body >= atr * P["minFvgAtr"])

    # ---- bar-by-bar port of the pool / scoring / DOL logic
    pool = []          # [top, bot, typ, born, active, dens, mitcl, score, lid]
    levels = []        # lid -> dict(add, born, top, bot, types=[(bar,typ)], end, evicted)
    segs = []          # DOL lines: [start, p0, end, p_end, bullish]
    newDol = np.zeros(n, bool)
    dolP = np.full(n, np.nan)
    lvnA, lvnB = np.full(n, np.nan), np.full(n, np.nan)
    activeIdx = -1
    bins, binLow, binHigh, lastH1, h1Count = [0.0] * 20, np.nan, np.nan, -1, 0

    def add(top, bot, typ, born, dens, i):
        if len(pool) >= P["maxPool"] and len(pool) > 1:
            ev = min(range(len(pool)), key=lambda k: ((pool[k][4] if FIXED else 0), pool[k][7], k))
            gone = pool.pop(ev)
            levels[gone[8]]["evicted"] = i
        lid = len(levels)
        levels.append(dict(add=i, born=born, top=top, bot=bot, types=[(i, typ)], end=None, evicted=None))
        pool.append([top, bot, typ, born, True, dens, 0, 0.0, lid])

    for i in range(n):
        a = atr[i]
        aok = a == a and a > 0
        ci, hi_, li = c[i], h[i], l[i]
        if ph[i] == ph[i]:
            add(ph[i], ph[i], "BSL", i - R, 100.0 - min(100.0, sd[i] / a * 50.0) if aok else 50.0, i)
        if pl[i] == pl[i]:
            add(pl[i], pl[i], "SSL", i - R, 100.0 - min(100.0, sd[i] / a * 50.0) if aok else 50.0, i)
        if bullF[i]:
            add(li, h2[i], "FVGB", i, 60.0, i)
            if c2[i] < o2[i]:
                add(h2[i], l2[i], "OBB", i, 60.0, i)
        if bearF[i]:
            add(l2[i], hi_, "FVGR", i, 60.0, i)
            if c2[i] > o2[i]:
                add(h2[i], l2[i], "OBR", i, 60.0, i)
        # mitigation / inversion / ejection
        for e in pool:
            if not e[4]:
                continue
            typ, top, bot = e[2], e[0], e[1]
            lvl = top if typ in ("BSL", "SSL") else (top + bot) / 2
            dist = abs(ci - lvl) / a if aok else 0.0
            ejected = dist > P["maxAtr"]
            swept = (typ == "BSL" and hi_ >= top) or (typ == "SSL" and li <= top)
            if typ == "FVGB" and ci < bot:
                e[2], e[6] = "IFVGB", 0
            if typ == "FVGR" and ci > top:
                e[2], e[6] = "IFVGR", 0
            if typ == "OBB" and ci < bot:
                e[2] = "BRKB"
            if typ == "OBR" and ci > top:
                e[2] = "BRKR"
            cur = e[2]
            if cur in ("IFVGB", "IFVGR") and bot <= ci <= top:
                e[6] += 1
            if cur != typ:
                levels[e[8]]["types"].append((i, cur))
            if ejected or swept or e[6] > P["mitCl"]:
                e[4] = False
                levels[e[8]]["end"] = i
        # scoring
        best, bestS = -1, -1.0
        for k, e in enumerate(pool):
            if not e[4]:
                continue
            top, bot = e[0], e[1]
            lvl = top if e[2] in ("BSL", "SSL") else (top + bot) / 2
            dist = abs(ci - lvl) / a if aok else 0.0
            prox = max(0.0, 100.0 * (1.0 - dist / P["maxAtr"]))
            fresh = 100.0 * 0.5 ** ((i - e[3]) / P["halfLife"])
            conf = 0.0
            if aok:
                if abs(lvl - pdh[i]) / a < 0.25:
                    conf += 25.0
                if abs(lvl - pdl[i]) / a < 0.25:
                    conf += 25.0
                if abs(lvl - eq[i]) / a < 0.25:
                    conf += 20.0
                if abs(lvl - sopen[i]) / a < 0.25:
                    conf += 15.0
            if lvl > ci and htf[i] > 0:
                conf += 15.0
            if lvl < ci and htf[i] < 0:
                conf += 15.0
            total = prox * 0.35 + fresh * 0.20 + min(100.0, conf) * 0.25 + e[5] * 0.20
            e[7] = total
            if total > bestS:
                bestS, best = total, k
        # DOL target (keeps the script's index-based change detection)
        if best != -1 and best != activeIdx:
            if segs:
                segs[-1][2] = i
            activeIdx = best
            p0 = pool[best][0]
            segs.append([i, p0, None, p0, pool[best][2] in BULL_TYPES])
            newDol[i], dolP[i] = True, p0
        elif best != -1:
            segs[-1][3] = pool[best][0]
        # 1H LVN bins
        if h1t[i] != lastH1 and h1t[i] >= 0:
            lastH1 = h1t[i]
            h1Count += 1
            if (binLow != binLow) or h1Count % P["lvnLook"] == 0:
                binLow, binHigh = li - a * 10 if aok else np.nan, hi_ + a * 10 if aok else np.nan
                bins = [0.0] * 20
            span = binHigh - binLow
            if span > 0:
                bins[int(min(19.0, max(0.0, math.floor((h1c[i] - binLow) / span * 20))))] += h1v[i]
        span = binHigh - binLow
        if span > 0 and 540 <= etmin[i] < 960:
            mA = mB = None
            for k in range(20):
                v = bins[k]
                if v > 0:
                    bp = binLow + span * (k + 0.5) / 20
                    if bp > ci and (mA is None or v < mA):
                        mA, lvnA[i] = v, bp
                    if bp < ci and (mB is None or v < mB):
                        mB, lvnB[i] = v, bp
        if i % 100000 == 0:
            print(f"  bar {i}/{n}", flush=True)

    # ---- trades toward the DOL line (RTH only)
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
    for i in np.where(newDol & (etmin >= 570) & (etmin < 950))[0]:
        a = atr[i]
        dist = abs(dolP[i] - c[i])
        if not (a > 0) or dist < TRADE["min_dist_atr"] * a:
            continue
        side = 1 if dolP[i] > c[i] else -1
        sigs.setdefault(dates[i].date(), []).append(dict(
            t=int(etmin[i] + 5), side=side, px=float(c[i]), stop=float(c[i] - side * dist), tp=float(dolP[i]),
            kind="mkt", expiry=0, tag=str(i)))
    trades = []
    for dday in cal:
        for tr_ in bt.run_day(recs[dday], sigs.get(dday, []), "NQ", news.get(dday, []), TRADE["max_trades"]):
            tr_["date"] = dday
            trades.append(tr_)

    # ---- luck test: same trades, direction flipped at random
    mirror = []
    for tr_ in trades:
        dist = abs(tr_["tp"] - tr_["stop"]) / 2
        px = tr_["tp"] - tr_["side"] * dist
        s = -tr_["side"]
        m = bt.run_day(recs[tr_["date"]], [dict(t=tr_["t_in"], side=s, px=px, stop=px - s * dist, tp=px + s * dist,
                                                 kind="mkt", expiry=0)], "NQ", news.get(tr_["date"], []), 1)
        mirror.append(m[0]["pnl"] if m else 0.0)
    real = np.array([t_["pnl"] for t_ in trades])
    mirror = np.array(mirror)
    rng_ = np.random.default_rng(3)
    flips = rng_.random((2000, len(real))) < 0.5
    rand_net = np.where(flips, mirror, real).sum(axis=1)

    # ---- stats
    allst = bt.stats(trades, len(cal))
    years = {}
    for y in sorted({dd.year for dd in cal}):
        yd = [dd for dd in cal if dd.year == y]
        years[y] = bt.stats([t_ for t_ in trades if t_["date"].year == y], len(yd))
    daily = pd.Series({dd: 0.0 for dd in cal})
    for t_ in trades:
        daily[t_["date"]] += t_["pnl"]
    eqc = daily.cumsum()
    ddc = eqc - eqc.cummax()
    worst_day = float(daily.min())
    hit = float(np.mean([t_["why"] == "tp" for t_ in trades]) * 100)
    summary = dict(period=[str(cal[0]), str(cal[-1])], days=len(cal), signals=int(sum(len(v) for v in sigs.values())),
                   overall=allst, years={str(k): v for k, v in years.items()}, worst_day=worst_day,
                   dd_date=str(ddc.idxmin()), tp_hit_pct=hit, random_mean=float(rand_net.mean()),
                   random_p95=float(np.percentile(rand_net, 95)), p_value=float((rand_net >= real.sum()).mean()),
                   lucid_breach_days=int((ddc <= -1000).sum()))
    json.dump(summary, open(os.path.join(OUT, "dol_summary.json"), "w"), indent=1, default=str)
    pd.DataFrame(trades).to_csv(os.path.join(OUT, "dol_trades.csv"), index=False)
    print(json.dumps(summary, indent=1, default=str))

    # ---- charts
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
    TEAL, ORANGE, GRAY, UP, DN = "#089981", "#FF9800", "#787B86", "#089981", "#F23645"
    plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                         "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                         "font.size": 10})

    # equity + drawdown (two panels, one axis each)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
    x = pd.to_datetime(eqc.index)
    ax1.plot(x, eqc.values, color="#2962FF", lw=2)
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.set_title(f"DOL script{' (dead-level fix)' if FIXED else ' (as written)'}, traded to the line on NQ / US100 5m  |  {cal[0]} to {cal[-1]}  |  "
                  f"net ${allst['net']:,.0f}, PF {allst['pf']:.2f}, {allst['trades']} trades", loc="left")
    ax1.set_ylabel("Cumulative P&L ($, MNQ, after costs)")
    ax1.grid(True, lw=0.6)
    ax2.fill_between(x, ddc.values, 0, color=DN, alpha=0.35, lw=0)
    ax2.plot(x, ddc.values, color=DN, lw=1.2)
    ax2.axhline(-1000, color=ORANGE, lw=1.2, ls="--")
    ax2.text(x[0], -1000, "  Lucid 25K max drawdown -$1,000", va="bottom", color=ORANGE, fontsize=9)
    ax2.set_ylabel("Drawdown ($)")
    ax2.grid(True, lw=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "dol_equity_drawdown.png"), dpi=130)
    plt.close(fig)

    # sample session: last day with >= 2 trades
    td = pd.Series([t_["date"] for t_ in trades]).value_counts()
    day = max(dd for dd in td.index if td[dd] >= 2)
    w = np.where((dates == pd.Timestamp(day)) & (etmin >= 540) & (etmin < 960))[0]
    i0, i1 = w[0], w[-1]
    fig, ax = plt.subplots(figsize=(15, 8))
    for i in range(i0, i1 + 1):
        col = UP if c[i] >= o[i] else DN
        ax.vlines(i, l[i], h[i], color=col, lw=1)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), 0.25), color=col))
    for lv in levels:
        if lv["add"] > i1 or (lv["evicted"] is not None and lv["evicted"] <= i1):
            continue
        ended = lv["end"] is not None and lv["end"] <= i1
        if ended and lv["end"] <= lv["add"]:
            continue  # deactivated before it was ever drawn
        typ = [t_ for b_, t_ in lv["types"] if b_ <= i1][-1]
        x0, x1 = max(lv["born"], i0), (lv["end"] if ended else i1)
        if x1 < i0:
            continue
        if typ in ("BSL", "SSL"):
            if ended:
                ax.hlines(lv["top"], x0, x1, color=GRAY, alpha=0.45, lw=1, ls=":")
            else:
                ax.hlines(lv["top"], x0, x1, color=TEAL if typ == "BSL" else ORANGE, lw=1, ls="--")
        elif not ended:
            colz = TEAL if typ in ("FVGB", "OBB", "IFVGB", "BRKB") else ORANGE
            alpha = 0.15 if typ in ("FVGB", "OBB", "FVGR", "OBR") else 0.30
            ax.add_patch(Rectangle((x0, min(lv["top"], lv["bot"])), x1 - x0, abs(lv["top"] - lv["bot"]),
                                   color=colz, alpha=alpha, lw=1))
    for s0, p0, e0, pe, bull in segs:
        if s0 > i1 or (e0 is not None and e0 < i0):
            continue
        if e0 is not None and e0 <= i1:
            ax.plot([max(s0, i0), e0], [p0, pe], color=GRAY, alpha=0.45, lw=1.5, ls=":")
        else:
            ax.plot([max(s0, i0), i1 + 3], [p0, pe], color=TEAL if bull else ORANGE, lw=2.5)
    ax.scatter(range(i0, i1 + 1), lvnA[i0:i1 + 1], s=10, color=ORANGE, alpha=0.6)
    ax.scatter(range(i0, i1 + 1), lvnB[i0:i1 + 1], s=10, color=TEAL, alpha=0.6)
    day_tr = [t_ for t_ in trades if t_["date"] == day]
    for t_ in day_tr:
        xe = i0 + (t_["t_in"] - etmin[i0]) / 5
        xx = i0 + (t_["t_out"] - etmin[i0]) / 5
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["tp"])), max(xx - xe, 1), abs(t_["tp"] - t_["entry"]),
                               color="#4CAF50", alpha=0.25, lw=0))
        ax.add_patch(Rectangle((xe, min(t_["entry"], t_["stop"])), max(xx - xe, 1), abs(t_["stop"] - t_["entry"]),
                               color="#F44336", alpha=0.25, lw=0))
        ax.scatter([xe], [t_["entry"]], marker="^" if t_["side"] > 0 else "v", s=120,
                   color=UP if t_["side"] > 0 else DN, zorder=5)
        ax.annotate(f"{'LONG' if t_['side'] > 0 else 'SHORT'} {t_['n']} MNQ\n{t_['why'].upper()} "
                    f"{'+' if t_['pnl'] >= 0 else '-'}${abs(t_['pnl']):.0f}", (xe, t_["entry"]),
                    xytext=(6, 14 if t_["side"] > 0 else -30), textcoords="offset points", fontsize=8, color=TXT)
    lo_, hi2 = l[i0:i1 + 1].min(), h[i0:i1 + 1].max()
    pad = (hi2 - lo_) * 0.15
    ax.set_ylim(lo_ - pad, hi2 + pad)
    ax.set_xlim(i0 - 1, i1 + 8)
    ticks = [k for k in range(i0, i1 + 1) if etmin[k] % 60 == 0 or etmin[k] == 570]
    ax.set_xticks(ticks, [f"{etmin[k] // 60:02d}:{etmin[k] % 60:02d}" for k in ticks])
    ax.grid(True, lw=0.5)
    bias = {1.0: "Bullish", -1.0: "Bearish"}.get(htf[i1], "Neutral")
    ax.text(0.99, 0.98, f"D bias: {bias}", transform=ax.transAxes, ha="right", va="top",
            bbox=dict(facecolor="#2a2e39", edgecolor=GRID))
    dpnl = sum(t_["pnl"] for t_ in day_tr)
    ax.set_title(f"NQ / US100 5m  {day}  (ET)  |  DOL line = thick teal/orange, ghost trail = dotted gray, "
                 f"TP zone green / SL zone red  |  day P&L {'+' if dpnl >= 0 else '-'}${abs(dpnl):.0f}", loc="left")
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "dol_sample_day.png"), dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
