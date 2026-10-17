// The London-NY gold bot on your own broker account (XAUUSD, 1 lot = 100 oz, 0.01-lot steps), compounding:
// each trade risks a fixed % of the current balance. Shows yearly return, worst drawdown and losing months.
// usage: node scripts/xau-own-account.mjs <XAUUSD M5 csv> [commission $ per lot round trip]
import { loadEngine, loadMt5, slice } from './research-lib.mjs';
import { LONDON_NY_SIM } from './xau-london-ny.sim.js';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const COMMISSION = Number(process.argv[3] || 0);
const { bars, start } = slice(all, '2004-06-01', '2026-10-16');
const trades = E.runBacktest({ bars, startIndex: start, simCode: LONDON_NY_SIM.replace(/const lots = .*;/, 'const lots = 1;'), balance: 1e7, contractSize: 100, point: 0.01 }).trades
  .map((t) => ({ t: t.entryTime, year: new Date(t.entryTime).getUTCFullYear(), month: new Date(t.entryTime).toISOString().slice(0, 7), stop: Math.abs(t.entry - t.sl0), pnl1: t.pnl }));

function run(from, to, risk, startBal = 10000) {
  let bal = startBal, peak = bal, maxDd = 0;
  const months = new Map();
  for (const x of trades.filter((x) => x.t >= Date.parse(from) && x.t < Date.parse(to))) {
    const lots = Math.floor((bal * risk) / (x.stop * 100) * 100) / 100;
    if (lots <= 0) continue;
    const p = lots * x.pnl1 - lots * COMMISSION;
    bal += p;
    peak = Math.max(peak, bal);
    maxDd = Math.max(maxDd, (peak - bal) / peak);
    months.set(x.month, (months.get(x.month) || 0) + p);
  }
  const years = (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000);
  const losing = [...months.values()].filter((v) => v < 0).length;
  return { end: bal, cagr: (bal / startBal) ** (1 / years) - 1, maxDd, losing, months: months.size };
}
const pct = (v) => `${(v * 100).toFixed(1)}%`;
console.log(`Own account, compounding, commission $${COMMISSION}/lot:`);
for (const [label, from, to] of [['2023 - Oct 2026', '2023-01-01', '2026-10-16'], ['2026 so far', '2026-01-01', '2026-10-16'], ['2004 - 2022', '2004-06-01', '2023-01-01']]) {
  for (const r of [0.005, 0.01, 0.02]) {
    const x = run(from, to, r);
    console.log(`  ${label.padEnd(15)} risk ${pct(r).padStart(4)}: $10,000 -> $${x.end.toFixed(0).padStart(6)}, ${pct(x.cagr)}/year, worst drop ${pct(x.maxDd)}, losing months ${x.losing}/${x.months}`);
  }
}
await E.vite.close();
