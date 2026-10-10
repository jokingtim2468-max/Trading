"""Replay video of the gold checkpoint locks for one held-out day.

    python tools/gold_ck_video.py --date 2026-10-09

At the 6 PM open the indicator locks a predicted HIGH (green) and LOW (red). At 8 PM, 3 AM, 8 AM, 10 AM
and 12 PM New York it re-predicts them from what the day has done so far and locks them again. Both
models are fitted only on days before the replayed day, so the video has no hindsight. Ends with a
table of every lock vs. the real high and low. Writes videos/DRP_CK_GC_<date>.mp4 and a .txt.
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
from ai import fixed_model as FM, gold_locks as GL  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402  (backend set by replay_video)
from matplotlib.animation import FFMpegWriter  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

BG, PANEL, GRID, TEXT, MUTED, GREEN, RED = R.BG, R.PANEL, R.GRID, R.TEXT, R.MUTED, R.GREEN, R.RED
fmt = lambda x: R.fmt(x, "GC")  # noqa: E731


def locks(day):
    """[(bar index where the lock starts, name, high, low)] for the day, fitted on earlier days only."""
    d = T.yahoo("GC=F", "10y", "1d")[["o", "h", "l", "c"]]
    d.index = d.index.date
    m5 = T.yahoo("GC=F", "60d", "5m")
    bars = m5[(m5.index + pd.Timedelta(hours=6)).date == day]
    if len(bars) < 200:
        raise SystemExit(f"No complete gold day for {day}")
    h1 = T.yahoo("GC=F", "730d", "1h")
    rows = GL.rows(h1, d)
    m = GL._fit(rows[rows.td < day])
    o = float(bars.o.iloc[0])
    hi, lo, atr = FM.lines(d, day, FM.train(d, before=day, years=10), open_price=o)
    F, _, _, _ = FM.features(d)
    out = [(0, "6 PM", hi, lo)]
    start = bars.index[0]
    for k, name in GL.CHECKPOINTS:
        tc = start + pd.Timedelta(hours=k)
        s = bars[bars.index + pd.Timedelta(minutes=5) <= tc]
        hs, ls = max(o, s.h.max()), min(o, s.l.min())
        q = pd.DataFrame([dict(k=k, one=1.0, upd=(hs - o) / atr, dnd=(o - ls) / atr, pos=(s.c.iloc[-1] - o) / atr,
                               rngs=(hs - ls) / atr, r5=F.r5[day], prng=F.prng[day])])
        pu, pd_ = GL._predict(m, q)
        out.append((len(s), name, hs + pu[0] * atr, ls - pd_[0] * atr))
    return bars, out, atr, rows[rows.td < day].td.nunique()


def frame(fig, ax, bars, k, L, info, final=False):
    ax.clear()
    ax.set_facecolor(BG)
    n = len(bars)
    end_x = n + 4
    shown = bars.iloc[:k + 1]
    for i, b in enumerate(shown.itertuples()):
        up = b.c >= b.o
        col = R.CANDLE_UP if up else R.CANDLE_DN
        ax.plot([i, i], [b.l, b.h], color=col, lw=0.8)
        ax.add_patch(Rectangle((i - 0.35, min(b.o, b.c)), 0.7, max(abs(b.c - b.o), info["atr"] * 0.002),
                               facecolor=BG if up else col, edgecolor=col, lw=0.8))
    active = [x for x in L if x[0] <= k]
    for j, (s, name, hi, lo) in enumerate(active):
        cur = j == len(active) - 1
        e = end_x if cur else active[j + 1][0]
        ax.plot([s, e], [hi, hi], color=GREEN, lw=2.6 if cur else 1.2, alpha=1 if cur else 0.45, ls="-" if cur else "--")
        ax.plot([s, e], [lo, lo], color=RED, lw=2.6 if cur else 1.2, alpha=1 if cur else 0.45, ls="-" if cur else "--")
        ax.axvline(s - 0.5, color=MUTED, lw=0.8, alpha=0.3)
        ax.text(s, 1.0, f" {name} lock", transform=ax.get_xaxis_transform(), color=MUTED, fontsize=9, va="top")
    s, name, hi, lo = active[-1]
    ax.text(end_x + 0.5, hi, f" ▲ {name} HIGH {fmt(hi)}", color=BG, fontsize=11, fontweight="bold", va="center",
            bbox=dict(boxstyle="round,pad=0.3", fc=GREEN, ec="none"))
    ax.text(end_x + 0.5, lo, f" ▼ {name} LOW {fmt(lo)}", color="white", fontsize=11, fontweight="bold", va="center",
            bbox=dict(boxstyle="round,pad=0.3", fc=RED, ec="none"))
    if final:
        H, Lo = bars.h.max(), bars.l.min()
        ih, il = int(np.argmax(bars.h.to_numpy())), int(np.argmin(bars.l.to_numpy()))
        ax.annotate(f"actual high {fmt(H)}", xy=(ih, H), xytext=(min(max(ih, 10), n - 10), H + 0.06 * info["atr"]),
                    color=TEXT, fontsize=11, ha="center", arrowprops=dict(arrowstyle="-", color=MUTED))
        ax.annotate(f"actual low {fmt(Lo)}", xy=(il, Lo), xytext=(min(max(il, 10), n - 10), Lo - 0.08 * info["atr"]),
                    color=TEXT, fontsize=11, ha="center", arrowprops=dict(arrowstyle="-", color=MUTED))
    ax.set_xlim(-2, end_x + 22)
    ys = [v for x in L for v in (x[2], x[3])]
    ax.set_ylim(min(bars.l.min(), *ys) - 0.1 * info["atr"], max(bars.h.max(), *ys) + 0.1 * info["atr"])
    ticks = [i for i, t in enumerate(bars.index) if t.minute == 0 and t.hour % 2 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([bars.index[i].strftime("%-I %p").lower() for i in ticks], color=MUTED, fontsize=10)
    ax.tick_params(axis="y", colors=MUTED, labelsize=10)
    ax.yaxis.tick_right()
    ax.grid(color=GRID, lw=0.8)
    for sp in ax.spines.values():
        sp.set_visible(False)
    cur = shown.iloc[-1]
    R.clear_texts(fig)
    R.keep(fig, fig.text(0.03, 0.955, f"Gold / XAUUSD  ·  Checkpoint locks  ·  {pd.Timestamp(info['date']):%a %b %-d, %Y}",
                         color=TEXT, fontsize=17, fontweight="bold"))
    R.keep(fig, fig.text(0.03, 0.918, "High/low locked at 6 PM, then re-locked at 8 PM, 3 AM, 8 AM, 10 AM, 12 PM NY · "
                         "each lock uses only data up to that moment · this day was never used for training",
                         color=MUTED, fontsize=11))
    R.keep(fig, fig.text(0.97, 0.955, f"{cur.name:%-I:%M %p} ET", color=TEXT, fontsize=17, fontweight="bold", ha="right"))
    R.keep(fig, fig.text(0.97, 0.918, f"price {fmt(cur.c)}", color=MUTED, fontsize=12, ha="right"))
    R.keep(fig, fig.text(0.03, 0.02, "Educational replay. Not financial advice. Predictions are estimates, not guarantees.",
                         color=MUTED, fontsize=10))


def result(fig, bars, L, info):
    fig.clf()
    fig.patch.set_facecolor(BG)
    H, Lo = bars.h.max(), bars.l.min()
    fig.text(0.5, 0.90, "Every lock vs. the real high & low", color=TEXT, fontsize=28, fontweight="bold", ha="center")
    fig.text(0.5, 0.85, f"Gold / XAUUSD · {pd.Timestamp(info['date']):%a %b %-d, %Y} · actual high {fmt(H)} · actual low {fmt(Lo)}".replace("$", r"\$"),
             color=MUTED, fontsize=15, ha="center")
    xs = (0.14, 0.32, 0.47, 0.65, 0.80)
    for x, h in zip(xs, ("Locked at", "Pred. HIGH", "Miss", "Pred. LOW", "Miss")):
        fig.text(x, 0.77, h, color=MUTED, fontsize=15, ha="center")
    for i, (s, name, hi, lo) in enumerate(L):
        y = 0.70 - i * 0.085
        fig.add_artist(FancyBboxPatch((0.06, y - 0.033), 0.86, 0.066, boxstyle="round,pad=0.004,rounding_size=0.012",
                                      transform=fig.transFigure, fc=PANEL, ec="none", zorder=0))
        done_h = bars.iloc[:s].h.max() >= H if s else False
        done_l = bars.iloc[:s].l.min() <= Lo if s else False
        vals = (name, fmt(hi), f"${abs(hi - H):,.2f}" + ("*" if done_h else ""), fmt(lo), f"${abs(lo - Lo):,.2f}" + ("*" if done_l else ""))
        cols = (TEXT, GREEN, TEXT, RED, TEXT)
        for x, v, c in zip(xs, vals, cols):
            fig.text(x, y, v, color=c, fontsize=19, ha="center", va="center", fontweight="bold" if c != TEXT else "normal")
    fig.text(0.5, 0.11, f"* that extreme was already made before the lock. Daily ATR {fmt(info['atr'])}. "
             f"Models trained on {info['days']} earlier days only.", color=MUTED, fontsize=13, ha="center")
    fig.text(0.5, 0.06, "Educational replay. Not financial advice.", color=MUTED, fontsize=12, ha="center")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True)
    ap.add_argument("--per-bar", type=int, default=3)
    a = ap.parse_args()
    day = dt.date.fromisoformat(a.date)
    bars, L, atr, ndays = locks(day)
    info = {"date": day, "atr": atr, "days": ndays}
    out = ROOT / "videos"
    out.mkdir(exist_ok=True)
    path = out / f"DRP_CK_GC_{day}.mp4"
    fig = plt.figure(figsize=(19.2, 10.8), dpi=100)
    fig.patch.set_facecolor(BG)
    writer = FFMpegWriter(fps=R.FPS, bitrate=8000, codec="libx264", extra_args=["-pix_fmt", "yuv420p"])
    with writer.saving(fig, str(path), dpi=100):
        R.card(fig, [("Gold's high & low, locked 6 times a day", TEXT),
                     ("Each lock uses only what has happened so far · no hindsight", MUTED)],
               sub=f"Gold / XAUUSD · {pd.Timestamp(day):%A %B %-d, %Y}")
        for _ in range(int(R.FPS * 2.5)):
            writer.grab_frame()
        fig.clf()
        fig._drp_texts = []
        fig.patch.set_facecolor(BG)
        ax = fig.add_axes([0.03, 0.08, 0.84, 0.80])
        starts = {x[0] for x in L}
        for i in range(len(bars)):
            frame(fig, ax, bars, i, L, info)
            for _ in range(a.per_bar * (8 if i in starts else 1)):      # pause briefly on each new lock
                writer.grab_frame()
        frame(fig, ax, bars, len(bars) - 1, L, info, final=True)
        for _ in range(int(R.FPS * 3)):
            writer.grab_frame()
        result(fig, bars, L, info)
        for _ in range(int(R.FPS * 7)):
            writer.grab_frame()
    plt.close(fig)
    H, Lo = bars.h.max(), bars.l.min()
    rows = [f"  {n:>5} lock: high {fmt(h)} (miss ${abs(h - H):,.2f}), low {fmt(l)} (miss ${abs(l - Lo):,.2f})" for _, n, h, l in L]
    txt = [f"Title: Gold's High & Low Locked 6 Times in One Day — How Close Did Each Call Get? ({pd.Timestamp(day):%b %-d, %Y})", "",
           "Description:",
           f"Replay of {pd.Timestamp(day):%A %B %-d, %Y} on gold (XAUUSD / GC futures). The Day Range Predictor locks a predicted "
           "HIGH (green) and LOW (red) at the 6 PM New York open, then re-locks them at 8 PM, 3 AM, 8 AM, 10 AM and 12 PM "
           "from what the day has done so far. Each lock uses only data available at that moment, and the models were "
           f"trained only on earlier days. Actual high {fmt(H)}, actual low {fmt(Lo)}:", "", *rows, "",
           "Later locks are more accurate partly because one of the day's extremes is often already in by then.",
           "Educational content, not financial advice. No prediction is 100% certain.", "",
           "#gold #xauusd #daytrading #mt5 #trading #futures #ai"]
    path.with_suffix(".txt").write_text("\n".join(txt) + "\n", encoding="utf-8")
    print(f"wrote {path}")
    print("\n".join(rows))


if __name__ == "__main__":
    main()
