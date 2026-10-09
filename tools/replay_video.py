"""Render a replay video of one trading day with the Day Range Predictor's live lines.

The day is replayed bar by bar from 9:30 New York time. Every line on every frame uses only
the bars up to that moment, the same way the MT5 EA and TradingView script compute it. The
tables are fitted only on days before the replayed day, so the video has no hindsight. At the
end the 9:30 call is compared with what really happened.

    python tools/replay_video.py --symbol NQ --date 2026-10-08
    python tools/replay_video.py --symbol GC                     # latest day (partial if still trading)

Writes videos/DRP_<symbol>_<date>.mp4 plus a .txt with a title and description.
Needs: pip install -r tools/requirements.txt matplotlib, and ffmpeg on PATH.
"""

import argparse
import datetime as dt
import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_drp as T  # noqa: E402

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.animation import FFMpegWriter  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

ROOT = T.ROOT
BG, PANEL, GRID, TEXT, MUTED = "#0E1117", "#161B26", "#1F2533", "#E6E9EF", "#8A90A0"
GREEN, RED, YELLOW = "#00E676", "#FF5252", "#FFD600"
CANDLE_UP, CANDLE_DN = "#C9CED8", "#5B6478"
FPS = 30
SHOW_BUILD = False     # yellow build-up line (off by default; --build turns it on)
plt.rcParams["font.family"] = ["Inter", "DejaVu Sans"]


# ---------------------------------------------------------------- model replay
def replay(symbol_key, date):
    mk = T.MARKETS[symbol_key]
    daily = T.yahoo(mk["yahoo"], "10y", "1d")[["o", "h", "l", "c"]]
    daily.index = daily.index.date
    h1 = T.yahoo(mk["yahoo"], "730d", "1h")
    m5 = T.yahoo(mk["yahoo"], "60d", "5m")
    m5 = m5[m5.v > 0] if (m5.v > 0).any() else m5
    m5["day"] = (m5.index + pd.Timedelta(hours=6)).date
    if date is None:
        date = m5.day.iloc[-1]
    lines = T.train_lines(daily)
    hb = T.live_bars(h1, daily, lines["atr"], mk["session"])
    tab = T.fit_live(hb[hb.day < date])                         # no hindsight: fitted before the replay day
    env = T.line_table(daily, lines["lookback"], lines["atr"], [lines["outer"]])
    tr = np.maximum(daily.h, daily.c.shift()) - np.minimum(daily.l, daily.c.shift())
    atr = float(tr.rolling(lines["atr"]).mean().shift().loc[date])
    bars = m5[m5.day == date].copy()
    if bars.empty:
        raise SystemExit(f"No 5-minute bars for {date}")

    step = T.PROF_STEP * atr
    base = bars.o.iloc[0] - T.PROF_HALF * step
    prof = np.zeros(2 * T.PROF_HALF + 1)
    t0 = bars.index[0]
    hs, ls = -np.inf, np.inf
    out = []
    for ts, b in bars.iterrows():
        hs, ls = max(hs, b.h), min(ls, b.l)
        b0 = max(0, int(np.floor((b.l - base) / step)))
        b1 = min(len(prof) - 1, int(np.floor((b.h - base) / step)))
        if b1 >= b0:
            prof[b0:b1 + 1] += 1
        poc = base + (np.argmax(prof) + 0.5) * step
        hr = min(23, int((ts - t0).total_seconds() // 3600))
        pos = 1 if hs <= ls else min(2, int((b.c - ls) / (hs - ls) * 3))
        lh = hs + tab["up"][hr * 3 + pos] * atr
        ll = ls - tab["dn"][hr * 3 + pos] * atr
        w = tab["w"][hr]
        bu = (lh + ll) / 2 * (1 - w) + poc * w
        out.append(dict(ts=ts, o=b.o, h=b.h, l=b.l, c=b.c, hs=hs, ls=ls, lh=lh, ll=ll, bu=bu, poc=poc,
                        thi=t0 + pd.Timedelta(hours=tab["thi"][hr]), tlo=t0 + pd.Timedelta(hours=tab["tlo"][hr])))
    df = pd.DataFrame(out).set_index("ts")
    e = env.loc[date]
    info = dict(key=symbol_key, name=mk["name"], date=date, atr=atr, t0=t0,
                maxhi=e.o + e[f"u{lines['outer']}"] * e.atr, maxlo=e.o - e[f"d{lines['outer']}"] * e.atr,
                outer=lines["outer"], complete=bars.index[-1].hour * 60 + bars.index[-1].minute >= 16 * 60 + 55)
    return df, info


# ---------------------------------------------------------------- drawing
def keep(fig, artist):
    """Remember figure-level text so the next frame can remove it."""
    fig.__dict__.setdefault("_drp_texts", []).append(artist)
    return artist


def clear_texts(fig):
    for a in fig.__dict__.get("_drp_texts", []):
        a.remove()
    fig._drp_texts = []


def fmt(x, key):
    return f"{x:,.2f}" if key == "NQ" else f"${x:,.2f}"


def draw_frame(fig, ax, df, info, k, call, title_alpha=0.0, final=False):
    ax.clear()
    ax.set_facecolor(BG)
    n = len(df)
    xs = np.arange(n)
    shown = df.iloc[:k + 1]
    cur = shown.iloc[-1]
    end_x = n + 6

    # max envelope (set at the day open)
    ax.axhline(info["maxhi"], color=GREEN, lw=1, ls=(0, (6, 4)), alpha=0.35)
    ax.axhline(info["maxlo"], color=RED, lw=1, ls=(0, (6, 4)), alpha=0.35)
    ax.text(1, info["maxhi"], f"  max high P{info['outer']:g}", color=GREEN, alpha=0.5, fontsize=9, va="bottom")
    ax.text(1, info["maxlo"], f"  max low P{info['outer']:g}", color=RED, alpha=0.5, fontsize=9, va="top")

    # 9:30 call (ghost lines across the rest of the day)
    if call is not None:
        ci = call["i"]
        for y, c in ((call["lh"], GREEN), (call["ll"], RED)) + (((call["bu"], YELLOW),) if SHOW_BUILD else ()):
            ax.plot([ci, end_x], [y, y], color=c, lw=1, ls=(0, (2, 3)), alpha=0.55)
        ax.text(end_x, call["lh"], " 9:30 call", color=GREEN, fontsize=9, va="center", alpha=0.8)
        ax.text(end_x, call["ll"], " 9:30 call", color=RED, fontsize=9, va="center", alpha=0.8)
        ax.axvline(ci - 0.5, color=MUTED, lw=1, alpha=0.4)
        ax.text(ci - 0.3, 1.0, " 9:30 OPEN", transform=ax.get_xaxis_transform(), color=MUTED, fontsize=9, va="top")

    # candles
    for i, b in enumerate(shown.itertuples()):
        up = b.c >= b.o
        col = CANDLE_UP if up else CANDLE_DN
        alpha = 0.55 if call is not None and i < call["i"] else 1.0
        ax.plot([i, i], [b.l, b.h], color=col, lw=0.8, alpha=alpha)
        lo, hi = min(b.o, b.c), max(b.o, b.c)
        ax.add_patch(Rectangle((i - 0.35, lo), 0.7, max(hi - lo, info["atr"] * 0.002),
                               facecolor=BG if up else col, edgecolor=col, lw=0.8, alpha=alpha))

    # live lines (step history up to now)
    ax.step(xs[:k + 1], shown.lh, where="post", color=GREEN, lw=2.2)
    ax.step(xs[:k + 1], shown.ll, where="post", color=RED, lw=2.2)
    if SHOW_BUILD:
        ax.step(xs[:k + 1], shown.bu, where="post", color=YELLOW, lw=2.2)

    # reached-line dots
    for side, col in (("h", GREEN), ("l", RED)):
        prev_line = shown.lh.shift() if side == "h" else shown.ll.shift()
        prev_ext = (shown.lh.shift() - shown.hs.shift()) if side == "h" else (shown.ls.shift() - shown.ll.shift())
        tol = 0.03 * info["atr"]
        hit = (prev_ext > tol) & ((shown.h >= prev_line - tol) if side == "h" else (shown.l <= prev_line + tol))
        if hit.any():
            j = int(np.argmax(hit.values))
            y = shown.h.iloc[j] if side == "h" else shown.l.iloc[j]
            ax.scatter([j], [y], s=70, color=col, zorder=5, edgecolor=BG, linewidth=1.5)

    if not final:
        # flow lines from the current bar
        def tx(t):
            return min(end_x - 1, max(k + 2, (t - df.index[0]).total_seconds() / 300))
        for target_t, y, c, ext in ((cur.thi, cur.lh, GREEN, cur.lh - cur.hs), (cur.tlo, cur.ll, RED, cur.ls - cur.ll)):
            if ext > 0.005 * info["atr"]:
                x2 = tx(target_t)
                ax.annotate("", xy=(x2, y), xytext=(k, cur.c),
                            arrowprops=dict(arrowstyle="-|>", color=c, lw=1.6, ls=(0, (4, 3)), mutation_scale=16))
                if SHOW_BUILD:
                    ax.plot([x2, end_x], [y, cur.bu], color=YELLOW, lw=1.2, ls=(0, (1, 3)), alpha=0.9)
        # right-edge value tags
        tags = ((cur.lh, GREEN, "▲ HIGH"),) + (((cur.bu, YELLOW, "◆ BUILD-UP"),) if SHOW_BUILD else ()) + ((cur.ll, RED, "▼ LOW"),)
        for y, c, lab in tags:
            ax.text(k + 1.5, y, f"{lab} {fmt(y, info['key'])}", color=BG, fontsize=10, fontweight="bold", va="center",
                    bbox=dict(boxstyle="round,pad=0.3", fc=c, ec="none"))

    # axes cosmetics
    ax.set_xlim(-2, end_x + 14)
    lo = min(df.l.min(), df.ll.min()) - 0.08 * info["atr"]       # max lines show only when they're in view
    hi = max(df.h.max(), df.lh.max()) + 0.08 * info["atr"]
    ax.set_ylim(lo, hi)
    ticks = [i for i, t in enumerate(df.index) if t.minute == 0 and t.hour % 2 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([df.index[i].strftime("%-I %p").lower() for i in ticks], color=MUTED, fontsize=10)
    ax.tick_params(axis="y", colors=MUTED, labelsize=10)
    ax.yaxis.tick_right()
    ax.grid(color=GRID, lw=0.8)
    for s in ax.spines.values():
        s.set_visible(False)

    # header
    clear_texts(fig)
    keep(fig, fig.text(0.03, 0.955, f"{info['name']}  ·  Day Range Predictor  ·  {pd.Timestamp(info['date']):%a %b %-d, %Y}",
             color=TEXT, fontsize=17, fontweight="bold"))
    keep(fig, fig.text(0.03, 0.918, ("Green = predicted day high   Yellow = build-up / support   Red = predicted day low   " if SHOW_BUILD else
                       "Green = predicted day high   Red = predicted day low   ")
             + "· every line uses only data available at that moment", color=MUTED, fontsize=11))
    keep(fig, fig.text(0.97, 0.955, f"{cur.name:%-I:%M %p} ET", color=TEXT, fontsize=17, fontweight="bold", ha="right"))
    keep(fig, fig.text(0.97, 0.918, f"price {fmt(cur.c, info['key'])}", color=MUTED, fontsize=12, ha="right"))
    keep(fig, fig.text(0.03, 0.02, "Educational replay. Not financial advice. Predictions are estimates, not guarantees.",
                       color=MUTED, fontsize=10))


def card(fig, lines, sub=None, big=34):
    fig.clf()
    fig.patch.set_facecolor(BG)
    y = 0.62
    for i, (txt, col) in enumerate(lines):
        fig.text(0.5, y - i * 0.09, txt, color=col, fontsize=big if i == 0 else 22, ha="center",
                 fontweight="bold" if i == 0 else "normal")
    if sub:
        fig.text(0.5, 0.12, sub, color=MUTED, fontsize=13, ha="center")


def result_card(fig, df, info, call):
    fig.clf()
    fig.patch.set_facecolor(BG)
    k = info["key"]
    act_hi, act_lo = df.h.max(), df.l.min()
    act_bu = df.poc.iloc[-1]
    rows = [("Day HIGH", GREEN, call["lh"], act_hi)] + ([("Build-up", YELLOW, call["bu"], act_bu)] if SHOW_BUILD else []) + \
        [("Day LOW", RED, call["ll"], act_lo)]
    title = "9:30 call vs. what really happened" if info["complete"] else "9:30 call vs. the day so far (still trading)"
    fig.text(0.5, 0.86, title, color=TEXT, fontsize=30, fontweight="bold", ha="center")
    fig.text(0.5, 0.80, f"{info['name']} · {pd.Timestamp(info['date']):%a %b %-d, %Y}", color=MUTED, fontsize=15, ha="center")
    xs = (0.2, 0.42, 0.62, 0.82)
    for x, h in zip(xs, ("", "Predicted at 9:30", "Actual" if info["complete"] else "So far", "Miss")):
        fig.text(x, 0.68, h, color=MUTED, fontsize=16, ha="center")
    for i, (lab, col, p, a) in enumerate(rows):
        y = 0.58 - i * 0.12
        fig.add_artist(FancyBboxPatch((0.08, y - 0.045), 0.84, 0.09, boxstyle="round,pad=0.005,rounding_size=0.015",
                                      transform=fig.transFigure, fc=PANEL, ec="none", zorder=0))
        miss = abs(p - a)
        unit = f"{miss:,.0f} pts" if k == "NQ" else f"${miss:,.2f}"
        fig.text(xs[0], y, lab, color=col, fontsize=22, fontweight="bold", ha="center", va="center")
        fig.text(xs[1], y, fmt(p, k), color=TEXT, fontsize=22, ha="center", va="center")
        fig.text(xs[2], y, fmt(a, k), color=TEXT, fontsize=22, ha="center", va="center")
        fig.text(xs[3], y, f"{unit}  ({miss / info['atr']:.2f} ATR)", color=TEXT, fontsize=18, ha="center", va="center")
    fig.text(0.5, 0.14, f"Daily ATR {fmt(info['atr'], k)}. Average miss at 9:30 on 120 unseen days: high ≈0.08 ATR, low ≈0.10 ATR (Nasdaq)."
             if k == "NQ" else f"Daily ATR {fmt(info['atr'], k)}.", color=MUTED, fontsize=13, ha="center")
    fig.text(0.5, 0.09, "Educational replay. Not financial advice.", color=MUTED, fontsize=12, ha="center")
    return rows


def render(df, info, path, per_bar=6):
    fig = plt.figure(figsize=(19.2, 10.8), dpi=100)
    fig.patch.set_facecolor(BG)
    cand = [i for i, t in enumerate(df.index) if t.date() == info["date"] and (t.hour, t.minute) >= (9, 30)]
    if not cand:
        raise SystemExit("The 9:30 New York open hasn't happened yet for this day.")
    open_i = cand[0]
    c0 = df.iloc[open_i]
    call = dict(i=open_i, lh=c0.lh, ll=c0.ll, bu=c0.bu)
    writer = FFMpegWriter(fps=FPS, bitrate=8000, codec="libx264", extra_args=["-pix_fmt", "yuv420p"])
    k = info["key"]
    with writer.saving(fig, str(path), dpi=100):
        what = "Nasdaq" if k == "NQ" else "Gold"
        story = info.get("story")
        card(fig, [(story or f"Can a model call the {what} high & low at 9:30?", TEXT),
                   ("Could the model call the high & low at 9:30? No hindsight." if story else
                    "Live replay · no hindsight · then we check the result", MUTED)],
             sub=f"{info['name']} · {pd.Timestamp(info['date']):%A %B %-d, %Y}")
        for _ in range(int(FPS * 2.5)):
            writer.grab_frame()
        fig.clf()
        fig._drp_texts = []
        fig.patch.set_facecolor(BG)
        ax = fig.add_axes([0.03, 0.08, 0.90, 0.80])
        draw_frame(fig, ax, df, info, open_i, None)                # overnight, before the open
        for _ in range(int(FPS * 1.5)):
            writer.grab_frame()
        draw_frame(fig, ax, df, info, open_i, call)                # the 9:30 call
        keep(fig, fig.text(0.5, 0.5, f"9:30 CALL   ▲ HIGH {fmt(call['lh'], k)}   " + (f"◆ {fmt(call['bu'], k)}   " if SHOW_BUILD else "") + f"▼ LOW {fmt(call['ll'], k)}",
                 color=TEXT, fontsize=24, fontweight="bold", ha="center",
                 bbox=dict(boxstyle="round,pad=0.6", fc=PANEL, ec=MUTED, alpha=0.95)))
        for _ in range(int(FPS * 3)):
            writer.grab_frame()
        for i in range(open_i, len(df)):
            draw_frame(fig, ax, df, info, i, call)
            for _ in range(per_bar):
                writer.grab_frame()
        draw_frame(fig, ax, df, info, len(df) - 1, call, final=True)
        for _ in range(int(FPS * 2)):
            writer.grab_frame()
        rows = result_card(fig, df, info, call)
        for _ in range(int(FPS * 6)):
            writer.grab_frame()
    plt.close(fig)
    return call, rows


def describe(info, rows, path):
    k = info["key"]
    day = pd.Timestamp(info["date"])
    what = "Nasdaq" if k == "NQ" else "Gold"
    title = (f"{info['story']}: Could a Model Call the High & Low at 9:30? ({day:%b %-d, %Y} Replay)" if info.get("story")
             else f"Can a Model Call the {what} High & Low at 9:30? Live Replay vs. Real Result ({day:%b %-d, %Y})")
    lines = [f"Title: {title}", "",
             "Description:",
             f"We replay {day:%A %B %-d, %Y} on {info['name']} bar by bar from the 9:30 AM New York open with the "
             "Day Range Predictor. Green is the predicted day high and red is the predicted day low. Every line uses only the data available at that moment, with no hindsight. "
             "At the end we compare the 9:30 call with what actually happened:", ""]
    for lab, _, p, a in rows:
        lines.append(f"  {lab}: predicted {fmt(p, k)}, {'actual' if info['complete'] else 'so far'} {fmt(a, k)} "
                     f"(miss {abs(p - a):,.2f})")
    lines += ["", "The model is trained on recent Yahoo Finance data and was fitted only on days before this one.",
              "Educational content, not financial advice. No prediction is 100% certain.", "",
              f"#{what.lower()} #{'nq' if k == 'NQ' else 'xauusd'} #daytrading #tradingview #mt5 #futures #trading"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def pick_day(key, kind, seed, exclude):
    """Choose a complete day from the last ~60 days of 5-minute data: random, biggest rally or biggest drop."""
    mk = T.MARKETS[key]
    m5 = T.yahoo(mk["yahoo"], "60d", "5m")
    counts = pd.Series((m5.index + pd.Timedelta(hours=6)).date).value_counts()
    d = T.yahoo(mk["yahoo"], "1y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    tr = np.maximum(d.h, d.c.shift()) - np.minimum(d.l, d.c.shift())
    move = (d.c - d.o) / tr.rolling(20).mean().shift()
    pct = (d.c - d.o) / d.o
    today = dt.datetime.now(dt.timezone.utc).astimezone(pd.Timestamp.now(tz="America/New_York").tz).date()
    cands = [x for x in counts.index if counts[x] >= 250 and x in d.index and x < today and x not in exclude
             and x.weekday() < 5 and np.isfinite(move.get(x, np.nan))]
    if not cands:
        raise SystemExit("No complete days to pick from.")
    if kind == "random":
        day = random.Random(seed).choice(sorted(cands))
    else:
        day = (max if kind == "up" else min)(cands, key=lambda x: move[x])
    return day, float(move[day]), float(pct[day])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol", choices=list(T.MARKETS), default="NQ")
    ap.add_argument("--date", help="CME trade date YYYY-MM-DD (default: latest)")
    ap.add_argument("--per-bar", type=int, default=6, help="video frames per 5-minute bar")
    ap.add_argument("--pick", choices=["random", "up", "down"], help="pick a day from the last ~60 days instead of --date")
    ap.add_argument("--seed", type=int, help="random seed for --pick random")
    ap.add_argument("--exclude", default="", help="comma-separated dates --pick must skip")
    ap.add_argument("--build", action="store_true", help="also draw the yellow build-up line")
    a = ap.parse_args()
    global SHOW_BUILD
    SHOW_BUILD = a.build
    date = dt.date.fromisoformat(a.date) if a.date else None
    story = None
    if a.pick:
        excl = {dt.date.fromisoformat(x) for x in a.exclude.split(",") if x.strip()}
        date, mv, pc = pick_day(a.symbol, a.pick, a.seed, excl)
        what = "Nasdaq" if a.symbol == "NQ" else "Gold"
        if a.pick == "up":
            story = f"{what} Skyrocketed {pc:+.1%}"
        elif a.pick == "down":
            story = f"{what} Bombed {pc:+.1%}"
        print(f"picked {date} ({a.pick}): open-to-close {pc:+.2%}, {mv:+.2f} daily ATR")
    df, info = replay(a.symbol, date)
    info["story"] = story
    out = ROOT / "videos"
    out.mkdir(exist_ok=True)
    path = out / f"DRP_{a.symbol}_{info['date']}.mp4"
    call, rows = render(df, info, path, a.per_bar)
    describe(info, rows, path.with_suffix(".txt"))
    print(f"wrote {path}")
    for lab, _, p, act in rows:
        print(f"  {lab}: 9:30 call {p:,.2f}  {'actual' if info['complete'] else 'so far'} {act:,.2f}  miss {abs(p - act):,.2f}")


if __name__ == "__main__":
    main()
