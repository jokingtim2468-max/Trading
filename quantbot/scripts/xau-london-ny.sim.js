// London range breakout into New York, XAUUSD M5 (QuantBot simulator code; the Pine script "QB Gold London-NY Breakout"
// trades the same rules). London range = 02:00-05:00 New York. From 08:30 to 11:00 NY, the first 5-minute close outside
// the range enters; stop at the middle of the range (only when that is at least $4 away), target 1.5R, out after 2 hours.
export const LONDON_NY_SIM = `
const s = ctx.state, i = ctx.i, m = ctx.nyHour * 60 + ctx.nyMinute;
const RANGE_START = 120, RANGE_END = 300, ENTRY_START = 510, ENTRY_END = 660;
const TP_R = 1.5, MIN_STOP = 4, MAX_BARS = 24, RISK = 0.01;
const day = Math.floor((ctx.time[i] - 7 * 3600000) / 86400000);
// London range for today's New York date
if (m >= RANGE_START && m < RANGE_END) {
  if (s.rday !== day) { s.rday = day; s.hi = -Infinity; s.lo = Infinity; s.done = false; }
  s.hi = Math.max(s.hi, ctx.high[i]);
  s.lo = Math.min(s.lo, ctx.low[i]);
  ctx.count('london range bar');
  return null;
}
const p = ctx.position;
// 2-hour time stop, and never past 16:00 NY
if (p) return p.barsOpen >= MAX_BARS || m >= 960 ? { action: 'close' } : null;
const weekday = ctx.nyDayOfWeek >= 1 && ctx.nyDayOfWeek <= 5;
if (!weekday || s.rday !== day || s.done || m < ENTRY_START || m >= ENTRY_END) return null;
ctx.count('entry window bar');
const c = ctx.close[i];
const up = c > s.hi, dn = c < s.lo;
if (!up && !dn) return null;
ctx.count(up ? 'close above range' : 'close below range');
s.done = true; // one breakout per day, taken or skipped
const stop = (s.hi + s.lo) / 2;
const risk = Math.abs(c - stop);
if (risk < MIN_STOP) { ctx.count('skipped: stop under $4'); return null; }
const lots = Math.max(0.01, Math.floor(ctx.balance * RISK / (risk * ctx.contractSize) * 100) / 100);
ctx.count(up ? 'long entry' : 'short entry');
return up ? { action: 'buy', lots, sl: stop, tp: c + TP_R * risk } : { action: 'sell', lots, sl: stop, tp: c - TP_R * risk };`;
