"""Backtest engine + strategy families for the ES/NQ Lucid 25K study.

Execution model (all prices in index points):
  * Signals are computed only from CLOSED 5-minute bars. A signal on the bar that
    starts at t is known at t+5 and acted on in the 1-minute bar starting at t+5.
  * Market orders (entries, stops, time/EOD/news exits) fill with 1 tick of adverse
    slippage. Stops that gap fill at the worse of stop and bar open.
  * Limit orders (limit entries, take-profits) fill only when price trades THROUGH
    the level by at least 1 tick. No slippage on limits.
  * When stop and target are both touched inside the same 1-minute bar the stop is
    assumed to fill first. On a limit-entry fill bar only the stop is checked.
  * Commission $1.24 round turn per micro.
Prop rules: $150 risk per trade (incl. 2 ticks slippage + commission), max 20 micros,
max 2 losing trades or -$400 per day, 60-minute max hold, flat by 15:55 ET, no
positions through FOMC (14:00) or ISM Manufacturing / Services (10:00) releases.
"""
import math
import os
import pickle

import numpy as np

SPEC = {"ES": dict(tick=0.25, pv=5.0), "NQ": dict(tick=0.25, pv=2.0)}  # MES / MNQ
RULES = dict(risk=150.0, max_micros=20, max_losses=2, max_day_loss=-400.0,
             max_hold=60, flat=15 * 60 + 55, comm=1.24, slip=1)

# FOMC statement days (federalreserve.gov); all 14:00 ET.
FOMC = """2015-01-28 2015-03-18 2015-04-29 2015-06-17 2015-07-29 2015-09-17 2015-10-28 2015-12-16
2016-01-27 2016-03-16 2016-04-27 2016-06-15 2016-07-27 2016-09-21 2016-11-02 2016-12-14
2017-02-01 2017-03-15 2017-05-03 2017-06-14 2017-07-26 2017-09-20 2017-11-01 2017-12-13
2018-01-31 2018-03-21 2018-05-02 2018-06-13 2018-08-01 2018-09-26 2018-11-08 2018-12-19
2019-01-30 2019-03-20 2019-05-01 2019-06-19 2019-07-31 2019-09-18 2019-10-30 2019-12-11
2020-01-29 2020-03-03 2020-04-29 2020-06-10 2020-07-29 2020-09-16 2020-11-05 2020-12-16 2021-01-27 2021-03-17 2021-04-28 2021-06-16 2021-07-28
2021-09-22 2021-11-03 2021-12-15 2022-01-26 2022-03-16 2022-05-04 2022-06-15 2022-07-27
2022-09-21 2022-11-02 2022-12-14 2023-02-01 2023-03-22 2023-05-03 2023-06-14 2023-07-26
2023-09-20 2023-11-01 2023-12-13 2024-01-31 2024-03-20 2024-05-01 2024-06-12 2024-07-31
2024-09-18 2024-11-07 2024-12-18 2025-01-29 2025-03-19 2025-05-07 2025-06-18 2025-07-30""".split()

TRAIN_END = "2022-09-15"


def news_windows(calendar):
    """date -> list of (event_minute, block_from, block_to). ISM Manufacturing = 1st
    trading day of the month, ISM Services = 3rd trading day, both 10:00 ET."""
    import datetime as dt
    out = {}
    bymonth = {}
    for d in calendar:
        bymonth.setdefault((d.year, d.month), []).append(d)
    for days in bymonth.values():
        days.sort()
        for k in (0, 2):
            if len(days) > k:
                out.setdefault(days[k], []).append((600, 600 - 15, 600 + 5))
    for s in FOMC:
        d = dt.date.fromisoformat(s)
        out.setdefault(d, []).append((840, 840 - 30, 900))  # no entries 13:30-15:00
    return out


def load(data_dir, sym, which="trainval"):
    # Pickles are written locally by prep.py (trusted, never downloaded).
    with open(os.path.join(data_dir, f"{sym}_{which}.pkl"), "rb") as f:
        return pickle.load(f)


# --------------------------------------------------------------------------- engine
def run_day(rec, sigs, sym, news, max_trades, cost_mult=1.0, rules=RULES):
    tick, pv = SPEC[sym]["tick"], SPEC[sym]["pv"]
    slip = tick * rules["slip"] * cost_mult
    comm = rules["comm"] * cost_mult
    T, M = rec["m1_t"], rec["m1"]
    idx = {int(t): i for i, t in enumerate(T)}
    flat_t = rules["flat"]
    flatten_at = [ev - 2 for ev, _, _ in news]
    trades = []
    done = set()  # optional "group": at most one filled trade per group per day
    free_t, losses, dpnl = 0, 0, 0.0
    for s in sorted(sigs, key=lambda x: x["t"]):
        if len(trades) >= max_trades or losses >= rules["max_losses"] or dpnl <= rules["max_day_loss"]:
            break
        if s["t"] < free_t or s["t"] >= flat_t - 5 or s["t"] not in idx or s.get("group") in done:
            continue
        side, px, stop, tp = s["side"], s["px"], s["stop"], s["tp"]
        if side * (px - stop) <= 0 or side * (tp - px) <= 0:
            continue
        rpm = (abs(px - stop) + 2 * slip) * pv + comm
        n = min(rules["max_micros"], int(math.floor(rules["risk"] / rpm)))
        if n < 1:
            continue
        k0 = idx[s["t"]]
        # ---- entry
        k_fill, entry = None, None
        if s["kind"] == "mkt":
            k_fill, entry = k0, M[k0, 0] + side * slip
        else:
            end_t = s["t"] + s.get("expiry", 30)
            k = k0
            while k < len(T) and T[k] < end_t and T[k] < flat_t:
                o, h, l, c = M[k]
                if side > 0 and l <= px - tick:
                    k_fill, entry = k, min(px, o)
                    break
                if side < 0 and h >= px + tick:
                    k_fill, entry = k, max(px, o)
                    break
                if (side > 0 and h >= tp) or (side < 0 and l <= tp):  # ran to target first: cancel
                    break
                k += 1
            if k_fill is None:
                free_t = int(T[min(k, len(T) - 1)]) + 1
                continue
        te = int(T[k_fill])
        if any(a <= te < b for _, a, b in news):
            free_t = te + 1
            continue
        deadline = min(te + rules["max_hold"], flat_t, *[f for f in flatten_at if f > te] or [flat_t])
        # ---- manage
        mae, exit_px, why, k = 0.0, None, None, k_fill
        while k < len(T):
            o, h, l, c = M[k]
            if T[k] >= deadline:
                exit_px, why = o - side * slip, "time"
                break
            adverse = (entry - l) if side > 0 else (h - entry)
            mae = max(mae, adverse)
            hit_stop = (l <= stop) if side > 0 else (h >= stop)
            if hit_stop:
                exit_px = (min(stop, o) if side > 0 else max(stop, o)) - side * slip
                why = "stop"
                break
            if not (s["kind"] == "lmt" and k == k_fill):
                if (side > 0 and h >= tp + tick) or (side < 0 and l <= tp - tick):
                    exit_px = max(tp, o) if side > 0 else min(tp, o)
                    why = "tp"
                    break
            k += 1
        if exit_px is None:
            exit_px, why, k = M[-1, 3] - side * slip, "eod", len(T) - 1
        pnl = side * (exit_px - entry) * pv * n - comm * n
        trades.append(dict(t_in=te, t_out=int(T[k]), side=side, n=n, entry=entry, exit=exit_px,
                           stop=stop, tp=tp, pnl=pnl, why=why, mae=mae * pv * n + comm * n, tag=s.get("tag", "")))
        if s.get("group") is not None:
            done.add(s["group"])
        dpnl += pnl
        losses += pnl < 0
        free_t = int(T[k]) + 1
    return trades


def backtest(data, sym, strat, p, news, days=None, cost_mult=1.0, rules=RULES):
    out = []
    for d in sorted(data):
        if days is not None and d not in days:
            continue
        rec = data[d]
        sigs = strat(rec, p, SPEC[sym]["tick"])
        for tr in run_day(rec, sigs, sym, news.get(d, []), p.get("max_trades", 2), cost_mult, rules):
            tr["date"] = d
            out.append(tr)
    return out


def stats(trades, ndays):
    pnl = np.array([t["pnl"] for t in trades]) if trades else np.zeros(0)
    gp, gl = pnl[pnl > 0].sum(), -pnl[pnl < 0].sum()
    daily = {}
    for t in trades:
        daily[t["date"]] = daily.get(t["date"], 0) + t["pnl"]
    eq = np.cumsum([daily[d] for d in sorted(daily)]) if daily else np.zeros(1)
    dd = float(np.max(np.maximum.accumulate(np.concatenate([[0], eq])) - np.concatenate([[0], eq])))
    return dict(trades=len(pnl), win=float((pnl > 0).mean() * 100) if len(pnl) else 0.0,
                pf=float(gp / gl) if gl > 0 else float("inf") if gp > 0 else 0.0,
                net=float(pnl.sum()), maxdd=dd, per_week=float(pnl.sum() / (ndays / 5.0)) if ndays else 0.0,
                avg=float(pnl.mean()) if len(pnl) else 0.0,
                micros=float(np.mean([t["n"] for t in trades])) if trades else 0.0)


# --------------------------------------------------------------------------- helpers
def _arr(rec):
    f = rec["f5"]
    return (f.o.values, f.h.values, f.l.values, f.c.values, f.t.values,
            f.ema20.values, f.ema50.values, f.atr.values, f.vwap.values, f.vsd.values)


def _sig(t_close, side, px, stop, tp, kind="mkt", expiry=30, tag=""):
    return dict(t=int(t_close), side=side, px=float(px), stop=float(stop), tp=float(tp),
                kind=kind, expiry=expiry, tag=tag)


def _rr(px, stop, r):
    return px + r * (px - stop)


# --------------------------------------------------------------------------- strategy families
def s_orb(rec, p, tick):
    """Opening range breakout: first 5m close beyond the opening range."""
    o, h, l, c, t, *_ = _arr(rec)
    m = t < 570 + p["or_min"]
    if m.sum() < 1:
        return []
    orh, orl = h[m].max(), l[m].min()
    mid = (orh + orl) / 2
    out = []
    for i in np.where(~m & (t + 5 <= p["end"]))[0]:
        if c[i] > orh:
            st = mid if p["stop"] == "mid" else orl - tick
            out.append(_sig(t[i] + 5, 1, c[i], st, _rr(c[i], st, p["tp_r"]), tag="orb"))
            break
        if c[i] < orl:
            st = mid if p["stop"] == "mid" else orh + tick
            out.append(_sig(t[i] + 5, -1, c[i], st, _rr(c[i], st, p["tp_r"]), tag="orb"))
            break
    return out


def s_vwap_mr(rec, p, tick):
    """VWAP mean reversion: rejection of the k-sigma VWAP band, target VWAP."""
    o, h, l, c, t, e20, e50, atr, vw, sd = _arr(rec)
    out = []
    for i in range(len(t)):
        if not (p["start"] <= t[i] + 5 <= p["end"]) or not np.isfinite(sd[i]) or sd[i] <= 0:
            continue
        lo, hi = vw[i] - p["k"] * sd[i], vw[i] + p["k"] * sd[i]
        if l[i] < lo and c[i] > lo and c[i] > o[i]:
            st = l[i] - tick
            if vw[i] - c[i] >= p["min_rr"] * (c[i] - st):
                out.append(_sig(t[i] + 5, 1, c[i], st, vw[i], tag="vwap"))
        elif h[i] > hi and c[i] < hi and c[i] < o[i]:
            st = h[i] + tick
            if c[i] - vw[i] >= p["min_rr"] * (st - c[i]):
                out.append(_sig(t[i] + 5, -1, c[i], st, vw[i], tag="vwap"))
    return out


def s_trend_pb(rec, p, tick):
    """Trend pullback: EMA20>EMA50, pullback tags EMA20 and closes back above it."""
    o, h, l, c, t, e20, e50, atr, vw, sd = _arr(rec)
    out = []
    lb = p["swing"]
    for i in range(lb, len(t)):
        if not (p["start"] <= t[i] + 5 <= p["end"]):
            continue
        if e20[i] > e50[i] and l[i] <= e20[i] < c[i] and c[i] > o[i]:
            st = l[i - lb + 1:i + 1].min() - tick
            out.append(_sig(t[i] + 5, 1, c[i], st, _rr(c[i], st, p["tp_r"]), tag="tpb"))
        elif e20[i] < e50[i] and h[i] >= e20[i] > c[i] and c[i] < o[i]:
            st = h[i - lb + 1:i + 1].max() + tick
            out.append(_sig(t[i] + 5, -1, c[i], st, _rr(c[i], st, p["tp_r"]), tag="tpb"))
    return out


def _fvgs(o, h, l, c, atr, i, disp, tick):
    """Return +1/-1/0 for a fair value gap completed at bar i (bars i-2, i-1, i)."""
    rng = h[i - 1] - l[i - 1]
    if not np.isfinite(atr[i]) or rng < disp * atr[i]:
        return 0
    if l[i] - h[i - 2] >= 2 * tick and c[i - 1] > o[i - 1]:
        return 1
    if l[i - 2] - h[i] >= 2 * tick and c[i - 1] < o[i - 1]:
        return -1
    return 0


def s_fvg(rec, p, tick):
    """ICT fair value gap retest: limit at the gap's consequent encroachment (50%)."""
    o, h, l, c, t, e20, e50, atr, vw, sd = _arr(rec)
    out = []
    for i in range(2, len(t)):
        if not (p["start"] <= t[i] + 5 <= p["end"]):
            continue
        d = _fvgs(o, h, l, c, atr, i, p["disp"], tick)
        if d == 1:
            px = h[i - 2] + p["ce"] * (l[i] - h[i - 2])
            st = min(l[i - 2], l[i - 1]) - tick
            out.append(_sig(t[i] + 5, 1, px, st, _rr(px, st, p["tp_r"]), "lmt", p["expiry"], "fvg"))
        elif d == -1:
            px = l[i - 2] - p["ce"] * (l[i - 2] - h[i])
            st = max(h[i - 2], h[i - 1]) + tick
            out.append(_sig(t[i] + 5, -1, px, st, _rr(px, st, p["tp_r"]), "lmt", p["expiry"], "fvg"))
    return out


def s_silver_bullet(rec, p, tick):
    """ICT Silver Bullet: in 10-11 / 14-15 ET, after a sweep of the session extreme set
    before the window, first FVG in the opposite direction -> limit at FVG edge."""
    o, h, l, c, t, e20, e50, atr, vw, sd = _arr(rec)
    out = []
    for w0, w1 in p["windows"]:
        pre = t < w0
        if pre.sum() < 3:
            continue
        pre_h, pre_l = h[pre].max(), l[pre].min()
        for i in np.where((t >= w0) & (t + 5 <= w1))[0]:
            if i < 2:
                continue
            seg = slice(np.argmax(t >= w0), i + 1)
            d = _fvgs(o, h, l, c, atr, i, p["disp"], tick)
            if d == 1 and l[seg].min() < pre_l:
                px = l[i]
                st = l[seg].min() - tick
                out.append(_sig(t[i] + 5, 1, px, st, _rr(px, st, p["tp_r"]), "lmt", w1 - (t[i] + 5), "sb"))
                break
            if d == -1 and h[seg].max() > pre_h:
                px = h[i]
                st = h[seg].max() + tick
                out.append(_sig(t[i] + 5, -1, px, st, _rr(px, st, p["tp_r"]), "lmt", w1 - (t[i] + 5), "sb"))
                break
    return out


def s_sweep(rec, p, tick):
    """Liquidity sweep reversal of prior-day / overnight high-low (first touch only)."""
    o, h, l, c, t, *_ = _arr(rec)
    out = []
    highs = [x for x in (rec["pdh"], rec["onh"]) if np.isfinite(x)]
    lows = [x for x in (rec["pdl"], rec["onl"]) if np.isfinite(x)]
    for L in highs:
        for i in range(len(t)):
            if h[i] > L:
                if (i == 0 or h[:i].max() < L) and o[i] < L and c[i] < L and c[i] < o[i] \
                        and p["start"] <= t[i] + 5 <= p["end"]:
                    st = h[i] + tick
                    out.append(_sig(t[i] + 5, -1, c[i], st, _rr(c[i], st, p["tp_r"]), tag="sweepH"))
                break
    for L in lows:
        for i in range(len(t)):
            if l[i] < L:
                if (i == 0 or l[:i].min() > L) and o[i] > L and c[i] > L and c[i] > o[i] \
                        and p["start"] <= t[i] + 5 <= p["end"]:
                    st = l[i] - tick
                    out.append(_sig(t[i] + 5, 1, c[i], st, _rr(c[i], st, p["tp_r"]), tag="sweepL"))
                break
    return out


def s_gap_fill(rec, p, tick):
    """Opening gap fade toward prior close after a first-bar rejection."""
    o, h, l, c, t, *_ = _arr(rec)
    if not np.isfinite(rec["pdc"]):
        return []
    gap = (o[0] - rec["pdc"]) / rec["pdc"] * 100
    if not (p["gmin"] <= abs(gap) <= p["gmax"]):
        return []
    if gap > 0 and c[0] < o[0]:
        st = h[0] + tick
        if c[0] - rec["pdc"] >= p["min_rr"] * (st - c[0]):
            return [_sig(t[0] + 5, -1, c[0], st, rec["pdc"], tag="gap")]
    if gap < 0 and c[0] > o[0]:
        st = l[0] - tick
        if rec["pdc"] - c[0] >= p["min_rr"] * (c[0] - st):
            return [_sig(t[0] + 5, 1, c[0], st, rec["pdc"], tag="gap")]
    return []


def s_intraday_mom(rec, p, tick):
    """Intraday momentum (Gao, Han, Li & Zhou 2018): the 09:30-10:00 return predicts
    the last half hour. Enter at 15:25 in that direction, exit by time (15:55)."""
    o, h, l, c, t, e20, e50, atr, vw, sd = _arr(rec)
    i10 = np.where(t == 595)[0]
    ie = np.where(t + 5 == p["entry"])[0]
    if not len(i10) or not len(ie):
        return []
    r = (c[i10[0]] - o[0]) / o[0] * 100
    if abs(r) < p["rmin"] or not np.isfinite(atr[ie[0]]):
        return []
    side = 1 if r > 0 else -1
    px = c[ie[0]]
    st = px - side * p["stop_atr"] * atr[ie[0]]
    return [_sig(p["entry"], side, px, st, _rr(px, st, 10.0), tag="imom")]


FAMILIES = {
    "ORB": (s_orb, dict(or_min=15, tp_r=2.0, stop="mid", end=690, max_trades=1)),
    "VWAP_MR": (s_vwap_mr, dict(k=2.0, min_rr=1.0, start=600, end=900, max_trades=2)),
    "TREND_PB": (s_trend_pb, dict(swing=3, tp_r=2.0, start=585, end=900, max_trades=2)),
    "FVG_RETEST": (s_fvg, dict(disp=1.5, ce=0.5, tp_r=2.0, expiry=30, start=580, end=900, max_trades=2)),
    "SILVER_BULLET": (s_silver_bullet, dict(windows=((600, 660), (840, 900)), disp=1.0, tp_r=2.0, max_trades=2)),
    "SWEEP_REV": (s_sweep, dict(tp_r=2.0, start=575, end=720, max_trades=2)),
    "GAP_FILL": (s_gap_fill, dict(gmin=0.15, gmax=1.0, min_rr=1.0, max_trades=1)),
    # added after the first 7 were evaluated (documented in the report)
    "INTRADAY_MOM": (s_intraday_mom, dict(rmin=0.0, entry=925, stop_atr=2.0, max_trades=1)),
}


def run_day_mgmt(rec, sigs, sym, news, max_trades, rules=RULES, be_r=None):
    """Market-entry executor for scripts that manage their own trade: stop, take-profit
    and an optional break-even move (stop -> signal price once price reaches be_r x R;
    effective from the next minute). Same fills/costs/day-lock as run_day."""
    tick, pv = SPEC[sym]["tick"], SPEC[sym]["pv"]
    slip, comm = tick * rules["slip"], rules["comm"]
    T, M = rec["m1_t"], rec["m1"]
    idx = {int(t): i for i, t in enumerate(T)}
    flat_t = rules["flat"]
    flatten_at = [ev - 2 for ev, _, _ in news]
    trades, free_t, losses, dpnl = [], 0, 0, 0.0
    for s in sorted(sigs, key=lambda x: x["t"]):
        if len(trades) >= max_trades or losses >= rules["max_losses"] or dpnl <= rules["max_day_loss"]:
            break
        if s["t"] < free_t or s["t"] >= flat_t - 5 or s["t"] not in idx:
            continue
        side, px, stop, tp = s["side"], s["px"], s["stop"], s["tp"]
        if side * (px - stop) <= 0 or side * (tp - px) <= 0:
            continue
        risk = abs(px - stop)
        n = min(rules["max_micros"], int(math.floor(rules["risk"] / ((risk + 2 * slip) * pv + comm))))
        if n < 1:
            continue
        k = idx[s["t"]]
        te = int(T[k])
        if any(a <= te < b for _, a, b in news):
            continue
        entry = M[k, 0] + side * slip
        be_px = px + side * be_r * risk if be_r else None
        moved = False
        deadline = min([te + rules["max_hold"], flat_t] + [f for f in flatten_at if f > te])
        exit_px, why = None, None
        while k < len(T):
            o, h, l, c = M[k]
            if T[k] >= deadline:
                exit_px, why = o - side * slip, "time"
                break
            if (l <= stop) if side > 0 else (h >= stop):
                exit_px = (min(stop, o) if side > 0 else max(stop, o)) - side * slip
                why = "breakeven" if moved else "stop"
                break
            if (h >= tp + tick) if side > 0 else (l <= tp - tick):
                exit_px, why = (max(tp, o) if side > 0 else min(tp, o)), "tp"
                break
            if be_px is not None and not moved and ((h >= be_px) if side > 0 else (l <= be_px)):
                stop, moved = px, True
            k += 1
        if exit_px is None:
            k = len(T) - 1
            exit_px, why = M[k, 3] - side * slip, "eod"
        pnl = side * (exit_px - entry) * pv * n - comm * n
        trades.append(dict(t_in=te, t_out=int(T[k]), side=side, n=n, entry=entry, exit=exit_px, stop=s["stop"], tp=tp,
                           pnl=pnl, why=why, be_moved=moved, tag=s.get("tag", "")))
        dpnl += pnl
        losses += pnl < 0
        free_t = int(T[k]) + 1
    return trades
