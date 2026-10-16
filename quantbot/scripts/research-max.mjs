// Search for the highest-earning version of the session-range breakout on XAUUSD M5.
// Chosen on 2017-2022 only; 2023-2026 is reported as the unseen result. 2-hour cap on every trade.
import { loadEngine, loadMt5, slice, rStats } from './research-lib.mjs';
import fs from 'node:fs';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const H = (h, m = 0) => h * 60 + m;

const sim = ({ rs, re, ws, we, stop, tp, be, side, minRisk = 4 }) => `
const s = ctx.state, i = ctx.i, m = ctx.nyHour * 60 + ctx.nyMinute;
const day = Math.floor((ctx.time[i] - 7 * 3600000 + (${rs} > ${re} && m >= ${rs} ? 86400000 : 0)) / 86400000);
const inR = ${rs} > ${re} ? (m >= ${rs} || m < ${re}) : (m >= ${rs} && m < ${re});
if (inR) { if (s.rday !== day) { s.rday = day; s.hi = -Infinity; s.lo = Infinity; s.done = false; } s.hi = Math.max(s.hi, ctx.high[i]); s.lo = Math.min(s.lo, ctx.low[i]); return null; }
const p = ctx.position;
if (p) {
  if (p.barsOpen >= 24) return { action: 'close' };
  if (${be} && p.sl !== p.entry && (p.side === 'long' ? ctx.high[i] - p.entry >= ${be} * s.risk : p.entry - ctx.low[i] >= ${be} * s.risk)) return { action: 'modify', sl: p.entry };
  return null;
}
const wd = ctx.nyDayOfWeek >= 1 && ctx.nyDayOfWeek <= 5;
const today = Math.floor((ctx.time[i] - 7 * 3600000) / 86400000);
if (!wd || s.done || m < ${ws} || m >= ${we} || !isFinite(s.hi) || s.rday !== today) return null;
const c = ctx.close[i];
const up = c > s.hi && '${side}' !== 'short', dn = c < s.lo && '${side}' !== 'long';
if (!up && !dn) return null;
s.done = true;
const mid = (s.hi + s.lo) / 2;
const sl = '${stop}' === 'mid' ? mid : '${stop}' === 'far' ? (up ? s.lo : s.hi) : (up ? s.hi - 0.25 * (s.hi - s.lo) : s.lo + 0.25 * (s.hi - s.lo));
const risk = Math.abs(c - sl);
if (!(risk >= ${minRisk})) return null;
s.risk = risk;
const lots = Math.max(0.01, Math.floor(ctx.balance * 0.01 / (risk * ctx.contractSize) * 100) / 100);
return up ? { action: 'buy', lots, sl, tp: c + ${tp} * risk } : { action: 'sell', lots, sl, tp: c - ${tp} * risk };`;

const grid = [];
for (const [rs, re, rn] of [[H(2), H(5), 'Ldn 02-05'], [H(1), H(5), 'Ldn 01-05'], [H(20), H(5), 'Asia+Ldn 20-05'], [H(3), H(7), 'Ldn 03-07']])
  for (const [ws, we] of [[H(8), H(11)], [H(8, 30), H(11)], [H(8, 30), H(12)], [H(9, 30), H(12)]])
    for (const stop of ['mid', 'far', 'q'])
      for (const tp of [1, 1.5, 2, 3])
        for (const be of [0, 1])
          for (const side of ['both', 'long'])
            grid.push({ rs, re, ws, we, stop, tp, be, side, name: `${rn} | ${String(ws / 60).padEnd(4)}-${we / 60} | stop ${stop} | ${tp}R | BE ${be ? 'on' : 'off'} | ${side}` });

const design = slice(all, '2017-01-01', '2023-01-01'), test = slice(all, '2023-01-01', '2026-10-16');
const rows = [];
let k = 0;
for (const g of grid) {
  const code = sim(g);
  const d = rStats(E.runBacktest({ bars: design.bars, startIndex: design.start, simCode: code, balance: 1e6, contractSize: 100, point: 0.01 }).trades, 100);
  rows.push({ ...g, code, d });
  if (++k % 100 === 0) console.error(`${k}/${grid.length}`);
}
// Best 15 on the design years (with enough trades), then their unseen 2023-2026 result
const top = rows.filter((r) => r.d.n >= 300).sort((a, b) => b.d.totalR - a.d.totalR).slice(0, 15);
for (const r of top) {
  r.t = rStats(E.runBacktest({ bars: test.bars, startIndex: test.start, simCode: r.code, balance: 1e6, contractSize: 100, point: 0.01 }).trades, 100);
  console.log(`${r.name.padEnd(70)} 2017-22: ${r.d.n} tr ${r.d.totalR.toFixed(1)}R avg ${r.d.avgR.toFixed(3)} | 2023-26: ${r.t.n} tr ${r.t.totalR.toFixed(1)}R avg ${r.t.avgR.toFixed(3)} PF ${r.t.pf.toFixed(2)} DD ${r.t.maxDDR.toFixed(1)}R`);
}
const positive = rows.filter((r) => r.d.totalR > 0).length;
console.log(`\n${rows.length} versions tried; ${positive} were profitable on 2017-2022`);
fs.writeFileSync('/tmp/claude-0/-home-user-Trading/87c1ae9b-47d0-5d27-bc14-6c04e7ad7576/scratchpad/max-top.json', JSON.stringify(top.map(({ code, ...r }) => ({ ...r, code }))));
await E.vite.close();
