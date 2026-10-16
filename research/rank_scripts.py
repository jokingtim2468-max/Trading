"""Rank every simulated TradingView script / version by net P&L (NQ / US100 5m,
2015-01-02 to 2025-05-30, MNQ, after costs). Reads the *_summary.json files."""
import json
import os
import sys

R = sys.argv[1] if len(sys.argv) > 1 else "results"


def j(p):
    return json.load(open(os.path.join(R, p)))


rows = []
dol, dolf, ifvg, tbr, orb = (j("dol/dol_summary.json"), j("dol_fixed/dol_summary.json"), j("ifvg/ifvg_summary.json"),
                             j("tbr/tbr_summary.json"), j("orb/orb_summary.json"))
rows.append(("TradeAxis DOL", "as written (pool clogs, few signals)", "$150", dol["overall"]))
rows.append(("TradeAxis DOL", "dead-level bug fixed", "$150", dolf["overall"]))
rows.append(("iFVG Ultimate+", "script lines (BE, no target)", "$150", ifvg["script_lines"]["overall"]))
rows.append(("iFVG Ultimate+", "+ 2R target", "$150", ifvg["2R_target"]["overall"]))
rows.append(("TBR Sessions", "A: 0.618 Fib line", "$150", tbr["A_fib618"]["overall"]))
rows.append(("TBR Sessions", "B: sweep reversal", "$150", tbr["B_sweep"]["overall"]))
for k in ("V4.1 as written", "V4.1 script $150", "V4.1 Lucid", "V3.1 as written", "V3.1 script $150", "V3.1 Lucid"):
    risk = "$500" if "as written" in k else "$150"
    rows.append(("TradeX QuantORB", k.replace("script $150", "script rules").replace("Lucid", "Lucid rules (1h cap)"),
                 risk, orb[k]["overall"]))
smc = j("smc/smc_summary.json")
for m in ("Model 1 IFVG", "Model 2 MSS+EQ", "Model 3 CISD"):
    for acct in ("script rules", "Lucid rules"):
        rows.append(("SMC Sniper Pro", f"{m}, {acct}" + (" (1h cap)" if acct == "Lucid rules" else ""), "$150",
                     smc[f"{m} {acct}"]["overall"]))
rib = j("ribbon/ribbon_summary.json")
for m, nm in (("A arrow-to-arrow", "A: BUY to SELL arrow"), ("B strong-trend-only", "B: exit when ribbon unaligns")):
    for acct in ("script rules", "Lucid rules"):
        rows.append(("SUPER INDIBOT Ribbon", f"{nm}, {acct}", "$150", rib[f"{m} {acct}"]["overall"]))
lq = j("liqdol/liqdol_summary.json")
for v in ("all DOLs", "PoT>=60%"):
    for acct in ("script rules", "Lucid rules"):
        rows.append(("Liquidity DOL Scoring", f"{'every new DOL' if v == 'all DOLs' else 'only PoT >= 60%'}, {acct}",
                     "$150", lq[f"{v} {acct}"]["overall"]))
ss = j("smcsuite/smcsuite_summary.json")
for r in ("A OB retest", "B sweep reversal", "C BOS/CHoCH continuation"):
    for acct in ("script rules", "Lucid rules"):
        rows.append(("SMC Concepts Suite", f"{r}, {acct}", "$150", ss[f"{r} {acct}"]["overall"]))
rows.sort(key=lambda r: -r[3]["net"])
out = []
for i, (s, v, risk, o) in enumerate(rows, 1):
    out.append(dict(rank=i, script=s, version=v, risk=risk, trades=o["trades"], win=round(o["win"], 1),
                    pf=round(o["pf"], 2), net=round(o["net"]), maxdd=round(o["maxdd"]), per_week=round(o["per_week"], 1)))
    print(f"{i:2d}. {s:22s} {v:42s} risk {risk:5s} net ${o['net']:>10,.0f}  maxDD ${o['maxdd']:>9,.0f}  "
          f"PF {o['pf']:.2f}  trades {o['trades']}")
json.dump(out, open(os.path.join(R, "ranking.json"), "w"), indent=1)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker

BG, GRID, TXT, MUTED = "#131722", "#2a2e39", "#d1d4dc", "#787b86"
plt.rcParams.update({"axes.facecolor": BG, "figure.facecolor": BG, "axes.edgecolor": GRID, "axes.labelcolor": TXT,
                     "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": GRID,
                     "font.size": 10, "text.parse_math": False})
fig, ax = plt.subplots(figsize=(13, 14))
labels = [f"#{r['rank']}  {r['script']} - {r['version']}  ({r['risk']} risk)" for r in out][::-1]
vals = [r["net"] for r in out][::-1]
cols = ["#089981" if v > 0 else "#F23645" for v in vals]
y = list(range(len(vals)))
LO = -50000  # clip the axis so the -$190k outlier does not flatten everything else
shown = [max(v, LO + 2000) for v in vals]
ax.barh(y, shown, color=cols, height=0.6)
for yi, v in zip(y, vals):
    if v < LO + 2000:
        ax.annotate("<< bar clipped", (LO + 2000, yi), xytext=(4, 0), textcoords="offset points", va="center",
                    fontsize=8, color="white")
ax.set_yticks(y, labels, fontsize=9)
ax.axvline(0, color=MUTED, lw=1)
for yi, r in zip(y, out[::-1]):
    ax.annotate(f"${r['net']:,.0f}   (max DD ${r['maxdd']:,.0f})", (max(r["net"], 0), yi), xytext=(6, 0),
                textcoords="offset points", ha="left", va="center", fontsize=8.5, color=TXT)
ax.set_xlim(LO, 62000)
ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
ax.set_xlabel("Net P&L 2015-2025 ($, MNQ, after costs)")
ax.set_title("Your TradingView scripts ranked by net P&L on NQ / US100 5m (2015-01-02 to 2025-05-30)", loc="left")
ax.grid(True, axis="x", lw=0.5)
fig.tight_layout()
fig.savefig(os.path.join(R, "ranking.png"), dpi=130)
