// A basic Pine strategy (EMA 9/21 cross, 1.5 ATR stop, 2R target, 1% risk, exit on the opposite cross) and its
// translation into simulator code, written the way the Strategy Tester's model translates a script. Used by the
// live tester check (tests/e2e/tester-pine-live.js) on real market data.
export const BASIC_PINE = `// Script: Basic EMA Cross
//@version=5
strategy("Basic EMA Cross", overlay=true, initial_capital=10000)
fastLen = input.int(9, "Fast EMA")
slowLen = input.int(21, "Slow EMA")
atrLen  = input.int(14, "ATR length")
slMult  = input.float(1.5, "Stop (x ATR)")
rr      = input.float(2.0, "Reward:risk")
riskPct = input.float(1.0, "Risk % per trade")
qbName  = input.string("Basic EMA Cross", "QuantBot strategy name")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
atr  = ta.atr(atrLen)
longSig  = ta.crossover(fast, slow)
shortSig = ta.crossunder(fast, slow)

qbSend(string ev, float px, float sl, float tp, float qty, string reason) =>
    msg = "{\\"qb\\":1,\\"event\\":\\"" + ev + "\\",\\"symbol\\":\\"" + syminfo.ticker + "\\",\\"tf\\":\\"" + timeframe.period + "\\",\\"price\\":" + str.tostring(math.round_to_mintick(px))
    msg += na(sl) ? "" : ",\\"sl\\":" + str.tostring(math.round_to_mintick(sl))
    msg += na(tp) ? "" : ",\\"tp\\":" + str.tostring(math.round_to_mintick(tp))
    msg += na(qty) ? "" : ",\\"qty\\":" + str.tostring(qty)
    msg += ",\\"reason\\":\\"" + reason + "\\",\\"strategy\\":\\"" + qbName + "\\",\\"source\\":\\"tradingview\\",\\"time\\":" + str.tostring(time) + "}"
    alert(msg, alert.freq_once_per_bar_close)

stopDist = slMult * atr
qty = math.max(1, math.floor(strategy.equity * riskPct / 100 / (stopDist * syminfo.pointvalue)))

// Exit on the opposite cross (strategy logic, logged as CLOSE)
if strategy.position_size > 0 and shortSig
    strategy.close("BUY", comment="CLOSE")
    qbSend("close", close, na, na, na, "signal")
if strategy.position_size < 0 and longSig
    strategy.close("SELL", comment="CLOSE")
    qbSend("close", close, na, na, na, "signal")

// Entries only when flat, every one with a stop and a target
if strategy.position_size == 0 and longSig
    strategy.entry("BUY", strategy.long, qty=qty)
    strategy.exit("BUY X", "BUY", stop=close - stopDist, limit=close + rr * stopDist, comment_loss="SL", comment_profit="TP")
    qbSend("buy", close, close - stopDist, close + rr * stopDist, qty, "")
if strategy.position_size == 0 and shortSig
    strategy.entry("SELL", strategy.short, qty=qty)
    strategy.exit("SELL X", "SELL", stop=close + stopDist, limit=close - rr * stopDist, comment_loss="SL", comment_profit="TP")
    qbSend("sell", close, close + stopDist, close - rr * stopDist, qty, "")

plot(fast, "Fast EMA", color.new(#5fb7f2, 0))
plot(slow, "Slow EMA", color.new(#f59e0b, 0))
plotshape(longSig and strategy.position_size == 0, "BUY", shape.triangleup, location.belowbar, color.green, text="BUY")
plotshape(shortSig and strategy.position_size == 0, "SELL", shape.triangledown, location.abovebar, color.red, text="SELL")`;

// The translation (what the tester's model returns as sim_code)
export const BASIC_SIM_CODE = `
const i = ctx.i, c = ctx.close[i];
const fast = ctx.ta.ema(ctx.close, 9), slow = ctx.ta.ema(ctx.close, 21);
const fastPrev = ctx.ta.ema(ctx.close, 9, 1), slowPrev = ctx.ta.ema(ctx.close, 21, 1);
const atr = ctx.ta.atr(14);
if (![fast, slow, fastPrev, slowPrev, atr].every(Number.isFinite)) return null;
// ta.crossover / ta.crossunder
const longSig = fastPrev <= slowPrev && fast > slow;
const shortSig = fastPrev >= slowPrev && fast < slow;
if (longSig) ctx.count('cross up');
if (shortSig) ctx.count('cross down');
const p = ctx.position;
// Opposite cross closes the trade (strategy logic)
if (p) {
  if ((p.side === 'long' && shortSig) || (p.side === 'short' && longSig)) return { action: 'close' };
  return null;
}
const stop = 1.5 * atr;
// 1% of balance over the stop distance, rounded down to 0.01 lots, at least 0.01
const lots = Math.max(0.01, Math.floor(((ctx.balance * 0.01) / (stop * ctx.contractSize)) * 100) / 100);
if (longSig) { ctx.count('long entry'); return { action: 'buy', lots, sl: c - stop, tp: c + 2 * stop }; }
if (shortSig) { ctx.count('short entry'); return { action: 'sell', lots, sl: c + stop, tp: c - 2 * stop }; }
return null;`;
