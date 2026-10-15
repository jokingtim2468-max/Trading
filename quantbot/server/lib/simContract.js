// Contract for the JavaScript that QuantBot's bar-by-bar simulator runs (used by the converter and the tester)
export const SIM_CONTRACT = `sim_code is the BODY (no function wrapper, no imports) of a JavaScript function onBar(ctx) that reproduces the exact same trading logic for QuantBot's bar-by-bar simulator. It is called once per closed bar; orders fill at the NEXT bar's open; SL/TP are checked intrabar.
ctx fields:
- ctx.i: current bar index. Arrays (index with ctx.i, never read beyond ctx.i): ctx.time (ms, broker server time), ctx.open, ctx.high, ctx.low, ctx.close, ctx.volume (tick volume), ctx.spread (points).
- ctx.hour, ctx.minute, ctx.dayOfWeek (0=Sunday) of the current bar in broker server time (UTC+2, UTC+3 in US summer: always New York time + 7 hours).
- ctx.nyHour, ctx.nyMinute, ctx.nyDayOfWeek: the same bar in New York time (DST handled). Use these for New York sessions, ICT killzones and "America/New_York" times in Pine.
- ctx.position: null or {side:'long'|'short', entry, sl, tp, lots, barsOpen}.
- ctx.balance, ctx.equity, ctx.point, ctx.contractSize (P&L per 1 lot = price move * contractSize).
- ctx.state: plain object that persists between bars (store custom values, previous signals, daily P&L, etc.).
- ctx.ta (value at the current bar, optional offset = bars back): ema(src,len,offset), sma(src,len,offset), rsi(src,len,offset), atr(len,offset), highest(src,len,offset), lowest(src,len,offset), stdev(src,len,offset), pivothigh(src,left,right,offset), pivotlow(src,left,right,offset) (Pine's ta.pivothigh/pivotlow: the pivot price on the bar it is confirmed, else NaN). src must be ctx.close/ctx.open/ctx.high/ctx.low/ctx.volume. Values are NaN during warm-up. A window with offset k covers bars ctx.i-k-len+1 .. ctx.i-k, so Pine's ta.lowest(low, 5)[1] is ctx.ta.lowest(ctx.low, 5, 1) and "below the lowest low of the 5 bars before the previous bar" is ctx.low[ctx.i-1] < ctx.ta.lowest(ctx.low, 5, 2) (offset 1 would include that bar itself, so it could never be below).
- ctx.count(label): tally a bar that passed an entry condition. Call it once per bar at every stage of each entry, in order, with short labels, e.g. ctx.count('in session'); ctx.count('bull sweep'); ctx.count('bull FVG'); ctx.count('bull setup'); ctx.count('long entry'). The tester shows these counts, so a run with no trades shows which condition never fires.
Return null (no action), {action:'buy'|'sell', lots, sl, tp} to open (sl/tp as absolute prices; lots sized from ctx.balance and the stop distance), {action:'close'}, or {action:'modify', sl, tp} to move stops (breakeven, trailing).
Signals: every buy/sell must set BOTH sl and tp. Strategy-logic exits must return {action:'close'} so the tester records them as CLOSE, separate from TP and SL hits. The tester checks that BUY, SELL, CLOSE, TP and SL each fire.
SPEED: a test runs over up to 500,000 bars and must finish in seconds, so onBar must do a small, fixed amount of work per bar.
- Never loop from 0 (or from a stored start) to ctx.i, and never loop over a list that keeps growing. Any loop looks back at most 300 bars.
- Track swings, fair value gaps, order blocks, liquidity levels, ranges and higher-timeframe candles incrementally in ctx.state: update them from the newest bar only, drop mitigated/expired items, and keep each list to the newest 50.
- Prefer ctx.ta (computed once, instant to read) over hand-written loops.
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