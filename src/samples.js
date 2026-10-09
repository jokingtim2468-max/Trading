// Starter Pine scripts shipped with the app.
export const SAMPLE_SCRIPTS = [
  { id: 'sample-ema-cross', name: 'EMA Cross', code: `//@version=5
indicator("EMA Cross", overlay=true)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "Fast EMA", color=color.aqua)
plot(slow, "Slow EMA", color=color.orange)
plotshape(ta.crossover(fast, slow), location=location.belowbar, color=color.green)
plotshape(ta.crossunder(fast, slow), location=location.abovebar, color=color.red)
` },
  { id: 'sample-rsi', name: 'RSI', code: `//@version=5
indicator("RSI", overlay=false)
len = input.int(14, "Length")
plot(ta.rsi(close, len), "RSI", color=color.purple)
hline(70, "Overbought")
hline(30, "Oversold")
` },
];
