// Neighbour check for the London-range -> New York breakout: does it hold up when its settings move a little?
import { loadEngine, loadMt5, slice, rStats } from './research-lib.mjs';
const [csv] = process.argv.slice(2);
const E = await loadEngine();
const all = loadMt5(csv, { minSpread: 15 });
const src = (await import('node:fs')).readFileSync(new URL('./research-xau.mjs', import.meta.url), 'utf8');
const rboSrc = src.slice(src.indexOf('const rbo ='), src.indexOf('const H ='));
const rbo = new Function(`${rboSrc}; return rbo;`)();
const H = (h, mm = 0) => h * 60 + mm;
const periods = [['2020-01-01', '2023-01-01'], ['2023-01-01', '2026-10-16']];
const data = periods.map(([a, b]) => slice(all, a, b));
const rows = [];
for (const ws of [H(8), H(8, 30), H(9)]) for (const tp of [1, 1.5, 2]) for (const stop of ['mid', 'far']) for (const minRisk of [3, 4, 5]) {
  const code = rbo({ rs: H(2), re: H(5), ws, we: H(11), tp, stop, minRisk });
  const res = data.map(({ bars, start }) => rStats(E.runBacktest({ bars, startIndex: start, simCode: code, balance: 1e6, contractSize: 100, point: 0.01 }).trades, 100));
  rows.push(`${String(ws / 60).padEnd(4)} tp${tp} ${stop} min$${minRisk} | 2020-22 n=${res[0].n} avgR=${res[0].avgR.toFixed(3)} | 2023-26 n=${res[1].n} avgR=${res[1].avgR.toFixed(3)} PF=${res[1].pf.toFixed(2)}`);
}
console.log(rows.join('\n'));
await E.vite.close();
