// The ICT sweep + fair value gap strategy from a trader's Pine script, written to QuantBot's simulator contract
// (server/lib/simContract.js) rule by rule. The live check runs it on real XAUUSD, US100 and NQ M15 data to show a
// faithful translation of these rules does trade, and how often each condition fires.
export const ICT_PINE = `// Script: Live ICT
//@version=5
strategy("Live ICT", overlay=true)
// NY killzone 08:30-11:00, liquidity sweep + FVG, entry at the FVG midpoint, 2R target, breakeven at 1.5R`;

export const ICT_SIM_CODE = `
const i = ctx.i, s = ctx.state, H = ctx.high, L = ctx.low, C = ctx.close;
const atr = ctx.ta.atr(14);
const mins = ctx.nyHour * 60 + ctx.nyMinute;
const day = Math.floor((ctx.time[i] - 7 * 3600000) / 86400000);
// New York day: reset the trade count and the day-start equity
if (s.day !== day) { s.day = day; s.trades = 0; s.dayStart = ctx.equity; s.halted = false; }
const pos = ctx.position;
// Rule 12 and 11: forced close at 16:45 New York, and the 3% daily loss breaker
if (pos && mins >= 16 * 60 + 45) return { action: 'close' };
if (!s.halted && ctx.equity <= s.dayStart * 0.97) { s.halted = true; s.setup = null; if (pos) return { action: 'close' }; }
// Rule 10: breakeven once price reaches 1.5x the initial risk
if (pos) {
  const risk = s.risk || 0;
  if (risk > 0 && pos.sl !== pos.entry) {
    if (pos.side === 'long' && H[i] >= pos.entry + 1.5 * risk) return { action: 'modify', sl: pos.entry };
    if (pos.side === 'short' && L[i] <= pos.entry - 1.5 * risk) return { action: 'modify', sl: pos.entry };
  }
  return null;
}
if (i < 8 || !(atr > 0)) return null;
// Rule 2: Monday to Friday, bars from 08:30 to before 11:00 New York; 08:30 and 10:00 bars blocked by the news filter
const weekday = ctx.nyDayOfWeek >= 1 && ctx.nyDayOfWeek <= 5;
const inSession = weekday && mins >= 8 * 60 + 30 && mins < 11 * 60;
const tradable = inSession && mins !== 8 * 60 + 30 && mins !== 10 * 60;
if (inSession) ctx.count('in session');
// Rule 6: setups end outside the session or when price closes through the far side of the gap
if (s.setup && (!inSession || (s.setup.side === 'long' ? C[i] < s.setup.bottom : C[i] > s.setup.top))) s.setup = null;
if (!inSession || s.halted || s.trades >= 3) return null;
// Rule 7 and 8: entry when price trades back to the gap's midpoint (CE), stop at the setup stop, target 2R from CE
if (s.setup) {
  const st = s.setup;
  const touched = st.side === 'long' ? L[i] <= st.ce : H[i] >= st.ce;
  if (touched) {
    ctx.count(st.side === 'long' ? 'long entry' : 'short entry');
    const risk = Math.max(Math.abs(st.ce - st.stop), 0.5 * atr);
    const lots = Math.max(0.01, Math.floor(((ctx.balance * 0.01) / (risk * ctx.contractSize)) * 100) / 100);
    s.setup = null; s.trades++; s.risk = risk;
    return st.side === 'long'
      ? { action: 'buy', lots, sl: st.stop, tp: st.ce + 2 * risk }
      : { action: 'sell', lots, sl: st.stop, tp: st.ce - 2 * risk };
  }
}
if (!tradable) return null;
// Rule 3: sweep of the 5 lows (highs) before the previous bar, closing back inside
const low5 = ctx.ta.lowest(L, 5, 2), high5 = ctx.ta.highest(H, 5, 2);
const bullSweep = L[i - 1] < low5 && C[i - 1] > low5;
const bearSweep = H[i - 1] > high5 && C[i - 1] < high5;
// Rule 4: fair value gap between bar [2] and the current bar, with bar [1] closing beyond it
const bullFvg = L[i] > H[i - 2] && C[i - 1] > H[i - 2];
const bearFvg = H[i] < L[i - 2] && C[i - 1] < L[i - 2];
if (bullSweep) ctx.count('bull sweep');
if (bullFvg) ctx.count('bull FVG');
if (bearSweep) ctx.count('bear sweep');
if (bearFvg) ctx.count('bear FVG');
// Rule 4 and 5: a sweep and a gap on the same bar make a setup
if (bullSweep && bullFvg) {
  ctx.count('bull setup');
  s.setup = { side: 'long', top: L[i], bottom: H[i - 2], ce: (L[i] + H[i - 2]) / 2, stop: Math.min(L[i - 1], L[i - 2]) - 1.5 * atr };
} else if (bearSweep && bearFvg) {
  ctx.count('bear setup');
  s.setup = { side: 'short', top: L[i - 2], bottom: H[i], ce: (H[i] + L[i - 2]) / 2, stop: Math.max(H[i - 1], H[i - 2]) + 1.5 * atr };
}
return null;`;
