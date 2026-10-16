// Weekly P&L of the London-NY gold bot on MGC at different risk budgets (whole micros; skip if 1 micro is over budget)
import { loadEngine, loadMt5, slice } from './research-lib.mjs';
import { LONDON_NY_SIM } from './xau-london-ny.sim.js';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const { bars, start } = slice(all, '2022-12-01', '2026-10-16');
const raw = E.runBacktest({ bars, startIndex: start, simCode: LONDON_NY_SIM.replace(/const lots = .*;/, 'const lots = 0.1;'), balance: 1e6, contractSize: 100, point: 0.01 }).trades
  .filter((t) => t.entryTime >= Date.parse('2023-01-02'));
const week = (t) => { const d = new Date(t - 7 * 3600000); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
for (const [from, label] of [['2023-01-02', '2023-2026'], ['2026-01-01', '2026 so far']]) {
  const tr = raw.filter((t) => t.entryTime >= Date.parse(from));
  const weeks = [...new Set(tr.map((t) => week(t.entryTime)))];
  console.log(`${label} (${weeks.length} trading weeks):`);
  for (const budget of [100, 150, 200, 300, 500, 750]) {
    const byWeek = new Map(weeks.map((w) => [w, 0]));
    for (const t of tr) { const n = Math.min(40, Math.floor(budget / (Math.abs(t.entry - t.sl0) * 10))); if (n) byWeek.set(week(t.entryTime), byWeek.get(week(t.entryTime)) + n * t.pnl); }
    const v = [...byWeek.values()], avg = v.reduce((a, b) => a + b, 0) / v.length;
    console.log(`  risk $${String(budget).padEnd(4)} per trade: average ${avg >= 0 ? '+' : '-'}$${Math.abs(avg).toFixed(0)}/week, weeks at +$50 or more: ${v.filter((x) => x >= 50).length}/${v.length} (${((v.filter((x) => x >= 50).length / v.length) * 100).toFixed(0)}%), losing weeks: ${v.filter((x) => x < 0).length}, worst week -$${Math.abs(Math.min(...v)).toFixed(0)}, best week +$${Math.max(...v).toFixed(0)}`);
  }
}
await E.vite.close();
