---
name: pine-v6
description: Load when writing or fixing TradingView Pine Script - v6 structure, non-repainting request.security, signals with SL/TP lines, alerts, common errors
---

# Pine Script v6

## Skeleton (signals indicator, no auto trading)
```pine
//@version=6
indicator("Name", overlay=true, max_labels_count=500, max_lines_count=500)
float riskUsd = input.float(100, "Risk per trade ($)")
float atr = ta.atr(14)
string tz = "America/New_York"
int m = hour(time, tz) * 60 + minute(time, tz)
bool longSig = barstate.isconfirmed and ta.crossover(ta.ema(close, 13), ta.ema(close, 55))
if longSig
    float sl = close - 1.5 * atr
    int q = math.max(1, int(math.floor(riskUsd / ((close - sl) * syminfo.pointvalue))))
    label.new(bar_index, low, "BUY " + str.tostring(q), style=label.style_label_up, color=color.green, textcolor=color.white)
    line.new(bar_index, sl, bar_index + 20, sl, color=color.red)
    alert("BUY " + syminfo.ticker + " SL " + str.tostring(sl, format.mintick), alert.freq_once_per_bar_close)
```

## Rules
- Higher timeframe without repainting: `request.security(syminfo.tickerid, "D", close[1], lookahead=barmerge.lookahead_on)` (the [1] plus lookahead_on = last CLOSED daily bar).
- One declaration per line (`float a = 1` then `float b = 2`); `var` for values that persist across bars. Comma-separated assignments `a := 1, b := 2` are fine.
- `na` checks with `na(x)`; booleans cannot be na in v6.
- Strategies: `strategy("...", initial_capital=..., commission_type=strategy.commission.cash_per_contract, commission_value=0.75, slippage=1)`; use strategy.entry / strategy.exit with stop and limit.
- Signals must be clear: label with BUY/SELL, entry, SL and TP lines, contracts for the trader's $ risk, and alert() calls. Flat by 15:55-16:40 ET for prop accounts.
- Pine cannot call servers or load models: an ML model must be exported as numbers (logistic coefficients or small if/else trees) into the script.
- You cannot compile Pine here: say so and ask the trader to paste any TradingView error.
