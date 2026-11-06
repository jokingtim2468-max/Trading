---
name: backtest-rules
description: Load before writing or judging ANY backtest - honest fills, no look-ahead, costs, train/check/exam splits, how to report results
---

# Honest backtesting rules (non-negotiable)

## Fills
- Decide on a bar's CLOSE, fill at the NEXT bar's OPEN. Never fill at the signal bar's close or at a price only known later.
- If the stop and the target are both inside one bar, the STOP counts (worst case). Check the order on M1/M5 bars when possible.
- Market orders pay slippage on entry AND exit: gold >= $0.20/oz per side, NQ >= 0.5 pt per side, plus commission (about $1.50 per micro round trip, $5 per mini).
- A trade still open at the session end closes at that bar's close (minus slippage).

## No look-ahead
- Indicators use only closed bars. Higher timeframes (H1/H4/D1) only after their bar has closed: shift(1) the higher-timeframe series, then forward-fill onto the lower timeframe.
- Daily values (prior high/low/close, daily ATR) come from the PREVIOUS day.
- Never normalise, rank or scale with statistics of the whole dataset (that includes the future). Rolling windows only.
- Add an assertion: recompute a signal using data truncated at that bar and check it matches.

## Splits (choose, check, exam)
- Choose settings on the early years only (e.g. 2004-2018). Check them on later years (2019-2025). Grade the latest year (2026) ONCE at the very end.
- A strategy counts only if it is profitable after costs in BOTH halves of the choosing period and in the check period.
- Walk-forward alternative: each year Y is traded with settings chosen only on years before Y. Report every year.
- Never keep tuning on the exam year: once it has been used to decide, it is no longer unseen.

## Report honestly
- Report EVERY version tried and how many passed. 3 winners out of 400 tries is probably luck.
- Report: trades, win rate, average R and $ per trade AFTER costs, profit factor, max drawdown, worst day, losing years, and per-period results.
- Compare against a baseline (buy-and-hold for the period, or the project's best known strategy). Say clearly if the new idea does not beat it.
- Never quote a number you did not get from running the code. If a script fails, say so and fix it.

## Every script you write must run
- Write the script, RUN it, read the output, fix errors, run again. Only then answer.
- Print a short final table and write results to JSON so the trader can re-run it with one command.
