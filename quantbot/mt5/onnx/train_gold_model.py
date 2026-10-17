#!/usr/bin/env python3
"""Train gold_model.onnx for XAUUSD_ONNX_Production.mq5 on an MT5 XAUUSD M5 export, and test it on unseen years.

    pip install numpy pandas scikit-learn skl2onnx onnxruntime
    python train_gold_model.py XAUUSD_M5_....csv

M5 bars are grouped into H1 bars. Each H1 bar gets 12 features, all computed from closed bars only; features() in the
EA uses the same formulas, so keep the two in sync. The label asks, from the next bar's open: does price reach +TP ATR
before -SL ATR within 48 bars (long win, class 1), the mirror image (short win, class 2), or neither (class 0)? A bar
where the stop and the target are both touched counts as the stop. Training: 2004-2019. Threshold picked on
2020-2022. Test: 2023 onward, never touched while building the model.
"""
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier

SL_ATR, TP_ATR, HORIZON, COST = 1.5, 3.0, 48, 0.30  # cost: $ per ounce round trip (spread + slippage)
N_FEATURES = 12


def load_h1(path):
    df = pd.read_csv(path, sep="\t")
    df.columns = [c.strip("<>").lower() for c in df.columns]
    t = pd.to_datetime(df["date"] + " " + df["time"], format="%Y.%m.%d %H:%M:%S")
    df = df.set_index(t)[["open", "high", "low", "close"]]
    h = df.resample("1h").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    return h


def features(h):
    o, hi, lo, c = (h[k].to_numpy() for k in ("open", "high", "low", "close"))
    prev = np.r_[np.nan, c[:-1]]
    tr = np.maximum(hi - lo, np.maximum(np.abs(hi - prev), np.abs(lo - prev)))
    atr14 = pd.Series(tr).rolling(14).mean().to_numpy()
    atr100 = pd.Series(tr).rolling(100).mean().to_numpy()
    cs = pd.Series(c)
    f = {}
    for k in (1, 2, 4, 8, 24):
        f[f"r{k}"] = (c - cs.shift(k).to_numpy()) / atr14
    for n in (24, 120):
        hh = pd.Series(hi).rolling(n).max().to_numpy(); ll = pd.Series(lo).rolling(n).min().to_numpy()
        f[f"pos{n}"] = (c - ll) / np.maximum(hh - ll, 1e-9)
    f["vol"] = atr14 / atr100
    f["body"] = (c - o) / atr14
    f["range"] = (hi - lo) / atr14
    hour = h.index.hour.to_numpy()
    f["hsin"] = np.sin(2 * np.pi * hour / 24); f["hcos"] = np.cos(2 * np.pi * hour / 24)
    X = np.column_stack(list(f.values())).astype(np.float32)
    # Row i = features at the close of bar i; the trade opens at bar i+1's open
    return X, atr14


def outcomes(h, atr):
    """Per bar i: R of a long and a short opened at open[i+1] with ATR(i) stops, after costs, and the exit bar."""
    o, hi, lo = (h[k].to_numpy() for k in ("open", "high", "low"))
    n = len(o)
    lr, sr, lx, sx = (np.full(n, np.nan) for _ in range(4))
    for i in range(n - HORIZON - 2):
        a = atr[i]
        if not a > 0:
            continue
        e = o[i + 1]; risk = SL_ATR * a; cost_r = COST / risk
        for side, out, ex in ((1, lr, lx), (-1, sr, sx)):
            sl, tp = e - side * risk, e + side * TP_ATR * a
            res, j_end = None, i + HORIZON
            for j in range(i + 1, i + 1 + HORIZON):
                hit_sl = lo[j] <= sl if side == 1 else hi[j] >= sl
                hit_tp = hi[j] >= tp if side == 1 else lo[j] <= tp
                if hit_sl: res, j_end = -1.0, j; break
                if hit_tp: res, j_end = TP_ATR / SL_ATR, j; break
            if res is None:
                res = side * (o[j_end + 1] - e) / risk
            out[i], ex[i] = res - cost_r, j_end
    return lr, sr, lx, sx


def simulate(idx, p, lr, sr, lx, sx, thr, risk=0.005):
    """One position at a time; risk 0.5% of equity per trade; returns the stats."""
    eq, peak, maxdd, i, rs, years = 1.0, 1.0, 0.0, 0, [], {}
    n = len(idx)
    while i < n:
        k = idx[i]
        side = 1 if p[i, 1] > thr and p[i, 1] >= p[i, 2] else (-1 if p[i, 2] > thr else 0)
        if side == 0 or np.isnan(lr[k]):
            i += 1; continue
        r = lr[k] if side == 1 else sr[k]
        exit_bar = lx[k] if side == 1 else sx[k]
        rs.append(r); eq *= 1 + risk * r
        peak = max(peak, eq); maxdd = max(maxdd, 1 - eq / peak)
        while i < n and idx[i] <= exit_bar:
            i += 1
    rs = np.array(rs)
    if len(rs) == 0:
        return {"trades": 0}
    win, loss = rs[rs > 0].sum(), -rs[rs < 0].sum()
    return {"trades": len(rs), "win%": round(100 * (rs > 0).mean(), 1), "PF": round(win / loss, 2) if loss else float("inf"),
            "totalR": round(rs.sum(), 1), "avgR": round(rs.mean(), 3), "return%": round(100 * (eq - 1), 1), "maxDD%": round(100 * maxdd, 1)}


def main(path, out="gold_model.onnx"):
    h = load_h1(path)
    X, atr = features(h)
    lr, sr, lx, sx = outcomes(h, atr)
    y = np.where(lr > 0.5, 1, np.where(sr > 0.5, 2, 0))
    ok = ~np.isnan(X).any(axis=1) & ~np.isnan(lr) & ~np.isnan(sr)
    yr = h.index.year.to_numpy()
    tr, va, te = ok & (yr <= 2019), ok & (yr >= 2020) & (yr <= 2022), ok & (yr >= 2023)
    print(f"H1 bars {len(h)}, train {tr.sum()}, pick {va.sum()}, test {te.sum()}; class mix (train) {np.bincount(y[tr]) / tr.sum()}")
    # (HistGradientBoosting doesn't convert to ONNX with current skl2onnx, so the classic one)
    clf = GradientBoostingClassifier(n_estimators=200, learning_rate=0.05, max_depth=3, min_samples_leaf=200, subsample=0.5,
                                     random_state=7).fit(X[tr], y[tr])
    best = None
    for thr in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65):
        idx = np.where(va)[0]
        s = simulate(idx, clf.predict_proba(X[idx]), lr, sr, lx, sx, thr)
        print(f"  pick 2020-2022 thr {thr:.2f}: {s}")
        if s.get("trades", 0) >= 60 and (best is None or s["totalR"] > best[1]["totalR"]):
            best = (thr, s)
    thr = best[0] if best else 0.65
    for name, m in (("train 2004-2019 (seen)", tr), ("pick 2020-2022", va), ("TEST 2023-2026 (unseen)", te)):
        idx = np.where(m)[0]
        print(f"{name:26s} thr {thr:.2f}: {simulate(idx, clf.predict_proba(X[idx]), lr, sr, lx, sx, thr)}")
    # Baseline: random entries at the same rate, to see whether the model adds anything
    rng = np.random.default_rng(1); idx = np.where(te)[0]
    rp = rng.random((len(idx), 3)); rp[:, 0] = 0
    print(f"{'random entries 2023-2026':26s}        : {simulate(idx, rp, lr, sr, lx, sx, 0.97)}")
    from skl2onnx import to_onnx
    onx = to_onnx(clf, X[:1], options={id(clf): {"zipmap": False}}, target_opset={"": 15, "ai.onnx.ml": 3})
    open(out, "wb").write(onx.SerializeToString())
    import onnxruntime as ort
    sess = ort.InferenceSession(out)
    got = sess.run(None, {sess.get_inputs()[0].name: X[te][:2000]})[1]
    print(f"ONNX matches scikit-learn: max probability difference {np.abs(got - clf.predict_proba(X[te][:2000])).max():.2e}")
    print(f"saved {out}; threshold {thr:.2f}; inputs [1,{N_FEATURES}] float, outputs label + probabilities [none, long, short]")


if __name__ == "__main__":
    main(sys.argv[1], *(sys.argv[2:3]))
