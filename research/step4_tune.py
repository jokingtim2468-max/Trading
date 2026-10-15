"""Step 4: limited one-parameter-at-a-time tuning of the two best train families.

Pre-declared menus (written before any validation run). Objective on a period =
min(PF_ES, PF_NQ) - the worst instrument. A change is picked on TRAIN and kept only
if VALIDATION also improves; stop at the first round where validation does not
improve (max 3 rounds)."""
import datetime as dt
import json
import sys

import bt

MENU = {
    "GAP_FILL": dict(gmin=[0.10, 0.25], gmax=[0.5, 2.0], min_rr=[0.5, 1.5]),
    "ORB": dict(or_min=[5, 30], tp_r=[1.5, 3.0], stop=["opp"], end=[630, 900]),
}

data_dir = sys.argv[1]
TE = dt.date.fromisoformat(bt.TRAIN_END)
data = {s: bt.load(data_dir, s) for s in ("ES", "NQ")}
news = bt.news_windows(sorted(set(data["NQ"]) | set(data["ES"])))
period = {s: dict(train={d for d in data[s] if d <= TE}, val={d for d in data[s] if d > TE}) for s in data}


def evaluate(fn, p, per):
    r = {s: bt.stats(bt.backtest(data[s], s, fn, p, news, period[s][per]), len(period[s][per])) for s in data}
    return min(r["ES"]["pf"], r["NQ"]["pf"]), r


def fmt(r):
    return "  ".join(f"{s}: n={r[s]['trades']:3d} PF={r[s]['pf']:4.2f} net=${r[s]['net']:7.0f}" for s in ("ES", "NQ"))


log = {}
for name, menu in MENU.items():
    fn, cur = bt.FAMILIES[name]
    cur = dict(cur)
    tr_obj, tr = evaluate(fn, cur, "train")
    va_obj, va = evaluate(fn, cur, "val")
    print(f"\n== {name} defaults  TRAIN {fmt(tr)} | VAL {fmt(va)}")
    steps = [dict(params=dict(cur), train=tr, val=va, accepted=True)]
    for rnd in range(1, 4):
        best = None
        for k, vals in menu.items():
            for v in vals:
                if cur.get(k) == v:
                    continue
                cand = dict(cur, **{k: v})
                o, r = evaluate(fn, cand, "train")
                print(f"   r{rnd} try {k}={v}: TRAIN {fmt(r)}  obj={o:.2f}")
                if best is None or o > best[0]:
                    best = (o, cand, r, k, v)
        if best is None or best[0] <= tr_obj:
            print(f"   r{rnd}: no train improvement -> stop")
            break
        o_v, r_v = evaluate(fn, best[1], "val")
        ok = o_v > va_obj
        print(f"   r{rnd} pick {best[3]}={best[4]} train obj {tr_obj:.2f}->{best[0]:.2f}; "
              f"VAL obj {va_obj:.2f}->{o_v:.2f}  VAL {fmt(r_v)}  {'ACCEPT' if ok else 'REJECT -> stop'}")
        steps.append(dict(params=best[1], train=best[2], val=r_v, accepted=ok))
        if not ok:
            break
        cur, tr_obj, va_obj = best[1], best[0], o_v
    final_tr = evaluate(fn, cur, "train")[1]
    passes = all(final_tr[s]["net"] > 0 and final_tr[s]["trades"] >= 40 and final_tr[s]["pf"] > 1.3 for s in data)
    print(f"   FINAL {name} {cur}\n   TRAIN {fmt(final_tr)}  -> train gate {'PASS' if passes else 'FAIL'}")
    log[name] = dict(steps=steps, final=cur, train_gate=passes)
json.dump(log, open(sys.argv[2], "w"), indent=1, default=str)
