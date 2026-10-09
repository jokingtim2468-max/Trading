"""Replay one day as the MT5 bot sees it: locked session lines + short-term 80% bands and projected candles.

    python tools/bot_video.py --date 2026-10-08

* Regular session 9:30-16:00: two lines locked at 9:30 (10-year model, fitted on days before this one).
* After-market 16:00-09:00: two lines locked at 4 PM (median of the previous 250 sessions).
* Every bar: an 80% band for the next hour and 12 projected 5-minute candles.
  - The band is the standard volatility method: the 10th-90th percentile of past 1..12-bar moves,
    measured in 5-minute ATRs (so it widens with the square root of time and with volatility).
    It's built only from days before the replayed day, separately for the regular session and for
    off-hours.
  - Projected candles show the typical candle size and wicks for that time of day, centered on the
    median path. Their direction isn't known: the colour only shows the price model's lean, which
    tested at about 52%.
* At the end it counts how often the price one hour later really landed inside the 80% band.
"""

import argparse
import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import train_drp as T  # noqa: E402
import replay_video as R  # noqa: E402
from ai import fixed_model as FM, session_model as S  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.animation import FFMpegWriter  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

BG, PANEL, GRID, TEXT, MUTED = R.BG, R.PANEL, R.GRID, R.TEXT, R.MUTED
GREEN, RED, BAND, GHOST = R.GREEN, R.RED, "#4FC3F7", "#9FA8DA"
H = 12                      # projection horizon: 12 x 5 min = 1 hour
Q_LO, Q_HI = 0.10, 0.90     # 80% band


from ai.band_model import is_rth, calibrate  # noqa: E402


def lean(m5, day):
    """Price-model lean (probability of higher in 1 hour) for each bar. The model and its day tables are
    refitted here on days before `day`, so the replay has no hindsight."""
    import json
    from ai import short_model as SM
    m = json.loads((ROOT / "ai/model.json").read_text())["symbols"]["NQ"]
    d = T.yahoo("NQ=F", "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    r = T.live_bars(T.yahoo("NQ=F", "730d", "1h"), d, m["atr_days"], T.MARKETS["NQ"]["session"])
    live = T.fit_live(r[r.day < day])
    tr = np.maximum(d.h, d.c.shift()) - np.minimum(d.l, d.c.shift())
    F, _ = SM.features(m5, tr.rolling(m["atr_days"]).mean().shift().to_dict(), live)
    fwd = m5.c.shift(-SM.HOLD_BARS) - m5.c
    ok = F.notna().all(axis=1)
    train = ok & fwd.notna() & (F.index.date < day)
    mu, sd = F[train].mean(), F[train].std().replace(0, 1)
    coef = SM.fit_logistic(((F[train] - mu) / sd).to_numpy(), (fwd[train] > 0).astype(float).to_numpy())
    p = pd.Series(np.nan, index=F.index)
    p[ok] = SM.predict(F[ok], {"mu": mu.tolist(), "sd": sd.tolist(), "coef": coef.tolist()})
    return p


def frame(fig, ax, bars, k, ctx, lines, final=False):
    ax.clear()
    ax.set_facecolor(BG)
    n = len(bars)
    end_x = n + 3
    shown = bars.iloc[:k + 1]
    cur = shown.iloc[-1]
    for i, b in enumerate(shown.itertuples()):
        up = b.c >= b.o
        col = R.CANDLE_UP if up else R.CANDLE_DN
        ax.plot([i, i], [b.l, b.h], color=col, lw=0.8)
        lo_, hi_ = min(b.o, b.c), max(b.o, b.c)
        ax.add_patch(Rectangle((i - 0.35, lo_), 0.7, max(hi_ - lo_, ctx["atr_day"] * 0.002),
                               facecolor=BG if up else col, edgecolor=col, lw=0.8))
    for x1, x2, hi, lo, name in lines:
        if k >= x1:
            ax.plot([x1, x2], [hi, hi], color=GREEN, lw=2.4)
            ax.plot([x1, x2], [lo, lo], color=RED, lw=2.4)
            ax.text(x2 + 0.3, hi, f" ▲ {name} {R.fmt(hi, 'NQ')}", color=GREEN, fontsize=10, va="center", fontweight="bold")
            ax.text(x2 + 0.3, lo, f" ▼ {name} {R.fmt(lo, 'NQ')}", color=RED, fontsize=10, va="center", fontweight="bold")
    if not final and np.isfinite(cur.atr):
        q = ctx["cal"]["rth" if is_rth(cur.name) else "off"]
        xs = [k] + [k + h for h in range(1, H + 1)]
        lo = [cur.c] + [cur.c + q[h][0] * cur.atr for h in range(1, H + 1)]
        hi = [cur.c] + [cur.c + q[h][2] * cur.atr for h in range(1, H + 1)]
        mid = [cur.c] + [cur.c + q[h][1] * cur.atr for h in range(1, H + 1)]
        ax.fill_between(xs, lo, hi, color=BAND, alpha=0.13, lw=0)
        ax.plot(xs, hi, color=BAND, lw=1, alpha=0.8)
        ax.plot(xs, lo, color=BAND, lw=1, alpha=0.8)
        p = cur.p if np.isfinite(cur.p) else 0.5
        gcol = GREEN if p >= 0.5 else RED
        for h in range(1, H + 1):
            t = cur.name + pd.Timedelta(minutes=5 * h)
            body, top, bot = ctx["cal"]["shape"][t.hour]
            c0 = mid[h]
            bh = body * cur.atr
            ax.add_patch(Rectangle((k + h - 0.32, c0 - bh / 2), 0.64, max(bh, ctx["atr_day"] * 0.002),
                                   facecolor=gcol, alpha=0.18, edgecolor=GHOST, lw=0.8, ls="--"))
            ax.plot([k + h, k + h], [c0 + bh / 2, c0 + bh / 2 + top * cur.atr], color=GHOST, lw=0.8, alpha=0.7)
            ax.plot([k + h, k + h], [c0 - bh / 2, c0 - bh / 2 - bot * cur.atr], color=GHOST, lw=0.8, alpha=0.7)
        ax.text(k + H + 0.6, hi[-1], f" 80% band {R.fmt(hi[-1], 'NQ')}", color=BAND, fontsize=9, va="bottom")
        ax.text(k + H + 0.6, lo[-1], f" {R.fmt(lo[-1], 'NQ')}", color=BAND, fontsize=9, va="top")
    lo_y = min(bars.l.min(), min(l[3] for l in lines)) - 0.08 * ctx["atr_day"]
    hi_y = max(bars.h.max(), max(l[2] for l in lines)) + 0.08 * ctx["atr_day"]
    ax.set_ylim(lo_y, hi_y)
    ax.set_xlim(-2, end_x + 22)
    ticks = [i for i, t in enumerate(bars.index) if t.minute == 0 and t.hour % 2 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([bars.index[i].strftime("%-I %p").lower() for i in ticks], color=MUTED, fontsize=10)
    ax.tick_params(axis="y", colors=MUTED, labelsize=10)
    ax.yaxis.tick_right()
    ax.grid(color=GRID, lw=0.8)
    for s in ax.spines.values():
        s.set_visible(False)
    R.clear_texts(fig)
    R.keep(fig, fig.text(0.03, 0.955, f"Nasdaq e-mini / US100  ·  MT5 bot replay  ·  {pd.Timestamp(ctx['date']):%a %b %-d, %Y}",
                         color=TEXT, fontsize=17, fontweight="bold"))
    R.keep(fig, fig.text(0.03, 0.918, "Green/red = locked high/low (never move) · blue = 80% band for the next hour · "
                         "dashed candles = projected candle size · no hindsight", color=MUTED, fontsize=11))
    R.keep(fig, fig.text(0.97, 0.955, f"{cur.name:%-I:%M %p} ET", color=TEXT, fontsize=17, fontweight="bold", ha="right"))
    hits, n = ctx["score"](k)
    p = cur.p if np.isfinite(cur.p) else 0.5
    R.keep(fig, fig.text(0.97, 0.918, f"price {R.fmt(cur.c, 'NQ')} · lean {'UP' if p >= 0.5 else 'DOWN'} {max(p, 1 - p):.0%}"
                         + (f" · band held {hits}/{n} ({hits / n:.0%})" if n else ""), color=MUTED, fontsize=12, ha="right"))
    R.keep(fig, fig.text(0.03, 0.02, "Educational replay. Not financial advice. The band is a probability range, not a promise.",
                         color=MUTED, fontsize=10))


def zoom(ax, bars, k, ctx, lines):
    """Close-up of the last 2 hours plus the projected hour: real candles, projected candles, 80% band."""
    ax.clear()
    ax.set_facecolor(PANEL)
    cur = bars.iloc[k]
    lo_i = max(0, k - 24)
    seg = bars.iloc[lo_i:k + 1]
    xs0 = list(range(lo_i - k, 1))
    for x, b in zip(xs0, seg.itertuples()):
        up = b.c >= b.o
        col = R.CANDLE_UP if up else R.CANDLE_DN
        ax.plot([x, x], [b.l, b.h], color=col, lw=1)
        lo_, hi_ = min(b.o, b.c), max(b.o, b.c)
        ax.add_patch(Rectangle((x - 0.35, lo_), 0.7, max(hi_ - lo_, cur.atr * 0.01), facecolor=PANEL if up else col,
                               edgecolor=col, lw=1))
    ys = [seg.l.min(), seg.h.max()]
    if np.isfinite(cur.atr):
        q = ctx["cal"]["rth" if is_rth(cur.name) else "off"]
        hx = list(range(0, H + 1))
        lo = [cur.c] + [cur.c + q[h][0] * cur.atr for h in range(1, H + 1)]
        hi = [cur.c] + [cur.c + q[h][2] * cur.atr for h in range(1, H + 1)]
        mid = [cur.c] + [cur.c + q[h][1] * cur.atr for h in range(1, H + 1)]
        ax.fill_between(hx, lo, hi, color=BAND, alpha=0.15, lw=0)
        ax.plot(hx, hi, color=BAND, lw=1.2)
        ax.plot(hx, lo, color=BAND, lw=1.2)
        p = cur.p if np.isfinite(cur.p) else 0.5
        gcol = GREEN if p >= 0.5 else RED
        for h in range(1, H + 1):
            t = cur.name + pd.Timedelta(minutes=5 * h)
            body, top, bot = ctx["cal"]["shape"][t.hour]
            bh = body * cur.atr
            ax.add_patch(Rectangle((h - 0.32, mid[h] - bh / 2), 0.64, max(bh, cur.atr * 0.01), facecolor=gcol, alpha=0.25,
                                   edgecolor=GHOST, lw=1, ls="--"))
            ax.plot([h, h], [mid[h] + bh / 2, mid[h] + bh / 2 + top * cur.atr], color=GHOST, lw=1)
            ax.plot([h, h], [mid[h] - bh / 2, mid[h] - bh / 2 - bot * cur.atr], color=GHOST, lw=1)
        ys += [min(lo), max(hi)]
        ax.text(H + 0.4, hi[-1], f"{R.fmt(hi[-1], 'NQ')}", color=BAND, fontsize=9, va="center")
        ax.text(H + 0.4, lo[-1], f"{R.fmt(lo[-1], 'NQ')}", color=BAND, fontsize=9, va="center")
    pad = (ys[1] - ys[0]) * 0.08
    ax.set_ylim(ys[0] - pad, ys[1] + pad)
    ax.set_xlim(lo_i - k - 1, H + 4)
    ax.axvline(0.5, color=MUTED, lw=0.8, ls=":")
    ax.set_xticks([lo_i - k, 0, H])
    ax.set_xticklabels([bars.index[lo_i].strftime("%-I:%M"), "now", "+1 h"], color=MUTED, fontsize=9)
    ax.tick_params(axis="y", colors=MUTED, labelsize=8)
    ax.yaxis.tick_right()
    for s_ in ax.spines.values():
        s_.set_color(GRID)
    p = cur.p if np.isfinite(cur.p) else 0.5
    ax.set_title(f"Next hour, zoomed · 80% band · lean {'UP' if p >= 0.5 else 'DOWN'} {max(p, 1 - p):.0%}",
                 color=TEXT, fontsize=11, loc="left")


def result(fig, ctx, rows):
    fig.clf()
    fig.patch.set_facecolor(BG)
    fig.text(0.5, 0.88, "What the bot called vs. what happened", color=TEXT, fontsize=30, fontweight="bold", ha="center")
    fig.text(0.5, 0.82, f"Nasdaq e-mini / US100 · {pd.Timestamp(ctx['date']):%a %b %-d, %Y} · this day was never used for training",
             color=MUTED, fontsize=15, ha="center")
    xs = (0.22, 0.44, 0.62, 0.80)
    for x, h in zip(xs, ("", "Locked line", "Actual", "Miss")):
        fig.text(x, 0.72, h, color=MUTED, fontsize=16, ha="center")
    for i, (lab, col, p, a) in enumerate(rows):
        y = 0.63 - i * 0.095
        fig.add_artist(FancyBboxPatch((0.08, y - 0.04), 0.84, 0.08, boxstyle="round,pad=0.005,rounding_size=0.012",
                                      transform=fig.transFigure, fc=PANEL, ec="none", zorder=0))
        fig.text(xs[0], y, lab, color=col, fontsize=19, fontweight="bold", ha="center", va="center")
        fig.text(xs[1], y, R.fmt(p, "NQ"), color=TEXT, fontsize=19, ha="center", va="center")
        fig.text(xs[2], y, R.fmt(a, "NQ"), color=TEXT, fontsize=19, ha="center", va="center")
        fig.text(xs[3], y, f"{abs(p - a):,.0f} pts", color=TEXT, fontsize=19, ha="center", va="center")
    hits, n = ctx["score"](10 ** 9)
    fig.text(0.5, 0.20, f"80% band: the price one hour later landed inside it {hits} of {n} times ({hits / max(n, 1):.0%}) on this day "
             f"· {ctx['cal']['test_cover']:.0%} on {ctx['cal']['test_days']} earlier test days", color=BAND, fontsize=15, ha="center")
    fig.text(0.5, 0.15, "Direction lean tested at ~52%: candle colours are a lean, not a call.", color=MUTED, fontsize=13, ha="center")
    fig.text(0.5, 0.09, "Educational replay. Not financial advice.", color=MUTED, fontsize=12, ha="center")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True, help="the regular-session date (YYYY-MM-DD)")
    ap.add_argument("--start", default="08:00", help="first bar shown (New York time)")
    a = ap.parse_args()
    day = dt.date.fromisoformat(a.date)
    m5 = T.yahoo("NQ=F", "60d", "5m")
    m5 = m5[m5.v > 0]
    d = T.yahoo("NQ=F", "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    nxt = min(x for x in set(m5.index.date) if x > day)
    sh, sm = (int(x) for x in a.start.split(":"))
    hm = m5.index.hour * 60 + m5.index.minute
    bars = m5[((m5.index.date == day) & (hm >= sh * 60 + sm)) | ((m5.index.date > day) & (m5.index.date < nxt)) |
              ((m5.index.date == nxt) & (hm < 540))].copy()
    tr = np.maximum(m5.h, m5.c.shift()) - np.minimum(m5.l, m5.c.shift())
    bars["atr"] = tr.rolling(14).mean().reindex(bars.index)
    bars["p"] = lean(m5, day).reindex(bars.index)

    cal = calibrate(m5, day)
    nd = S.rth_daily(T.yahoo)
    i930 = next(i for i, t in enumerate(bars.index) if t.date() == day and (t.hour, t.minute) >= (9, 30))
    i16 = next(i for i, t in enumerate(bars.index) if t.date() == day and t.hour >= 16)
    rth_hi, rth_lo, _ = FM.lines(nd, day, FM.train(nd, before=day, years=10), open_price=float(bars.o.iloc[i930]))
    t_ah = S.ah_table(T.yahoo("NQ=F", "730d", "1h"), d)
    ah_hi, ah_lo, _ = S.ah_lines(t_ah, day, open_price=float(bars.o.iloc[i16]))
    lines = [(i930, i16, rth_hi, rth_lo, "9:30"), (i16, len(bars) - 1, ah_hi, ah_lo, "4 PM")]
    atr_day = float((np.maximum(d.h, d.c.shift()) - np.minimum(d.l, d.c.shift())).rolling(20).mean().shift().loc[day])

    # band check: did the close 12 bars later land inside the band drawn at bar j?
    checks = []
    for j in range(len(bars) - H):
        b = bars.iloc[j]
        if not np.isfinite(b.atr):
            continue
        lo, _, hi = cal["rth" if is_rth(b.name) else "off"][H]
        fut = bars.c.iloc[j + H]
        checks.append((j + H, bool(b.c + lo * b.atr <= fut <= b.c + hi * b.atr)))

    def score(k):
        done = [ok for at, ok in checks if at <= k]
        return sum(done), len(done)

    ctx = {"date": day, "cal": cal, "atr_day": atr_day, "score": score}
    rth = bars.iloc[i930:i16]
    ahb = bars.iloc[i16:]
    rows = [("9:30 HIGH", GREEN, rth_hi, rth.h.max()), ("9:30 LOW", RED, rth_lo, rth.l.min()),
            ("4 PM HIGH", GREEN, ah_hi, ahb.h.max()), ("4 PM LOW", RED, ah_lo, ahb.l.min())]

    out = ROOT / "videos" / f"DRP_BOT_NQ_{day}.mp4"
    fig = plt.figure(figsize=(19.2, 10.8), dpi=100)
    fig.patch.set_facecolor(BG)
    writer = FFMpegWriter(fps=R.FPS, bitrate=8000, codec="libx264", extra_args=["-pix_fmt", "yuv420p"])
    with writer.saving(fig, str(out), dpi=100):
        R.card(fig, [("What would the MT5 bot have shown yesterday?", TEXT),
                     ("Locked high/low lines + an 80% band and projected candles every 5 minutes", MUTED)],
               sub=f"Nasdaq e-mini / US100 · {pd.Timestamp(day):%A %B %-d, %Y} · never used for training")
        for _ in range(int(R.FPS * 2.5)):
            writer.grab_frame()
        fig.clf()
        fig._drp_texts = []
        fig.patch.set_facecolor(BG)
        ax = fig.add_axes([0.03, 0.08, 0.60, 0.80])
        axz = fig.add_axes([0.70, 0.16, 0.25, 0.64])
        for k in range(i930 - 6, len(bars)):
            frame(fig, ax, bars, k, ctx, lines)
            zoom(axz, bars, k, ctx, lines)
            reps = 30 if k in (i930, i16) else (4 if k < i16 else 2)
            for _ in range(reps):
                writer.grab_frame()
        frame(fig, ax, bars, len(bars) - 1, ctx, lines, final=True)
        axz.remove()
        for _ in range(int(R.FPS * 2)):
            writer.grab_frame()
        result(fig, ctx, rows)
        for _ in range(int(R.FPS * 7)):
            writer.grab_frame()
    plt.close(fig)

    hits, n = score(10 ** 9)
    desc = [f"Title: What My MT5 Bot Predicted for the Nasdaq Yesterday — Locked Lines + 80% Bands ({pd.Timestamp(day):%b %-d, %Y})", "",
            "Description:",
            f"A no-hindsight replay of {pd.Timestamp(day):%A %B %-d, %Y} on Nasdaq e-mini (US100) as the MT5 bot draws it. "
            "Green and red lines lock at 9:30 for the regular session and at 4 PM for the after-market, and never move. "
            "Every 5 minutes the bot projects the next hour: a blue 80% band (the 10th to 90th percentile of past moves, "
            "scaled by volatility) and dashed candles showing the typical candle size. Nothing from this day was used to "
            "train it.", ""]
    desc += [f"  {lab}: locked {p:,.2f}, actual {a_:,.2f} (miss {abs(p - a_):,.0f} pts)" for lab, _, p, a_ in rows]
    desc += [f"  80% band held {hits}/{n} times ({hits / max(n, 1):.0%}) that day; {cal['test_cover']:.0%} on earlier test days.", "",
             "Educational content, not financial advice. No prediction is 100% certain.", "",
             "#nasdaq #us100 #mt5 #daytrading #trading #futures #ai"]
    out.with_suffix(".txt").write_text("\n".join(desc) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    print("\n".join(desc[5:5 + len(rows) + 1]))


if __name__ == "__main__":
    main()
