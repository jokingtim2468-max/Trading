# Plan: machine-learning signal bot for TradingView (signals only, no auto trading)

## Goal

A TradingView indicator that tells you **when to buy or sell, where the stop and target go, and how confident the
model is**. You place the trades yourself (Tradovate, Lucid). Nothing trades automatically.

## Why the model lives inside the Pine script

TradingView can't take live data from an outside app into a Pine script:
- Pine has no way to call a server.
- TradingView's only route for custom data (Pine Seeds, `request.seed()`) only ever carried end-of-day data from a
  GitHub repo, and it has been suspended.

So the plan is:

1. **Train** the model in QuantBot (Python, on your 2004-2026 gold and 2012-2026 NQ data, plus any new exports).
2. **Export** it as plain numbers into the Pine script: a calibrated logistic regression and a small boosted-tree
   ensemble (depth 2-3, up to about 60 trees) written out as `if/else` code.
3. **The script computes the same features on the chart** and shows each signal with the model's probability:
   `BUY 72% · SL ... · TP ...`. Low-probability setups are shown faded, or hidden.
4. **Retrain monthly** with new exports. QuantBot writes a new `qb-ml-signals.pine` and you paste it into TradingView.

What you get on the chart:
- The BUY/SELL label, the stop and target lines, contracts for your $ risk, and the probability.
- An alert you can get on your phone.

## What the ML does

It does **meta-labeling**: the base signals propose a trade, and the model rates it.
- **Base signals (already tested):** NQ opening drive with adds/trail (the improver's best), VWAP fade with the trend,
  opening-range breakout.
- **The model answers:** "given everything known at this bar, how likely is this setup to reach its target before its
  stop?"

This is how ML is mostly used in trading: filtering and sizing ideas that already have an edge, not predicting price
from nothing.

## Features (all computable in Pine, all known at the signal bar)

- **Volatility:** ATR vs its 100-bar median; first-bar range vs ATR; overnight range vs ATR.
- **Trend:** distance from EMA 20/50/200 in ATRs; H1 and D1 trend (closed bars, `request.security`); 5/20-day return.
- **Gap:** size in ATRs, direction vs the signal; overnight high/low break.
- **Time:** weekday; minutes since the open; month-end.
- **Momentum:** RSI(14); the previous day's range and direction.
- **Volume** (only with real CME volume on your TradingView feed): relative volume of the first bars.
- **Cross-market** (`request.security` on ES1!, DXY, VIX): ES agreeing with NQ, DXY direction for gold.

## Training and checks

- **Label:** triple barrier. 1 = the target is hit before the stop, 0 = the stop first; time exit at 15:55 ET by sign.
- **Models:** logistic regression (baseline) and sklearn gradient boosting with small trees, both calibrated.
- **Validation:** walk-forward. Each year from 2019 to 2025 is predicted by a model trained only on earlier years,
  with a 5-day gap between train and test.
- **Threshold:** the probability needed to show a signal as "take", picked on earlier years only.
- **Exam:** 2026 graded once.
- **Go/no-go:** the ML-filtered signals must beat the plain signals on 2026 after costs. If they don't, the script keeps
  the plain signals and shows the probability only as information.
- **Overfitting guards:** few features per trade count; feature importance stable across years; reject models that
  only work in one half of 2019-2025.

## Phases

| Phase | What | Done when |
|---|---|---|
| 1. Dataset | `scripts/ml/dataset.py`: one row per candidate signal, features computed exactly as Pine will, triple-barrier label | builds from the current exports |
| 2. Models | `scripts/ml/train.py`: walk-forward logistic and boosted trees, calibration, threshold, per-year report vs plain signals | report written to `research/ml-report.json` |
| 3. Exam + stress | 2026 once; costs +1/+2.5 pts; Monte Carlo on a 150K at 1 MNQ | **go/no-go** |
| 4. Pine export | `scripts/ml/export_pine.py` writes `strategies/qb-ml-signals.pine` (features + model as code + labels/lines/alerts) | the script's probabilities match Python's on the same bars |
| 5. Check on TradingView | add to an MNQ / MGC 5-minute chart, compare 20 recent signals with QuantBot's | they match |
| 6. Monthly retrain | `scripts/ml/retrain.sh`: re-export data, rebuild, re-test, write a new Pine file if it still passes | one command |

## Costs

- **Free:** your existing exports, Python, sklearn, TradingView alerts.
- **Optional:** TradingView's CME real-time data add-on, needed for the volume features. Check the current price before
  adding it, and only if the volume features earn more than they cost.
