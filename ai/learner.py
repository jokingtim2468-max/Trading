"""Always-on gold learner. Runs until you close it, saves its progress, picks up where it left off.

    python ai/learner.py            # run forever (the DRP Trading shortcut starts it minimized)
    python ai/learner.py --once     # one update cycle, then exit
    python ai/learner.py --status   # print the live track record and the current model

Every 15 minutes it:
  1. Adds the newest gold bars (Yahoo GC=F: daily, hourly, 5-minute) to its own history in ai/data/.
     Yahoo only serves ~2 years of hourly bars, so this history keeps growing past that limit.
  2. When a trading day has closed (5 PM New York):
     a. Scores that day with the model that was live *before* the day (true out-of-sample) and adds
        it to the track record, ai/data/GC_track.csv.
     b. Re-tests a few model settings walk-forward on the last 120 days it can score, keeps the best,
        refits it on all its data and publishes it.
  3. Publishes to MT5 Common\\Files\\DRP_MODEL_GC.txt. The EA reloads that file by itself (no recompile)
     and uses it when it's newer than the EA's built-in training.

Honest limits: more data and daily refits help a little and keep the model current (tested: ~2% lower
miss going from 120 to 420 training days), but the error can't go to zero; it levels off at how
unpredictable gold is. The track record shows what it really achieves. Uses about a minute of CPU per
day and a few small downloads every 15 minutes.
"""

import argparse
import datetime as dt
import json
import os
import socket
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import train_drp as T  # noqa: E402
from ai import fixed_model as FM, gold_locks as GL  # noqa: E402

DATA = ROOT / "ai" / "data"
LOGS = ROOT / "ai" / "logs"
STATE = DATA / "learner_state.json"
TRACK = DATA / "GC_track.csv"
NY = "America/New_York"
PORT = 8767                     # single-instance guard (localhost only)
CANDIDATES = [                  # (name, training window in days or None = all, ridge strength)
    ("last 250 days", 250, 1e-2),
    ("last 500 days", 500, 1e-2),
    ("all days", None, 1e-2),
    ("all days, smoother", None, 1e-1),
]
SELECT_DAYS = 120


def log(msg):
    LOGS.mkdir(parents=True, exist_ok=True)
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    print(line, flush=True)
    with open(LOGS / "learner.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def mt5_files_dir():
    appdata = os.environ.get("APPDATA")
    if appdata:
        d = Path(appdata) / "MetaQuotes" / "Terminal" / "Common" / "Files"
        if d.parent.exists():
            d.mkdir(exist_ok=True)
            return d
    return None


# ---------------------------------------------------------------- price history store
def read_bars(name):
    path = DATA / f"GC_{name}.csv"
    if not path.exists():
        return pd.DataFrame(columns=["o", "h", "l", "c", "v"])
    df = pd.read_csv(path, index_col=0)
    df.index = pd.to_datetime(df.index, utc=True).tz_convert(NY)
    return df


def update_store():
    """Merge the newest Yahoo bars into ai/data/GC_{1d,1h,5m}.csv. Returns (daily, hourly)."""
    out = {}
    for name, full, short, gap_days in (("1d", "10y", "1mo", 20), ("1h", "730d", "1mo", 20), ("5m", "60d", "5d", 4)):
        old = read_bars(name)
        stale = old.empty or (pd.Timestamp.now(tz=NY) - old.index[-1]).days > gap_days
        new = T.yahoo("GC=F", full if stale else short, name)
        df = new if old.empty else pd.concat([old, new])
        df = df[~df.index.duplicated(keep="last")].sort_index()
        df.index = df.index.tz_convert("UTC")
        atomic_write(DATA / f"GC_{name}.csv", df.to_csv())
        df.index = df.index.tz_convert(NY)
        out[name] = df
    daily = out["1d"][["o", "h", "l", "c"]].copy()
    daily.index = daily.index.date
    daily = daily[~pd.Index(daily.index).duplicated(keep="last")]
    return daily, out["1h"]


def complete_days(R, now):
    """Trade dates whose 5 PM New York close has passed."""
    return sorted(d for d in R.td.unique() if now >= pd.Timestamp(dt.datetime.combine(d, dt.time(17, 5)), tz=NY))


# ---------------------------------------------------------------- state
def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"version": 0, "champion": None, "tracked_through": None, "history": []}


def save_state(s):
    atomic_write(STATE, json.dumps(s, indent=1, default=str))


# ---------------------------------------------------------------- model selection
def fit_cfg(R, days, window, l2):
    use = days if window is None else days[-window:]
    return GL._fit(R[R.td.isin(use)], l2=l2)


def walk_score(R, days, window, l2, test_n=SELECT_DAYS, step=21):
    """Average miss (daily ATRs, high and low, all checkpoints) on the last test_n days, refit every step days."""
    test = days[-test_n:]
    errs = []
    for i in range(0, len(test), step):
        blk = test[i:i + step]
        prior = [d for d in days if d < blk[0]]
        m = fit_cfg(R, prior, window, l2)
        for k, _ in GL.CHECKPOINTS:
            q = R[(R.k == k) & R.td.isin(blk)]
            if len(q):
                pu, pd_ = GL._predict(m, q)
                errs += list(((q.y_up - pu).abs() + (q.y_dn - pd_).abs()) / 2)
    return float(np.mean(errs))


# ---------------------------------------------------------------- track record
def track(R, daily, champ, days):
    """Score each newly closed day with the model that was live before it. Returns rows added."""
    rows = []
    m = GL.unflat(champ["ck"])
    day_coef = {"up": champ["day"]["up"], "dn": champ["day"]["dn"]}
    for d in days:
        q = R[R.td == d]
        if q.empty or d not in daily.index:
            continue
        H, L, o = q.H.iloc[0], q.L.iloc[0], q.o.iloc[0]
        try:
            hi, lo, a = FM.lines(daily, d, day_coef, open_price=o)
        except Exception:
            continue
        rows.append(dict(day=d, lock="6 PM", pred_hi=hi, pred_lo=lo, H=H, L=L, atr=a, hi_still=True, lo_still=True))
        for k, name in GL.CHECKPOINTS:
            r = q[q.k == k]
            if r.empty:
                continue
            pu, pd_ = GL._predict(m, r)
            rows.append(dict(day=d, lock=name, pred_hi=r.hs.iloc[0] + pu[0] * r.a.iloc[0], pred_lo=r.ls.iloc[0] - pd_[0] * r.a.iloc[0],
                             H=H, L=L, atr=r.a.iloc[0], hi_still=bool(H > r.hs.iloc[0]), lo_still=bool(L < r.ls.iloc[0])))
    if not rows:
        return 0
    df = pd.DataFrame(rows)
    df["miss_hi"] = (df.H - df.pred_hi).abs().round(2)
    df["miss_lo"] = (df.L - df.pred_lo).abs().round(2)
    df["model"] = champ["version"]
    for c in ("pred_hi", "pred_lo", "atr"):
        df[c] = df[c].round(2)
    old = pd.read_csv(TRACK) if TRACK.exists() else pd.DataFrame()
    allr = pd.concat([old, df.astype({"day": str})])
    allr = allr.drop_duplicates(subset=["day", "lock"], keep="first")
    atomic_write(TRACK, allr.to_csv(index=False))
    return len(df)


def track_summary():
    if not TRACK.exists():
        return None
    t = pd.read_csv(TRACK)
    out = []
    for name in ["6 PM"] + [n for _, n in GL.CHECKPOINTS]:
        q = t[t["lock"] == name]
        if len(q):
            out.append((name, q.day.nunique(), q.miss_hi.mean(), q.miss_lo.mean(),
                        ((q.miss_hi <= 10).mean() + (q.miss_lo <= 10).mean()) / 2))
    return out


# ---------------------------------------------------------------- publish
def publish(champ, stamp_live):
    ck, day = champ["ck"], champ["day"]
    lines = ["model=gold_locks", f"version={champ['version']}", f"trained_through={champ['trained_through']}",
             f"published={dt.datetime.now(dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ}", f"config={champ['config']}",
             f"score_atr={champ['score']:.4f}", f"live_days={stamp_live}",
             "ckmed=" + ",".join(str(x) for x in ck["med"]),
             "ckup=" + ",".join(str(x) for x in ck["up"]),
             "ckdn=" + ",".join(str(x) for x in ck["dn"]),
             "dayup=" + ",".join(str(round(x, 6)) for x in day["up"]),
             "daydn=" + ",".join(str(round(x, 6)) for x in day["dn"])]
    text = "\n".join(lines) + "\n"
    atomic_write(DATA / "DRP_MODEL_GC.txt", text)
    d = mt5_files_dir()
    if d:
        atomic_write(d / "DRP_MODEL_GC.txt", text)
    return d


# ---------------------------------------------------------------- one cycle
def cycle(state):
    daily, h1 = update_store()
    now = pd.Timestamp.now(tz=NY)
    R = GL.rows(h1, daily)
    days = complete_days(R, now)
    if len(days) < SELECT_DAYS + 120:
        log(f"only {len(days)} complete days stored, need {SELECT_DAYS + 120}; waiting for more data")
        return state
    last = str(days[-1])
    champ = state.get("champion")
    if champ and champ["trained_through"] >= last:
        return state                                     # nothing new since the last refit
    R = R[R.td.isin(days)]
    # a) live track record for days the current model had never seen
    if champ:
        new_days = [d for d in days if str(d) > champ["trained_through"]]
        n = track(R, daily, champ, new_days)
        if n:
            log(f"track record: scored {len(new_days)} new day(s) with model v{champ['version']}")
    # b) pick the best setting walk-forward, refit on everything, publish
    scores = {name: walk_score(R, days, w, l2) for name, w, l2 in CANDIDATES}
    best = min(scores, key=scores.get)
    _, w, l2 = next(c for c in CANDIDATES if c[0] == best)
    m = fit_cfg(R, days, w, l2)
    dcoef = FM.train(daily, before=days[-1] + dt.timedelta(days=1), years=10)
    state["version"] += 1
    champ = {"version": state["version"], "trained_through": last, "config": best, "score": scores[best],
             "ck": GL.flat(m), "day": {"up": dcoef["up"], "dn": dcoef["dn"]}, "days": len(days)}
    state["champion"] = champ
    state["history"].append({"version": champ["version"], "trained_through": last, "config": best,
                             "scores": {k: round(v, 4) for k, v in scores.items()}, "days": len(days),
                             "at": f"{dt.datetime.now():%Y-%m-%d %H:%M}"})
    state["history"] = state["history"][-400:]
    summ = track_summary()
    live = summ[0][1] if summ else 0
    where = publish(champ, live)
    save_state(state)
    log(f"model v{champ['version']} trained through {last} on {len(days)} days, setting '{best}' "
        f"(walk-forward miss {scores[best]:.4f} ATR; others: " +
        ", ".join(f"{k} {v:.4f}" for k, v in scores.items() if k != best) + ")" +
        (f" -> published to {where}" if where else " -> saved in ai/data (MT5 not found on this PC)"))
    return state


def status():
    s = load_state()
    c = s.get("champion")
    if not c:
        print("No model yet. Run: python ai/learner.py --once")
        return
    print(f"Model v{c['version']}: trained through {c['trained_through']} on {c['days']} days, setting '{c['config']}', "
          f"walk-forward miss {c['score']:.4f} daily ATR")
    summ = track_summary()
    if not summ:
        print("Live track record: starts after the next trading day closes.")
        return
    print("\nLive track record (each day scored by the model that was live before it):")
    print(f"{'Lock':>6} {'Days':>5} {'Miss high':>10} {'Miss low':>9} {'Within $10':>11}")
    for name, n, mh, ml, w10 in summ:
        print(f"{name:>6} {n:>5} {mh:>10.2f} {ml:>9.2f} {w10:>10.0%}")


def single_instance():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", PORT))
        sock.listen(1)
    except OSError:
        print("The gold learner is already running.")
        sys.exit(0)
    return sock


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="run one update cycle and exit")
    ap.add_argument("--status", action="store_true", help="print the live track record and exit")
    ap.add_argument("--every", type=int, default=15, help="minutes between checks (default 15)")
    a = ap.parse_args()
    if a.status:
        return status()
    lock = single_instance()                     # held for the life of the process
    code = {f: f.stat().st_mtime for f in (ROOT / "ai").glob("*.py")}
    state = load_state()
    log(f"gold learner started (model v{state['version']}); progress is saved in {DATA}")
    while True:
        try:
            state = cycle(state)
        except Exception:
            log("cycle failed, will retry:\n" + traceback.format_exc())
        if a.once:
            return
        try:
            time.sleep(a.every * 60)
        except KeyboardInterrupt:
            log("stopped by user; progress is saved")
            return
        # the DRP Trading shortcut auto-updates the code; restart into the new version (state is on disk)
        if any(f.exists() and f.stat().st_mtime != t for f, t in code.items()):
            log("code was updated, restarting the learner")
            lock.close()
            os.execv(sys.executable, [sys.executable] + sys.argv)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped by user; progress is saved")
