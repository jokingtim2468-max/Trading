# Plan: machine-learning signal bot (TradingView + Tradovate, Lucid accounts)

## What the ML does (and what it can't)

Funds use ML mostly to **filter and size** trades from ideas that already have a small edge, using lots of data. It
rarely finds an edge from raw price alone. So the model here does **meta-labeling** (López de Prado): our existing
signals propose a trade, and the model answers "how likely is this one to work, and how big should it be?"

- Base signals (already tested): NQ opening drive with adds/trail (the improver's best), VWAP fade with the trend,
  gold/NQ opening-range breakout.
- The model sees each proposed trade's context and gives a probability it hits its target before its stop.
- Trades below a threshold are skipped; the rest are sized by that probability, inside Lucid's limits.

Success is measured the same way as everything so far: walk-forward 2019-2025 (each year trained only on earlier years)
and one grade on 2026. **Go/no-go:** the ML version must beat the plain bot on 2026 after costs, or it isn't used.

## Architecture

```
TradingView (Pine)                QuantBot (this app, local)                     Execution
------------------                -------------------------                      ---------
QB Signal Bot draws the  --->  /api/signals webhook: candidate trade + features  ---> Tradovate demo / own Tradovate
setup and sends a webhook      ML scorer (LightGBM, Python sidecar)                    account (QuantBot copier, API)
with its features              -> P(win), size, Lucid rule guard (DLL, MLL,     ---> Lucid accounts on Tradovate via a
                               4:45 PM flat, max contracts, weekly limits)            webhook bridge (TradersPost /
QuantBot Terminal chart  <---  decision + reason shown on the chart and journal        PickMyTrade), since prop accounts
                                                                                      don't get Tradovate API keys
```

- **Why the model can't run inside TradingView:** Pine can't load a trained model or call out to one. Two ways round it:
  - **A. Bake a small model into Pine:** logistic regression or a depth-2/3 tree ensemble, exported as numbers into
    the script. It runs on the chart with no server, but only with features Pine can compute.
  - **B. Score in QuantBot (recommended):** Pine sends each candidate with its features, QuantBot's model decides,
    and orders go out. This allows any model and any data.
  - **Plan: B for trading, with A as the on-chart mirror** so TradingView still shows what the model would do.
- **Lucid rules:** Lucid's help center says automated systems and trade copiers are permitted. Its Tradovate prop
  accounts can't use the Tradovate API directly, so Lucid orders go through a webhook bridge.
  - Check Lucid's current automation and copy-trading rules before going live.
  - Check the bridge's price and Lucid support on its own site before paying for it.

## Data

| Data | Have? | Needed for | Source |
|---|---|---|---|
| NQ M5 2012-2026, gold M5 2004-2026 | yes | everything | MT5 exports |
| Real futures volume (the NQ export's volume is fake: always 5) | no | volume/order-flow features | TradingView CSV export of NQ1!/MNQ1!, or a paid CME feed (Databento, check price) |
| ES, DXY, 10-year yield, VIX daily | no | cross-market context | TradingView exports (free) |
| Economic calendar (CPI, NFP, FOMC times) | no | news filter | public calendars |

## Features (per candidate trade, all known at entry time)

- **Volatility:** ATR now vs its 20/100-day median; overnight range vs ATR; first-bar range.
- **Trend:** distance from EMA 20/50/200 on M5, H1, D1; daily trend state; 5/20-day return.
- **Gap:** size in ATRs, direction vs the signal; overnight high/low break.
- **Time:** weekday; day of month (month-end); minutes since open.
- **Recent trades:** results of the last 5 signals; days since a big win.
- **Cross-market:** ES/NQ agreement, DXY and yields direction (gold), VIX level and change.
- **Volume/order flow** (once real volume exists): relative volume of the first bars, up/down volume imbalance.
- **News:** a high-impact release inside the trade window.

## Labels and model

- **Label:** triple barrier. 1 if the target is hit first, 0 if the stop is hit first; time exit at 15:55 ET,
  labelled by its sign. Also the trade's R, for regression and sizing.
- **Model:** LightGBM (fast, works with a few thousand rows), with logistic regression as the sanity baseline.
  Probabilities calibrated with isotonic regression.
- **Validation:** purged walk-forward (no overlapping trades between train and test, 5-day embargo), training on
  everything before year Y and testing Y.
- **Decision:** take the trade when P(win) is above a threshold picked on earlier years only. Size is fractional
  Kelly from P and R, capped by QuantBot's rule guard (risk share, DLL, MLL room, weekly limits, max contracts).
- **Overfitting guards:**
  - Feature count kept small: at most about 15 features for every 300 trades.
  - Feature importance must be stable across years.
  - A model that only wins in one half of 2019-2025 is rejected (same rule as the improver).
  - 2026 is used once.

## Phases

| Phase | What | Done when |
|---|---|---|
| 1. Labels + features | `scripts/ml/dataset.py`: one row per candidate trade with features and triple-barrier labels | dataset builds from the current exports |
| 2. Model + walk-forward | `scripts/ml/train.py`: LightGBM meta-model, purged walk-forward 2019-2025, calibration, threshold | report vs the plain bot, per year |
| 3. Exam + stress | 2026 graded once; costs +1/+2.5 pts; Monte Carlo blow-up odds on 150K | **go/no-go**: beats the plain bot on 2026 after costs |
| 4. Scoring service | QuantBot Python sidecar loads the model; `/api/signals` scores Pine webhooks; decision and reason on the Terminal | a TradingView alert produces a scored decision |
| 5. Pine mirror | export a small version of the model into `qb-signal-bot.pine` (option A) | the chart shows take/skip like the server |
| 6. Paper | Tradovate demo, 4-8 weeks, live decisions logged vs backtest | live results inside the backtest's range |
| 7. Lucid | one 150K eval through the webhook bridge, then the copier to more accounts | eval passed, payouts on schedule |

## Costs to check before paying (user rule: only if it stays profitable)

- **CME real-time data on TradingView:** monthly fee (check the current price).
- **Webhook bridge for Lucid:** monthly fee (check the price and that it supports Lucid).
- **Optional paid futures data feed:** usage-based (check the price).
- **Lucid evaluations.**

At the plain bot's size (about +$140 a week on a 150K in 2026), these costs must stay well under the profit. If they
don't, use the free paths: own Tradovate demo and TradingView exports.
