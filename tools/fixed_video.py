"""Before/after replay video for the FIXED day lines (decided at the 6 PM open, never moved).

    python tools/fixed_video.py --symbol NQ --pick random --seed 42 --exclude 2026-10-08
    python tools/fixed_video.py --symbol NQ --date 2026-09-15

Renders two videos for the same held-out day:
  * BEFORE: untrained baseline (median of the last 250 days' moves)
  * AFTER:  median regression trained on 10 years of daily bars strictly before that day
The day itself is never used for training. Writes videos/DRP_FIXED_<symbol>_<date>_{before,after}.mp4
plus a .txt with a title and description for each.
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

import matplotlib.pyplot as plt  # noqa: E402  (backend set by replay_video)
from matplotlib.animation import FFMpegWriter  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

BG, PANEL, GRID, TEXT, MUTED = R.BG, R.PANEL, R.GRID, R.TEXT, R.MUTED
SESSIONS = {
    "day": {"lock": "6 PM open", "span": "6 PM open to 5 PM close", "file": "DAY",
            "sub": "covers overnight, the regular session and after-hours to 5 PM"},
    "rth": {"lock": "9:30 open", "span": "9:30 AM to 4:00 PM", "file": "RTH",
            "sub": "regular cash session, 9:30 AM to 4:00 PM"},
    "ah": {"lock": "4 PM close", "span": "4 PM to 9 AM next morning", "file": "AH",
           "sub": "after-hours, overnight and pre-market, 4 PM to 9 AM"},
}
GREEN, RED = R.GREEN, R.RED


def load(key, day):
    mk = T.MARKETS[key]
    d = T.yahoo(mk["yahoo"], "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    m5 = T.yahoo(mk["yahoo"], "60d", "5m")
    m5 = m5[m5.v > 0] if (m5.v > 0).mean() > 0.5 else m5
    bars = m5[(m5.index + pd.Timedelta(hours=6)).date == day]
    if bars.empty:
        raise SystemExit(f"No 5-minute bars for {day}")
    return d, bars


def frame(fig, ax, bars, k, hi, lo, info, label, final=False):
    ax.clear()
    ax.set_facecolor(BG)
    n = len(bars)
    end_x = n + 4
    shown = bars.iloc[:k + 1]
    for i, b in enumerate(shown.itertuples()):
        up = b.c >= b.o
        col = R.CANDLE_UP if up else R.CANDLE_DN
        ax.plot([i, i], [b.l, b.h], color=col, lw=0.8)
        lo_, hi_ = min(b.o, b.c), max(b.o, b.c)
        ax.add_patch(Rectangle((i - 0.35, lo_), 0.7, max(hi_ - lo_, info["atr"] * 0.002),
                               facecolor=BG if up else col, edgecolor=col, lw=0.8))
    ax.plot([0, end_x], [hi, hi], color=GREEN, lw=2.6)
    ax.plot([0, end_x], [lo, lo], color=RED, lw=2.6)
    ax.text(end_x + 0.5, hi, f" ▲ HIGH {R.fmt(hi, info['key'])}", color=BG, fontsize=11, fontweight="bold", va="center",
            bbox=dict(boxstyle="round,pad=0.3", fc=GREEN, ec="none"))
    ax.text(end_x + 0.5, lo, f" ▼ LOW {R.fmt(lo, info['key'])}", color="white", fontsize=11, fontweight="bold", va="center",
            bbox=dict(boxstyle="round,pad=0.3", fc=RED, ec="none"))
    # mark the bar where the day's high / low so far came closest to the line, and where it touched
    tol = 0.03 * info["atr"]
    for line, col, side in ((hi, GREEN, "h"), (lo, RED, "l")):
        hit = (shown.h >= line - tol) if side == "h" else (shown.l <= line + tol)
        if hit.any():
            j = int(np.argmax(hit.to_numpy()))
            ax.scatter([j], [shown.h.iloc[j] if side == "h" else shown.l.iloc[j]], s=80, color=col, zorder=5,
                       edgecolor=BG, linewidth=1.5)
    if final:
        H, L = bars.h.max(), bars.l.min()
        ih, il = int(np.argmax(bars.h.to_numpy())), int(np.argmin(bars.l.to_numpy()))
        th, tl = min(max(ih, 8), n - 8), min(max(il, 8), n - 8)     # keep the labels inside the chart
        ax.annotate(f"actual high {R.fmt(H, info['key'])}", xy=(ih, H), xytext=(th, H + 0.06 * info["atr"]),
                    color=TEXT, fontsize=11, ha="center", arrowprops=dict(arrowstyle="-", color=MUTED))
        ax.annotate(f"actual low {R.fmt(L, info['key'])}", xy=(il, L), xytext=(tl, L - 0.08 * info["atr"]),
                    color=TEXT, fontsize=11, ha="center", arrowprops=dict(arrowstyle="-", color=MUTED))
    ny930 = [i for i, t in enumerate(bars.index) if (t.hour, t.minute) == (9, 30)]
    if ny930 and k >= ny930[0]:
        ax.axvline(ny930[0] - 0.5, color=MUTED, lw=1, alpha=0.35)
        ax.text(ny930[0], 1.0, " 9:30 cash open", transform=ax.get_xaxis_transform(), color=MUTED, fontsize=9, va="top")
    ax.set_xlim(-2, end_x + 16)
    lo_y = min(bars.l.min(), lo) - 0.12 * info["atr"]
    hi_y = max(bars.h.max(), hi) + 0.12 * info["atr"]
    ax.set_ylim(lo_y, hi_y)
    ticks = [i for i, t in enumerate(bars.index) if t.minute == 0 and t.hour % 2 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([bars.index[i].strftime("%-I %p").lower() for i in ticks], color=MUTED, fontsize=10)
    ax.tick_params(axis="y", colors=MUTED, labelsize=10)
    ax.yaxis.tick_right()
    ax.grid(color=GRID, lw=0.8)
    for s in ax.spines.values():
        s.set_visible(False)
    cur = shown.iloc[-1]
    R.clear_texts(fig)
    R.keep(fig, fig.text(0.03, 0.955, f"{info['name']}  ·  {label}  ·  {pd.Timestamp(info['date']):%a %b %-d, %Y}",
                         color=TEXT, fontsize=17, fontweight="bold"))
    R.keep(fig, fig.text(0.03, 0.918, f"Two lines locked at the {info['lock']} and never moved · {info['sub']} · "
                         "this session was never used for training", color=MUTED, fontsize=11))
    R.keep(fig, fig.text(0.97, 0.955, f"{cur.name:%-I:%M %p} ET", color=TEXT, fontsize=17, fontweight="bold", ha="right"))
    R.keep(fig, fig.text(0.97, 0.918, f"price {R.fmt(cur.c, info['key'])}", color=MUTED, fontsize=12, ha="right"))
    R.keep(fig, fig.text(0.03, 0.02, "Educational replay. Not financial advice. Predictions are estimates, not guarantees.",
                         color=MUTED, fontsize=10))


def result(fig, bars, hi, lo, info, label, other=None):
    fig.clf()
    fig.patch.set_facecolor(BG)
    H, L, k = bars.h.max(), bars.l.min(), info["key"]
    fig.text(0.5, 0.86, f"{label}: locked lines vs. what really happened", color=TEXT, fontsize=28, fontweight="bold", ha="center")
    fig.text(0.5, 0.80, f"{info['name']} · {pd.Timestamp(info['date']):%a %b %-d, %Y} · {info['span']}",
             color=MUTED, fontsize=15, ha="center")
    xs = (0.2, 0.42, 0.62, 0.82)
    for x, h in zip(xs, ("", f"Locked at {info['lock'].split()[0]} {info['lock'].split()[1] if info['lock'].split()[1] == 'PM' else ''}".strip(),
                         "Actual", "Miss")):
        fig.text(x, 0.68, h, color=MUTED, fontsize=16, ha="center")
    for i, (lab, col, p, a) in enumerate((("Day HIGH", GREEN, hi, H), ("Day LOW", RED, lo, L))):
        y = 0.58 - i * 0.13
        fig.add_artist(FancyBboxPatch((0.08, y - 0.05), 0.84, 0.10, boxstyle="round,pad=0.005,rounding_size=0.015",
                                      transform=fig.transFigure, fc=PANEL, ec="none", zorder=0))
        miss = abs(p - a)
        unit = f"{miss:,.0f} pts" if k == "NQ" else f"${miss:,.2f}"
        fig.text(xs[0], y, lab, color=col, fontsize=22, fontweight="bold", ha="center", va="center")
        fig.text(xs[1], y, R.fmt(p, k), color=TEXT, fontsize=22, ha="center", va="center")
        fig.text(xs[2], y, R.fmt(a, k), color=TEXT, fontsize=22, ha="center", va="center")
        fig.text(xs[3], y, f"{unit}  ({miss / info['atr']:.2f} ATR)", color=TEXT, fontsize=18, ha="center", va="center")
    if other:
        fig.text(0.5, 0.22, other, color=TEXT, fontsize=15, ha="center")
    fig.text(0.5, 0.12, f"Daily ATR {R.fmt(info['atr'], k)} · {info['train_note']}", color=MUTED, fontsize=13, ha="center")
    fig.text(0.5, 0.07, "Educational replay. Not financial advice.", color=MUTED, fontsize=12, ha="center")


def render(path, bars, hi, lo, info, label, intro, other=None, per_bar=3):
    fig = plt.figure(figsize=(19.2, 10.8), dpi=100)
    fig.patch.set_facecolor(BG)
    writer = FFMpegWriter(fps=R.FPS, bitrate=8000, codec="libx264", extra_args=["-pix_fmt", "yuv420p"])
    with writer.saving(fig, str(path), dpi=100):
        R.card(fig, intro, sub=f"{info['name']} · {pd.Timestamp(info['date']):%A %B %-d, %Y}")
        for _ in range(int(R.FPS * 2.5)):
            writer.grab_frame()
        fig.clf()
        fig._drp_texts = []
        fig.patch.set_facecolor(BG)
        ax = fig.add_axes([0.03, 0.08, 0.86, 0.80])
        frame(fig, ax, bars, 0, hi, lo, info, label)
        R.keep(fig, fig.text(0.46, 0.5, f"LOCKED AT {info['lock'].upper()}   ▲ HIGH {R.fmt(hi, info['key'])}   ▼ LOW {R.fmt(lo, info['key'])}",
                             color=TEXT, fontsize=24, fontweight="bold", ha="center",
                             bbox=dict(boxstyle="round,pad=0.6", fc=PANEL, ec=MUTED, alpha=0.95)))
        for _ in range(int(R.FPS * 3)):
            writer.grab_frame()
        for i in range(len(bars)):
            frame(fig, ax, bars, i, hi, lo, info, label)
            for _ in range(per_bar):
                writer.grab_frame()
        frame(fig, ax, bars, len(bars) - 1, hi, lo, info, label, final=True)
        for _ in range(int(R.FPS * 3)):
            writer.grab_frame()
        result(fig, bars, hi, lo, info, label, other)
        for _ in range(int(R.FPS * 6)):
            writer.grab_frame()
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol", choices=list(T.MARKETS), default="NQ")
    ap.add_argument("--date")
    ap.add_argument("--pick", choices=["random", "up", "down"])
    ap.add_argument("--seed", type=int)
    ap.add_argument("--exclude", default="")
    ap.add_argument("--per-bar", type=int, default=3)
    ap.add_argument("--session", choices=list(SESSIONS), default="day",
                    help="day = 6 PM-5 PM, rth = 9:30-4:00 (Nasdaq), ah = 4 PM-9 AM after-market (Nasdaq)")
    a = ap.parse_args()
    if a.pick:
        excl = {dt.date.fromisoformat(x) for x in a.exclude.split(",") if x.strip()}
        day, _, pc = R.pick_day(a.symbol, a.pick, a.seed, excl)
    else:
        day = dt.date.fromisoformat(a.date)
    d, bars = load(a.symbol, day)
    if a.session != "day" and a.symbol != "NQ":
        raise SystemExit("Regular-session and after-market lines are for Nasdaq; gold uses the full day.")
    if a.session == "day":
        coef = FM.train(d, before=day, years=10)
        o = float(bars.o.iloc[0])      # the chart's own 6 PM open (daily data can be on another contract in roll weeks)
        bh, bl, atr = FM.lines(d, day, open_price=o)
        ah, al, _ = FM.lines(d, day, coef, open_price=o)
        after_label, years = "AFTER 10-year training", "10-year"
        before_note = "Untrained: lines = median of the last 250 days' moves"
    elif a.session == "rth":
        m5 = T.yahoo(T.MARKETS["NQ"]["yahoo"], "60d", "5m")
        bars = m5[(m5.index.date == day) & ((m5.index.hour * 60 + m5.index.minute) >= 570) & (m5.index.hour < 16)]
        nd = S.rth_daily(T.yahoo)
        coef = FM.train(nd, before=day, years=10)
        o = float(bars.o.iloc[0])
        bh, bl, atr = FM.lines(nd, day, open_price=o)
        ah, al, _ = FM.lines(nd, day, coef, open_price=o)
        after_label = "AFTER 10-year training"
        before_note = "Untrained: lines = median of the last 250 sessions' moves"
    else:
        m5 = T.yahoo(T.MARKETS["NQ"]["yahoo"], "60d", "5m")
        t = S.ah_table(T.yahoo(T.MARKETS["NQ"]["yahoo"], "730d", "1h"), d)
        if day not in t.index:
            raise SystemExit(f"No complete after-market session for {day}")
        nxt = min(x for x in set(m5.index.date) if x > day)
        hm = m5.index.hour * 60 + m5.index.minute
        bars = m5[((m5.index.date == day) & (hm >= 960)) | ((m5.index.date > day) & (m5.index.date < nxt)) |
                  ((m5.index.date == nxt) & (hm < 540))]
        coef = S.ah_train(t, before=day)
        o = float(bars.o.iloc[0])
        bh, bl, atr = S.ah_lines(t, day, open_price=o)
        ah, al, _ = S.ah_lines(t, day, coef, open_price=o)
        after_label = "AFTER 2-year training"
        before_note = "Untrained: lines = median of the last 250 sessions' moves"
    H, L = bars.h.max(), bars.l.min()
    mk = T.MARKETS[a.symbol]
    what = "Nasdaq" if a.symbol == "NQ" else "Gold"
    base = dict(key=a.symbol, name=mk["name"], date=day, atr=atr, **SESSIONS[a.session])
    out = ROOT / "videos"
    out.mkdir(exist_ok=True)
    miss = lambda h, l: (abs(h - H) + abs(l - L)) / 2  # noqa: E731
    cmp = (f"Average miss: before {miss(bh, bl):,.2f} → after {miss(ah, al):,.2f}"
           + (" pts" if a.symbol == "NQ" else ""))
    runs = (("before", "BEFORE training", bh, bl, before_note),
            ("after", after_label, ah, al,
             f"Trained on {coef['days']:,} sessions ({coef['from']} to {coef['to']}), all before this one"))
    for tag, label, hi, lo, note in runs:
        info = {**base, "train_note": note}
        path = out / f"DRP_{SESSIONS[a.session]['file']}_{a.symbol}_{day}_{tag}.mp4"
        intro = [(f"{label}: can two locked lines call {what}'s high & low?", TEXT),
                 (f"Lines set at the {info['lock']}, never moved · {info['sub']}", MUTED)]
        render(path, bars, hi, lo, info, label, intro, cmp if tag == "after" else None, a.per_bar)
        lines = [f"Title: {what} {label} — Two Locked Lines vs. the Real High & Low ({pd.Timestamp(day):%b %-d, %Y})", "",
                 "Description:",
                 f"{label}. At the {info['lock']} (New York time) the model locks one predicted HIGH (green) and one "
                 f"predicted LOW (red) for the session: {info['sub']}. "
                 f"The lines never move. This session was held out of training. {note}.", "",
                 f"  Predicted high {R.fmt(hi, a.symbol)} vs actual {R.fmt(H, a.symbol)} (miss {abs(hi - H):,.2f})",
                 f"  Predicted low {R.fmt(lo, a.symbol)} vs actual {R.fmt(L, a.symbol)} (miss {abs(lo - L):,.2f})", "",
                 "Educational content, not financial advice. No prediction is 100% certain.", "",
                 f"#{what.lower()} #daytrading #trading #futures #ai #mt5 #tradingview"]
        path.with_suffix(".txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {path}: high {hi:,.2f} (actual {H:,.2f}, miss {abs(hi - H):,.2f})  "
              f"low {lo:,.2f} (actual {L:,.2f}, miss {abs(lo - L):,.2f})")
    print(cmp)


if __name__ == "__main__":
    main()
