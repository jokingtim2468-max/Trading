// Contract for the JavaScript that QuantBot's bar-by-bar simulator runs (used by the converter and the tester)
export const SIM_CONTRACT = `sim_code is the BODY (no function wrapper, no imports) of a JavaScript function onBar(ctx) that reproduces the exact same trading logic for QuantBot's bar-by-bar simulator. It is called once per closed bar; orders fill at the NEXT bar's open; SL/TP are checked intrabar.
ctx fields:
- ctx.i: current bar index. Arrays (index with ctx.i, never read beyond ctx.i): ctx.time (ms, broker server time), ctx.open, ctx.high, ctx.low, ctx.close, ctx.volume (tick volume), ctx.spread (points).
- ctx.hour, ctx.minute, ctx.dayOfWeek (0=Sunday) of the current bar.
- ctx.position: null or {side:'long'|'short', entry, sl, tp, lots, barsOpen}.
- ctx.balance, ctx.equity, ctx.point, ctx.contractSize (P&L per 1 lot = price move * contractSize).
- ctx.state: plain object that persists between bars (store custom values, previous signals, daily P&L, etc.).
- ctx.ta (value at the current bar, optional offset = bars back): ema(src,len,offset), sma(src,len,offset), rsi(src,len,offset), atr(len,offset), highest(src,len,offset), lowest(src,len,offset), stdev(src,len,offset). src must be ctx.close/ctx.open/ctx.high/ctx.low/ctx.volume. Values are NaN during warm-up.
Return null (no action), {action:'buy'|'sell', lots, sl, tp} to open (sl/tp as absolute prices; lots sized from ctx.balance and the stop distance), {action:'close'}, or {action:'modify', sl, tp} to move stops (breakeven, trailing).
Signals: every buy/sell must set BOTH sl and tp. Strategy-logic exits must return {action:'close'} so the tester records them as CLOSE, separate from TP and SL hits. The tester checks that BUY, SELL, CLOSE, TP and SL each fire.
Must be plain ES2020, deterministic, no async, no external access.`;

export const clip = (v, n) => String(v || '').slice(0, n);

// Market line for model prompts, plus quant stats measured from the trader's own candles
export function marketText(market) {
  if (!market) return '';
  let text = `MARKET: ${clip(market.symbol, 20)} ${clip(market.timeframe, 10)} bars, contract size ${Number(market.contract_size) || 100}, point ${Number(market.point) || 0.01}, starting balance ${Number(market.balance) || 10000}.`;
  if (market.stats && typeof market.stats === 'object') {
    text += `\nMARKET STATS measured from the trader's data (price units; hours are broker server time): ${clip(JSON.stringify(market.stats), 2000)}`;
  }
  return text;
}

// Pulls the JSON object out of a model reply
export function parseJsonReply(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The model reply was cut off before the report finished. Try again.');
  const body = text.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // Models often put raw line breaks / tabs inside code strings; escape them and retry
    let out = '', inStr = false, esc = false;
    for (const ch of body) {
      if (inStr && !esc && ch === '\n') out += '\\n';
      else if (inStr && !esc && ch === '\r') out += '\\r';
      else if (inStr && !esc && ch === '\t') out += '\\t';
      else out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = inStr;
      else if (ch === '"') inStr = !inStr;
    }
    try {
      return JSON.parse(out);
    } catch {
      throw new Error('The model reply was cut off or malformed. Try again.');
    }
  }
}