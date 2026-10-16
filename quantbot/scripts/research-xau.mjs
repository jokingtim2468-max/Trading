// Strategy research on an MT5 XAUUSD M5 export. node scripts/research-xau.mjs <csv> <from> <to>
import { loadEngine, loadMt5, slice, rStats } from './research-lib.mjs';

const [csv, from = '2010-01-01', to = '2020-01-01', only = ''] = process.argv.slice(2);
const E = await loadEngine();
const all = loadMt5(csv, { minSpread: 15 });

// Opening-range breakout: range of [rs, re) NY minutes, trade the first close beyond it until ee, one trade a day
const orb = ({ rs, re, ee, stop = 'range', k = 1, tp = 2, maxBars = 24, flat = 960, trend = 0, side = 'both', minR = 0, minRisk = 0 }) => `
const s = ctx.state, i = ctx.i, m = ctx.nyHour * 60 + ctx.nyMinute;
const day = Math.floor((ctx.time[i] - 7 * 3600000) / 86400000);
if (s.day !== day) { s.day = day; s.hi = -Infinity; s.lo = Infinity; s.done = false; }
const wd = ctx.nyDayOfWeek >= 1 && ctx.nyDayOfWeek <= 5;
if (m >= ${rs} && m < ${re}) { s.hi = Math.max(s.hi, ctx.high[i]); s.lo = Math.min(s.lo, ctx.low[i]); return null; }
const p = ctx.position;
if (p) { if (p.barsOpen >= ${maxBars} || m >= ${flat}) return { action: 'close' }; return null; }
if (!wd || s.done || m < ${re} || m >= ${ee} || !isFinite(s.hi)) return null;
const c = ctx.close[i], atr = ctx.ta.atr(14);
if (!(atr > 0)) return null;
const t = ${trend} ? ctx.ta.ema(ctx.close, ${trend || 1}) : NaN;
const up = c > s.hi && ('${side}' !== 'short') && (!${trend} || c > t);
const dn = c < s.lo && ('${side}' !== 'long') && (!${trend} || c < t);
if (!up && !dn) return null;
const stop = '${stop}' === 'range' ? (up ? s.lo : s.hi) : (up ? c - ${k} * atr : c + ${k} * atr);
const risk = Math.abs(c - stop);
if (risk <= ${minR} * atr || risk <= ${minRisk}) return null;
s.done = true;
const lots = Math.max(0.01, Math.floor(ctx.balance * 0.01 / (risk * ctx.contractSize) * 100) / 100);
return up ? { action: 'buy', lots, sl: stop, tp: c + ${tp} * risk } : { action: 'sell', lots, sl: stop, tp: c - ${tp} * risk };`;

// Sweep-and-reverse of a range: price takes out the range high/low during the window, then closes back inside
const fade = ({ rs, re, ws, we, tp = 2, maxBars = 24, buf = 0.2, flat = 960 }) => `
const s = ctx.state, i = ctx.i, m = ctx.nyHour * 60 + ctx.nyMinute;
const day = Math.floor((ctx.time[i] - 7 * 3600000 + (m >= ${rs} && ${rs} > ${re} ? 86400000 : 0)) / 86400000);
const inRange = ${rs} > ${re} ? (m >= ${rs} || m < ${re}) : (m >= ${rs} && m < ${re});
if (inRange) { if (s.rday !== day) { s.rday = day; s.hi = -Infinity; s.lo = Infinity; s.done = false; s.swH = null; s.swL = null; } s.hi = Math.max(s.hi, ctx.high[i]); s.lo = Math.min(s.lo, ctx.low[i]); return null; }
const p = ctx.position;
if (p) { if (p.barsOpen >= ${maxBars} || m >= ${flat}) return { action: 'close' }; return null; }
const wd = ctx.nyDayOfWeek >= 1 && ctx.nyDayOfWeek <= 5;
if (!wd || s.done || m < ${ws} || m >= ${we} || !isFinite(s.hi)) return null;
const c = ctx.close[i], atr = ctx.ta.atr(14);
if (!(atr > 0)) return null;
if (ctx.high[i] > s.hi) s.swH = Math.max(s.swH ?? -Infinity, ctx.high[i]);
if (ctx.low[i] < s.lo) s.swL = Math.min(s.swL ?? Infinity, ctx.low[i]);
const lots = (r) => Math.max(0.01, Math.floor(ctx.balance * 0.01 / (r * ctx.contractSize) * 100) / 100);
if (s.swH != null && c < s.hi) { const sl = s.swH + ${buf} * atr, r = sl - c; if (r > 0) { s.done = true; return { action: 'sell', lots: lots(r), sl, tp: c - ${tp} * r }; } }
if (s.swL != null && c > s.lo) { const sl = s.swL - ${buf} * atr, r = c - sl; if (r > 0) { s.done = true; return { action: 'buy', lots: lots(r), sl, tp: c + ${tp} * r }; } }
return null;`;

// Range breakout with an overnight-capable range [rs, re) and an entry window [ws, we); stop at the range's far side
// ('far'), its middle ('mid') or k x ATR ('atr')
const rbo = ({ rs, re, ws, we, tp = 2, maxBars = 24, stop = 'mid', k = 1.5, flat = 960, maxRangeAtr = 0, minRangeAtr = 0, minRisk = 0 }) => `
const s = ctx.state, i = ctx.i, m = ctx.nyHour * 60 + ctx.nyMinute;
const day = Math.floor((ctx.time[i] - 7 * 3600000 + (${rs} > ${re} && m >= ${rs} ? 86400000 : 0)) / 86400000);
const inRange = ${rs} > ${re} ? (m >= ${rs} || m < ${re}) : (m >= ${rs} && m < ${re});
if (inRange) { if (s.rday !== day) { s.rday = day; s.hi = -Infinity; s.lo = Infinity; s.done = false; } s.hi = Math.max(s.hi, ctx.high[i]); s.lo = Math.min(s.lo, ctx.low[i]); return null; }
const p = ctx.position;
if (p) { if (p.barsOpen >= ${maxBars} || m >= ${flat}) return { action: 'close' }; return null; }
const wd = ctx.nyDayOfWeek >= 1 && ctx.nyDayOfWeek <= 5;
if (!wd || s.done || m < ${ws} || m >= ${we} || !isFinite(s.hi)) return null;
const c = ctx.close[i], atr = ctx.ta.atr(14);
if (!(atr > 0)) return null;
const width = s.hi - s.lo;
if (${maxRangeAtr} && width > ${maxRangeAtr} * atr) return null;
if (${minRangeAtr} && width < ${minRangeAtr} * atr) return null;
const up = c > s.hi, dn = c < s.lo;
if (!up && !dn) return null;
const mid = (s.hi + s.lo) / 2;
const stop = '${stop}' === 'far' ? (up ? s.lo : s.hi) : '${stop}' === 'mid' ? mid : (up ? c - ${k} * atr : c + ${k} * atr);
const risk = Math.abs(c - stop);
if (!(risk > ${minRisk})) return null;
s.done = true;
const lots = Math.max(0.01, Math.floor(ctx.balance * 0.01 / (risk * ctx.contractSize) * 100) / 100);
return up ? { action: 'buy', lots, sl: stop, tp: c + ${tp} * risk } : { action: 'sell', lots, sl: stop, tp: c - ${tp} * risk };`;

const H = (h, mm = 0) => h * 60 + mm;
const candidates = {
  ...Object.fromEntries([2, 3, 4, 6].flatMap((mr) => [
    [`MR${mr} LBO London->NY mid 1.5R`, rbo({ rs: H(2), re: H(5), ws: H(8, 30), we: H(11), tp: 1.5, minRisk: mr })],
    [`MR${mr} ORB NY 08:00-08:30 range 1.5R`, orb({ rs: H(8), re: H(8, 30), ee: H(11), tp: 1.5, minRisk: mr })],
    [`MR${mr} ABO Asia->London far 1R`, rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 1, stop: 'far', flat: H(8), minRisk: mr })],
    [`MR${mr} ABO Asia->London mid 1.5R`, rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 1.5, flat: H(8), minRisk: mr })],
  ])),
  'ABO Asia(20-02)->London 02-05 mid 1R': rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 1, flat: H(8) }),
  'ABO Asia(20-02)->London 02-05 mid 1.5R': rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 1.5, flat: H(8) }),
  'ABO Asia(20-02)->London 02-05 mid 2R': rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 2, flat: H(8) }),
  'ABO Asia(20-02)->London 02-05 far 1R': rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 1, stop: 'far', flat: H(8) }),
  'ABO Asia(20-02)->London 02-05 atr1.5 2R': rbo({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 2, stop: 'atr', flat: H(8) }),
  'ABO Asia(19-01)->01-05 mid 1.5R': rbo({ rs: H(19), re: H(1), ws: H(1), we: H(5), tp: 1.5, flat: H(8) }),
  'LBO London(02-05)->NY 08:30-11 mid 1.5R': rbo({ rs: H(2), re: H(5), ws: H(8, 30), we: H(11), tp: 1.5 }),
  'LBO London(02-05)->NY 08:30-11 atr1.5 2R': rbo({ rs: H(2), re: H(5), ws: H(8, 30), we: H(11), tp: 2, stop: 'atr' }),
  'NYBO NYopen(08-08:30)->08:30-11 mid 1.5R': rbo({ rs: H(8), re: H(8, 30), ws: H(8, 30), we: H(11), tp: 1.5 }),
  'ORB NY 08:00-08:30 range stop 2R': orb({ rs: H(8), re: H(8, 30), ee: H(11) }),
  'ORB NY 08:00-08:30 range stop 1.5R': orb({ rs: H(8), re: H(8, 30), ee: H(11), tp: 1.5 }),
  'ORB NY 08:00-08:30 range stop 1R': orb({ rs: H(8), re: H(8, 30), ee: H(11), tp: 1 }),
  'ORB NY 08:20-08:35 range 2R': orb({ rs: H(8, 20), re: H(8, 35), ee: H(11) }),
  'ORB NY 09:30-10:00 range 2R': orb({ rs: H(9, 30), re: H(10), ee: H(12) }),
  'ORB NY 08:00-09:00 range 2R': orb({ rs: H(8), re: H(9), ee: H(11, 30) }),
  'ORB NY 08:00-08:30 atr1.5 2R': orb({ rs: H(8), re: H(8, 30), ee: H(11), stop: 'atr', k: 1.5 }),
  'ORB London 02:00-03:00 range 2R': orb({ rs: H(2), re: H(3), ee: H(5), flat: H(8) }),
  'ORB London 03:00-03:30 range 2R': orb({ rs: H(3), re: H(3, 30), ee: H(6), flat: H(8) }),
  'ORB NY 08:00-08:30 2R trend240': orb({ rs: H(8), re: H(8, 30), ee: H(11), trend: 240 }),
  'Fade Asia (20-02) in London 02-05 2R': fade({ rs: H(20), re: H(2), ws: H(2), we: H(5), flat: H(8) }),
  'Fade Asia (20-02) in London 02-05 1.5R': fade({ rs: H(20), re: H(2), ws: H(2), we: H(5), tp: 1.5, flat: H(8) }),
  'Fade London (02-05) in NY 08:30-11 2R': fade({ rs: H(2), re: H(5), ws: H(8, 30), we: H(11) }),
  'Fade NY open range (08:00-08:30) 08:30-11 2R': fade({ rs: H(8), re: H(8, 30), ws: H(8, 30), we: H(11) }),
};

const { bars, start } = slice(all, from, to);
console.log(`${from} to ${to}: ${bars.time.length - start} bars`);
for (const [name, code] of Object.entries(candidates)) {
  if (only && !name.includes(only)) continue;
  const t0 = Date.now();
  const r = E.runBacktest({ bars, startIndex: start, simCode: code, balance: 1e6, contractSize: 100, point: 0.01 });
  const st = rStats(r.trades, 100);
  const years = Object.values(st.byYear);
  console.log(`${name.padEnd(48)} n=${String(st.n).padStart(5)} win=${st.win.toFixed(1).padStart(5)}% avgR=${st.avgR.toFixed(3).padStart(6)} totR=${st.totalR.toFixed(1).padStart(7)} PF=${st.pf.toFixed(2)} DD=${st.maxDDR.toFixed(1)}R streak=${st.maxStreak} +yrs=${years.filter((v) => v > 0).length}/${years.length} err=${r.errors} ${Date.now() - t0}ms`);
}
await E.vite.close();
