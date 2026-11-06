---
name: ml-walkforward
description: Load when building a machine-learning model for trading - meta-labeling, features, walk-forward training, leakage checks, exporting to Pine
---

# Machine learning for trading signals

## Use ML to RATE signals, not to predict price from nothing
Meta-labeling: a base strategy with some edge proposes trades; the model predicts P(this trade wins) and skips the weak ones / sizes the strong ones. Without a base edge the model has nothing to filter.

## Features (known at the signal bar only)
Volatility (ATR vs its 100-bar median), trend distances (EMA 20/50/200 in ATRs, higher-timeframe trend from closed bars), gap and overnight range, time of day, weekday, RSI, recent signal results, cross-market (DXY, yields, VIX, GVZ from FRED, lagged one day), COT positioning (Tuesday report usable from the following Monday).

## Training
- Label: triple barrier (target before stop = 1, stop first = 0, time exit by sign) after costs.
- Walk-forward: for each year Y, train on years < Y, predict Y. Purge trades that overlap the train/test boundary; 5-day embargo.
- Pick the probability threshold on the training years only.
- Logistic regression first (baseline), then small gradient boosting (max_depth 2-3). Calibrate probabilities.
- Small samples (< 300 trades) overfit: an ML filter that takes fewer trades and makes LESS total R than "take every signal" is not an improvement. Say so.

## Leakage checklist
No feature uses the signal bar's future, no scaling fitted on all data, no target information in features, test years never used for any choice.

## Export to Pine (TradingView cannot load models)
Logistic: z = intercept + sum(coef_i * feature_i) with coefficients un-standardised (coef/sd, intercept - sum(coef*mu/sd)); p = 1/(1+exp(-z)). Compute the same features in Pine exactly as in Python and compare probabilities on a few bars.
