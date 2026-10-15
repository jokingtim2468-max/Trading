# ES / NQ day-trading study for a Lucid 25K eval: result = NO STRATEGY QUALIFIED

**Bottom line:** none of the 8 strategy families passed the train gate (profitable on both ES and NQ, ≥40 trades,
PF > 1.3 after costs). Limited tuning was rejected by validation. The two closest candidates also failed on the
held-out test period. Following the honesty rules, **no live indicator or strategy is delivered.**

## Data (real, nothing simulated)
| | Source (Hugging Face) | Used |
|---|---|---|
| ES | `Khanhpham1992/es-futures-1m` – continuous front-month 1-min, raw prices | 458 full RTH days |
| NQ | `mdelcristo/NQ-F_1min_OHLCV_Parquet` – 1-min, 2015-2025 | 915 full RTH days |

* Common window: **2020-11-17 → 2024-07-19**. Signals use 5-minute bars built from the 1-minute data; fills, stops
  and targets are simulated on the 1-minute bars.
* **Data caveat:** the ES file is missing about half of all trading days (e.g. most of May–Sep 2023). No complete
  free multi-year ES source was reachable from this environment (Yahoo keeps only 60 days of 5-minute bars). ES
  results therefore rest on fewer days than NQ.
* Split on the NQ trading calendar (915 days):
  * **Train** 2020-11-17 → 2022-09-15 (NQ 457 days / ES 155)
  * **Validation** 2022-09-16 → 2023-08-17 (229 / 116)
  * **Test** 2023-08-18 → 2024-07-19 (229 / 187)
* The test files were written to a separate vault with SHA-256 hashes (`results/meta.json`). They were read exactly
  once, in `step6_test.py`, which re-verifies the hashes first.

## Cost and rule model (applied to every trade)
* MES ($5/pt) and MNQ ($2/pt), tick 0.25.
* **Commission:** $1.24 round trip per micro.
* **Slippage:** 1 tick adverse on every market fill (entry, stop, time exit, end-of-day exit, news exit).
* **Limit orders:** fill only when price trades through the level by 1 tick. When stop and target are touched in the
  same 1-minute bar, the stop is assumed to fill first.
* **Sizing:** micros = floor($150 / ((stop distance + 2 ticks) × $/pt + commission)), capped at 20. The trade is
  skipped if even 1 micro would risk more than $150.
* **Daily limits:** stop for the day after 2 losing trades or −$400. Max 60 minutes in a trade. Flat by 15:55 ET.
* **News:** no positions through FOMC (14:00, official Fed dates; no entries 13:30–15:00) or ISM Manufacturing /
  Services (10:00 on the 1st / 3rd trading day of the month).
* **No lookahead:** a 5-minute bar's signal is only acted on in the next 1-minute bar after that 5-minute bar closes.

## Step 2 – families on TRAIN (defaults set before testing)
| Family | ES trades | ES PF | ES net | NQ trades | NQ PF | NQ net | Gate |
|---|---|---|---|---|---|---|---|
| Opening range breakout | 140 | 1.07 | +$530 | 333 | 1.01 | +$94 | fail |
| VWAP mean reversion | 213 | 0.59 | −$8,619 | 601 | 0.65 | −$19,286 | fail |
| Trend pullback (EMA20/50) | 296 | 0.63 | −$8,205 | 870 | 0.83 | −$10,638 | fail |
| ICT FVG retest (50% CE) | 201 | 0.84 | −$2,177 | 591 | 0.81 | −$8,055 | fail |
| ICT Silver Bullet | 39 | 0.68 | −$876 | 102 | 0.81 | −$1,101 | fail |
| Liquidity sweep reversal | 14 | 0.32 | −$832 | 101 | 0.92 | −$644 | fail |
| Opening gap fill | 19 | 1.48 | +$705 | 72 | 1.47 | +$2,187 | fail (ES trades < 40) |
| Intraday momentum* | 152 | 0.70 | −$2,332 | 405 | 1.02 | +$323 | fail |

\*Intraday momentum (Gao et al. 2018) was added after the first 7 had been evaluated.

## Step 4 – limited tuning (one parameter at a time, menus fixed before running)
* **Gap fill:** best train change `min_rr=1.5` (worst-instrument PF 1.47 → 1.57). Validation did not improve (worst PF
  0.51 → 0.51). Rejected; stopped.
* **ORB:** best train change was moving the stop to the opposite side of the range (PF 1.01 → 1.29). Validation got
  worse (0.89 → 0.81). Rejected; stopped.

## Step 5 – robustness (informational; candidates frozen at defaults, TRAIN)
| | 2× costs, net / PF | Random-entry p-value (500 runs) |
|---|---|---|
| ORB ES | −$652 / 0.92 | 0.08 |
| ORB NQ | −$588 / 0.97 | 0.35 (no better than luck) |
| Gap fill ES | +$289 / 1.21 | 0.02 |
| Gap fill NQ | +$1,686 / 1.36 | 0.00 |

The gap-fill edge was real on train but did not survive into validation, which points to an edge tied to the
2021–22 market regime.

## Step 6 – TEST period, opened once (neither candidate was qualified)
| Strategy | Period | Trades | Win % | PF | Net $ | Max DD $ | $/week |
|---|---|---|---|---|---|---|---|
| Gap fill ES | train | 19 | 42.1 | 1.48 | 705 | 532 | 22.7 |
| | validation | 31 | 29.0 | 0.51 | −1,479 | 1,932 | −63.7 |
| | **test** | 51 | 39.2 | 0.98 | −73 | 1,470 | −1.9 |
| Gap fill NQ | train | 72 | 47.2 | 1.47 | 2,187 | 750 | 23.9 |
| | validation | 37 | 29.7 | 0.97 | −79 | 1,193 | −1.7 |
| | **test** | 56 | 33.9 | 1.14 | 588 | 1,847 | 12.8 |
| ORB ES | train | 140 | 45.7 | 1.07 | 530 | 1,096 | 17.1 |
| | validation | 105 | 44.8 | 0.89 | −709 | 2,134 | −30.6 |
| | **test** | 171 | 42.7 | 0.76 | −2,773 | 3,242 | −74.1 |
| ORB NQ | train | 333 | 45.3 | 1.01 | 94 | 2,685 | 1.0 |
| | validation | 185 | 45.9 | 1.06 | 555 | 1,198 | 12.1 |
| | **test** | 197 | 43.1 | 0.93 | −773 | 1,776 | −16.9 |

## Step 7 – 20,000 Lucid 25K evals (bootstrapped test-period days; for context only)
Model: $1,000 drawdown trailing the highest end-of-day balance, locking at $25,100; intraday breach checked with each
trade's worst open loss; $1,250 target; 50% consistency rule; max 250 days.

| Strategy | Pass % | Blow-up % | Median days to pass |
|---|---|---|---|
| Gap fill ES | 26.7 | 70.5 | 94 |
| Gap fill NQ | 32.2 | 60.6 | 104 |
| ORB ES | 6.1 | 93.9 | 44 |
| ORB NQ | 21.2 | 78.8 | 58 |

These pass rates are what roughly zero-edge trading produces against a $1,250 target with a $1,000 trailing
drawdown. They do not show an edge.

## Reproduce
```
python -I prep.py <raw_parquet_dir> <data_dir>      # then move *_test.pkl into <vault>
python step2_train.py <data_dir> results/step2_train.json
python step4_tune.py  <data_dir> results/step4_tune.json
python step5_checks.py <data_dir> results/step5_checks.json
python step6_test.py  <data_dir> <vault> results/step6_test.json
```

## Paper-trading plan (added at the user's request; setups remain UNVALIDATED)
Files: `pine/orb_gap_paper_indicator.pine` (live signals) and `pine/orb_gap_paper_strategy.pine` (Strategy Tester).
* **Chart:** 5-minute MES1! / MNQ1! (the strategy must run on micro charts so 1 qty = 1 micro). The indicator also
  works on ES1! / NQ1! and sizes in micros.
* **Size:** $150 risk per trade. Do not scale up for paper. Results only mean something at the size you would trade.
* **Commission:** TradingView paper trading charges none, so subtract $1.24 per micro per round trip in your log.
* **Logging:** log every signal you take or skip. Use real fill prices, not the label prices.
* **Decision rules, fixed before starting:**
  * **Stop immediately:** if paper equity falls $1,000 below its highest end-of-day balance. That would have failed
    the Lucid eval.
  * **Judge after ≥40 trades per instrument** (about 2 months for ORB; gap fill alone averages ~1 signal per week):
    * **Continue:** PF > 1.3 after costs and $/week > 0.
    * **Stop:** anything else.
* **Expectation from the test period:** about −$75 to +$13 per week. $1,000/week is not a realistic outcome for these
  setups at Lucid 25K risk limits.
* **Differences from the Python study:** the Pine versions work on 5-minute bars (time/news exits happen on 5-minute
  bar closes, not 1-minute bars). TradingView's broker emulator also resolves stop vs. target inside one bar
  differently. Expect small differences.
