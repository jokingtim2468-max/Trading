# Day Range Predictor training report

Trained 2026-10-09 by `tools/train_drp.py`. Data: Yahoo Finance (daily 10y, hourly 730d), cross-checked against Google Finance quotes. Every number under "holdout" comes from recent data the settings were not tuned on.

## Nasdaq e-mini / US100 (NQ=F)

Data through 2026-10-09. Google Finance cross-check: Google settlement 30,969.50 vs Yahoo recent closes 31,402.25, 30,969.50, 31,011.75, 31,011.75 → OK.

### Predicted high/low lines

Chosen: lookback **180 days**, ATR **20**, max line **P96.0** (the narrowest setting that held ≥95% per side on the 3 years before the holdout).

| | High held | Low held | Both held | Width (× ATR) |
| --- | --- | --- | --- | --- |
| Trained, holdout last 250 days | 94.8% | 96.8% | 91.6% | 2.76 |
| Old default (250d, ATR 14, P95), same days | 93.2% | 96.0% | 89.2% | 2.62 |

### Live high / low / build-up lines (update every bar)

Green high = high so far + expected extra move, red low = low so far − expected extra move, both looked up by hour of the day and where price sits in the range. Yellow build-up = blend of the predicted midpoint and the price where the most trading has happened so far. Holdout: 120 unseen days from 2026-04-21. Average distance between the line and the day's real high / low / build-up:

| When | High miss | Low miss | Build-up miss |
| --- | --- | --- | --- |
| Old fixed lines at the open | 0.35 ATR (≈172) | 0.35 ATR (≈171) | n/a |
| Live, at the day open | 0.30 ATR (≈145) | 0.32 ATR (≈156) | 0.20 ATR (≈99) |
| Live, at session start | 0.08 ATR (≈38) | 0.10 ATR (≈47) | 0.05 ATR (≈23) |
| Live, average over the day | 0.16 ATR (≈78) | 0.18 ATR (≈86) | 0.10 ATR (≈46) |

Share of bars where both live lines were within 0.1 ATR of the real high and low: 31.7%.

### Quick-trade AI TP/SL (5-minute bars, 1-hour max hold, after costs)

Price-only direction model (news is added live by the AI service and can't be backtested). 13,393 bars, holdout from 2026-09-21. Direction accuracy: training 53.1%, holdout 52.8%. Chosen: TP 3.0× / SL 2.0× the 5-minute ATR, setup when confidence ≥ 50%.

| | Trades | Win rate | Avg result (× 5m ATR) |
| --- | --- | --- | --- |
| Training | 961 | 48.0% | +0.029 |
| Holdout (unseen) | 414 | 46.4% | -0.005 |

**Verdict:** no proven edge after costs. The TP/SL lines show sensible placement and the odds, not a reason to trade.

### Signals (hourly bars, after estimated spread/commission)

Tested 288 filter combinations; 152 had at least 15 trades in training (2024-05-17 to 2026-01-23). Holdout: 2026-01-23 to 2026-10-09.

Best in training: zone P85, 4/5 filters, wick ≥50%, RSI 75/25, target 1.5R.

| | Trades | Win rate | Net R |
| --- | --- | --- | --- |
| Best combination, training | 22 | 54.5% | +7.5 |
| Best combination, holdout (unseen) | 4 | 50.0% | +0.9 |
| Strict default (P85, 5/5, 1R), holdout | 1 | 0.0% | -1.0 |

**Verdict:** the best training combination did not hold up on unseen data (overfitting), so the presets keep the strict defaults. Treat the signals as a warning, not as trade entries.

## Gold / XAUUSD (GC=F)

Data through 2026-10-09. Google Finance cross-check: Google settlement 4,157.00 vs Yahoo recent closes 4,140.70, 4,157.00, 4,211.70, 4,211.70 → OK.

### Predicted high/low lines

Chosen: lookback **375 days**, ATR **20**, max line **P95.5** (the narrowest setting that held ≥95% per side on the 3 years before the holdout).

| | High held | Low held | Both held | Width (× ATR) |
| --- | --- | --- | --- | --- |
| Trained, holdout last 250 days | 94.8% | 94.8% | 90.0% | 2.88 |
| Old default (250d, ATR 14, P95), same days | 95.2% | 94.0% | 89.2% | 2.79 |

### Live high / low / build-up lines (update every bar)

Green high = high so far + expected extra move, red low = low so far − expected extra move, both looked up by hour of the day and where price sits in the range. Yellow build-up = blend of the predicted midpoint and the price where the most trading has happened so far. Holdout: 120 unseen days from 2026-04-21. Average distance between the line and the day's real high / low / build-up:

| When | High miss | Low miss | Build-up miss |
| --- | --- | --- | --- |
| Old fixed lines at the open | 0.30 ATR (≈$26.5) | 0.31 ATR (≈$27.3) | n/a |
| Live, at the day open | 0.28 ATR (≈$24.6) | 0.31 ATR (≈$27.2) | 0.28 ATR (≈$24.8) |
| Live, at session start | 0.14 ATR (≈$11.9) | 0.16 ATR (≈$14.4) | 0.15 ATR (≈$13.4) |
| Live, average over the day | 0.13 ATR (≈$11.0) | 0.14 ATR (≈$11.9) | 0.14 ATR (≈$12.2) |

Share of bars where both live lines were within 0.1 ATR of the real high and low: 43.7%.

### Quick-trade AI TP/SL (5-minute bars, 1-hour max hold, after costs)

Price-only direction model (news is added live by the AI service and can't be backtested). 13,434 bars, holdout from 2026-09-21. Direction accuracy: training 52.2%, holdout 50.4%. Chosen: TP 3.0× / SL 1.0× the 5-minute ATR, setup when confidence ≥ 55%.

| | Trades | Win rate | Avg result (× 5m ATR) |
| --- | --- | --- | --- |
| Training | 323 | 39.0% | +0.148 |
| Holdout (unseen) | 157 | 28.7% | -0.239 |

**Verdict:** no proven edge after costs. The TP/SL lines show sensible placement and the odds, not a reason to trade.

### Signals (hourly bars, after estimated spread/commission)

Tested 288 filter combinations; 168 had at least 15 trades in training (2024-05-17 to 2026-01-22). Holdout: 2026-01-22 to 2026-10-09.

Best in training: zone P90, 4/5 filters, wick ≥50%, RSI 75/25, target 1.5R.

| | Trades | Win rate | Net R |
| --- | --- | --- | --- |
| Best combination, training | 23 | 52.2% | +6.3 |
| Best combination, holdout (unseen) | 7 | 0.0% | -7.1 |
| Strict default (P85, 5/5, 1R), holdout | 2 | 50.0% | -0.0 |

**Verdict:** the best training combination did not hold up on unseen data (overfitting), so the presets keep the strict defaults. Treat the signals as a warning, not as trade entries.

No indicator is right 100% of the time. Past results are not a promise. Not financial advice.
