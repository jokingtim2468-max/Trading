# Day Range Predictor training report

Trained 2026-10-09 by `tools/train_drp.py`. Data: Yahoo Finance (daily 10y, hourly 730d), cross-checked against Google Finance quotes. Every number under "holdout" comes from recent data the settings were not tuned on.

## Nasdaq e-mini / US100 (NQ=F)

Data through 2026-10-09. Google Finance cross-check: Google settlement 30,969.50 vs Yahoo recent closes 31,402.25, 30,969.50, 31,195.50, 31,195.50 → OK.

### Predicted high/low lines

Chosen: lookback **180 days**, ATR **20**, max line **P96.0** (the narrowest setting that held ≥95% per side on the 3 years before the holdout).

| | High held | Low held | Both held | Width (× ATR) |
| --- | --- | --- | --- | --- |
| Trained, holdout last 250 days | 94.8% | 96.8% | 91.6% | 2.76 |
| Old default (250d, ATR 14, P95), same days | 93.2% | 96.0% | 89.2% | 2.62 |

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

Data through 2026-10-09. Google Finance cross-check: Google settlement 4,157.00 vs Yahoo recent closes 4,140.70, 4,157.00, 4,202.90, 4,202.90 → OK.

### Predicted high/low lines

Chosen: lookback **375 days**, ATR **20**, max line **P95.5** (the narrowest setting that held ≥95% per side on the 3 years before the holdout).

| | High held | Low held | Both held | Width (× ATR) |
| --- | --- | --- | --- | --- |
| Trained, holdout last 250 days | 94.8% | 94.8% | 90.0% | 2.88 |
| Old default (250d, ATR 14, P95), same days | 95.2% | 94.0% | 89.2% | 2.79 |

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
