// Backtest the London-NY breakout on an MT5 XAUUSD M5 export with QuantBot's engine and print a full report.
// node scripts/xau-report.mjs <csv> [balance] [risk%]
import { loadEngine, loadMt5, slice, rStats } from './research-lib.mjs';
import { LONDON_NY_SIM } from './xau-london-ny.sim.js';
const [csv, bal = '10000', risk = '1'] = process.argv.slice(2);
const E = await loadEngine();
const all = loadMt5(csv, { minSpread: 15 });
const code = LONDON_NY_SIM.replace('RISK = 0.01', `RISK = ${Number(risk) / 100}`);
const run = (from, to) => {
  const { bars, start } = slice(all, from, to);
  const r = E.runBacktest({ bars, startIndex: start, simCode: code, balance: Number(bal), contractSize: 100, point: 0.01 });
  return { r, m: E.computeMetrics(r.trades, r.equity, Number(bal), 100), st: rStats(r.trades, 100), mc: E.runMonteCarlo(r.trades, Number(bal)) };
};
const fmt = (x) => `${x.m.trades} trades, net $${x.m.net.toFixed(0)} (${x.m.returnPct.toFixed(1)}%), win ${x.m.winRate.toFixed(1)}%, PF ${x.m.profitFactor.toFixed(2)}, max DD ${x.m.maxDDPct.toFixed(1)}%, avg ${x.st.avgR.toFixed(3)}R, total ${x.st.totalR.toFixed(1)}R, worst streak ${x.m.maxLossStreak}, Monte Carlo ${x.mc ? `${x.mc.score}/100 (${x.mc.grade})` : '-'}`;
for (const [a, b, label] of [['2004-06-01', '2026-10-16', 'Full history'], ['2004-06-01', '2020-01-01', '2004-2019'], ['2020-01-01', '2023-01-01', '2020-2022 (picked here)'], ['2023-01-01', '2026-10-16', '2023-2026 (unseen)'], ['2026-01-01', '2026-10-16', '2026 so far'], ['2026-10-05', '2026-10-16', 'Last 2 weeks']]) {
  console.log(`${label.padEnd(26)} ${fmt(run(a, b))}`);
}
const full = run('2004-06-01', '2026-10-16');
console.log('\nR by year:', Object.entries(full.st.byYear).map(([y, v]) => `${y} ${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join('  '));
const recent = run('2026-10-05', '2026-10-16');
console.log('\nLast two weeks of trades:');
for (const t of recent.r.trades) console.log(`  ${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.side.padEnd(5)} @ ${t.entry.toFixed(2)} SL ${t.sl0.toFixed(2)} TP ${t.tp0.toFixed(2)} -> ${t.reason.padEnd(6)} ${t.exit.toFixed(2)} ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`);
const counts = run('2023-01-01', '2026-10-16').r.log.find((l) => l.msg.startsWith('Condition counts'));
console.log(`\n${counts?.msg}`);
await E.vite.close();
