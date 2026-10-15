"""Data preparation for the ES/NQ day-trading study.

Sources (real CME 1-minute bars, Hugging Face):
  ES: Khanhpham1992/es-futures-1m  (es_continuous_1m.parquet, UTC, raw front-month prices)
  NQ: mdelcristo/NQ-F_1min_OHLCV_Parquet (NQ_1min_YYYY.parquet, UTC naive)

Output (per instrument):
  <out>/<SYM>_trainval.pkl   train + validation days (research may read these)
  <out>/<SYM>_test.pkl       test days, held out until the final step (sha256 recorded)

Usage: python -I prep.py <raw_dir> <out_dir>
"""
import glob
import hashlib
import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

START, END = pd.Timestamp("2020-11-17").date(), pd.Timestamp("2024-07-19").date()
RTH_OPEN, RTH_CLOSE = 9 * 60 + 30, 16 * 60  # minutes from midnight ET


def load(raw, sym):
    if sym == "ES":
        df = pd.read_parquet(os.path.join(raw, "es_continuous_1m.parquet"))
        df = df[["open", "high", "low", "close", "volume"]]
        df.index = df.index.tz_convert("America/New_York")
    else:
        files = sorted(glob.glob(os.path.join(raw, "NQ_1min_20*.parquet")))
        df = pd.concat([pd.read_parquet(f) for f in files], sort=True).set_index("timestamp")
        df = df[~df.index.duplicated()].sort_index()
        df.index = df.index.tz_localize("UTC").tz_convert("America/New_York")
        df = df[["open", "high", "low", "close", "volume"]]
    df.columns = ["o", "h", "l", "c", "v"]
    return df.sort_index()


def full_rth_days(df):
    t = df.index.hour * 60 + df.index.minute
    x = df[(t >= RTH_OPEN) & (t < RTH_CLOSE) & (df.index.dayofweek < 5)]
    n = x.groupby(x.index.date).size()
    return set(n[n >= 300].index)


def build(df, days, calendar):
    """Return dict date -> day record. Indicators that span sessions (EMA, ATR) are
    computed on the full 24h 5-minute series so contract rolls (which occur in the
    overnight session) are absorbed long before the RTH open."""
    # 24h 5-minute bars (label = bar start)
    b5 = df.resample("5min", label="left", closed="left").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"}).dropna()
    b5["ema20"] = b5.c.ewm(span=20, adjust=False).mean()
    b5["ema50"] = b5.c.ewm(span=50, adjust=False).mean()
    b5["atr"] = (b5.h - b5.l).rolling(14).mean()  # range-based ATR (roll-gap safe)

    cal_idx = {d: i for i, d in enumerate(calendar)}
    out = {}
    tmin = df.index.hour * 60 + df.index.minute
    for d in sorted(days):
        if d not in cal_idx:
            continue
        day0 = pd.Timestamp(d).tz_localize("America/New_York")
        m1 = df[(df.index >= day0 + pd.Timedelta(minutes=RTH_OPEN)) & (df.index < day0 + pd.Timedelta(minutes=RTH_CLOSE))]
        f5 = b5[(b5.index >= day0 + pd.Timedelta(minutes=RTH_OPEN)) & (b5.index < day0 + pd.Timedelta(minutes=RTH_CLOSE))].copy()
        if len(m1) < 300 or len(f5) < 60:
            continue
        # RTH VWAP and volume-weighted std of typical price, sampled at each 5m bar close
        tp = (m1.h + m1.l + m1.c) / 3.0
        cv = m1.v.cumsum().replace(0, np.nan)
        vwap = (tp * m1.v).cumsum() / cv
        var = (tp * tp * m1.v).cumsum() / cv - vwap * vwap
        sd = np.sqrt(var.clip(lower=0))
        # value at the last 1m bar inside each 5m bar = value known at 5m close
        key = m1.index.floor("5min")
        f5["vwap"] = vwap.groupby(key).last().reindex(f5.index).values
        f5["vsd"] = sd.groupby(key).last().reindex(f5.index).values
        # overnight session (18:00 prior evening -> 09:29)
        on = df[(df.index >= day0 - pd.Timedelta(hours=6)) & (df.index < day0 + pd.Timedelta(minutes=RTH_OPEN))]
        onh = on.h.max() if len(on) >= 300 else np.nan
        onl = on.l.min() if len(on) >= 300 else np.nan
        f5.index.name = "ts"
        out[d] = dict(
            m1_t=(m1.index.hour * 60 + m1.index.minute).values.astype(np.int32),
            m1=m1[["o", "h", "l", "c"]].values,
            f5=f5.reset_index(),
            onh=onh, onl=onl,
            rth_h=m1.h.max(), rth_l=m1.l.min(), rth_c=m1.c.iloc[-1], rth_o=m1.o.iloc[0],
        )
        out[d]["f5"]["t"] = (out[d]["f5"]["ts"].dt.hour * 60 + out[d]["f5"]["ts"].dt.minute).astype(int)
    # prior-day levels only when the previous calendar trading day is present
    for d, rec in out.items():
        i = cal_idx[d]
        p = calendar[i - 1] if i > 0 else None
        if p is not None and p in out:
            rec["pdh"], rec["pdl"], rec["pdc"] = out[p]["rth_h"], out[p]["rth_l"], out[p]["rth_c"]
        else:
            rec["pdh"] = rec["pdl"] = rec["pdc"] = np.nan
    return out


def main(raw, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    data = {s: load(raw, s) for s in ("ES", "NQ")}
    # master calendar = full NQ RTH days (NQ file has complete coverage) within the common window
    calendar = sorted(d for d in full_rth_days(data["NQ"]) if START <= d <= END)
    n = len(calendar)
    train_end, val_end = calendar[n // 2 - 1], calendar[(3 * n) // 4 - 1]
    split = dict(train=(str(calendar[0]), str(train_end)),
                 validation=(str(calendar[n // 2]), str(val_end)),
                 test=(str(calendar[(3 * n) // 4]), str(calendar[-1])))
    meta = dict(split=split, calendar=[str(d) for d in calendar], hashes={}, counts={})
    for s, df in data.items():
        days = full_rth_days(df)
        rec = build(df, days, calendar)
        tv = {d: r for d, r in rec.items() if d <= val_end}
        te = {d: r for d, r in rec.items() if d > val_end}
        with open(os.path.join(out_dir, f"{s}_trainval.pkl"), "wb") as f:
            pickle.dump(tv, f)
        p = os.path.join(out_dir, f"{s}_test.pkl")
        with open(p, "wb") as f:
            pickle.dump(te, f)
        meta["hashes"][s] = hashlib.sha256(open(p, "rb").read()).hexdigest()
        meta["counts"][s] = dict(
            train=sum(d <= train_end for d in tv), validation=sum(d > train_end for d in tv), test=len(te))
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(json.dumps({k: meta[k] for k in ("split", "counts", "hashes")}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
