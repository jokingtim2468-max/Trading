// The London-NY gold bot on recent 2026 periods, and on LucidPro accounts trading MGC (micro gold: 10 oz, $10 per $1).
// Every trade is simulated once at 1 MGC with QuantBot's engine (15-point minimum spread); P&L scales with the number
// of micros, so any sizing rule can be applied exactly afterwards.
import { loadEngine, loadMt5, slice } from './research-lib.mjs';
import { LONDON_NY_SIM } from './xau-london-ny.sim.js';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const ONE_MGC = LONDON_NY_SIM.replace(/const lots = .*;/, 'const lots = 0.1;');
const { bars, start } = slice(all, '2022-12-01', '2026-10-16');
const raw = E.runBacktest({ bars, startIndex: start, simCode: ONE_MGC, balance: 1e6, contractSize: 100, point: 0.01 }).trades
  .filter((t) => t.entryTime >= Date.parse('2023-01-01'));
// Per trade: date (NY), stop distance, P&L and worst open loss for 1 MGC
const trades = raw.map((t) => ({ day: new Date(t.entryTime - 7 * 3600000).toISOString().slice(0, 10), t: t.entryTime, side: t.side, entry: t.entry, exit: t.exit, reason: t.reason, stop: Math.abs(t.entry - t.sl0), pnl1: t.pnl, mae1: (t.mae || 0) * 10 }));

const PLANS = { 25000: { mll: 1000, dll: null, fdll: 600, target: 1250, maxMicros: 20 }, 50000: { mll: 2000, dll: 1200, fdll: 1200, target: 3000, maxMicros: 40 }, 100000: { mll: 3000, dll: 1800, fdll: 1800, target: 6000, maxMicros: 60 }, 150000: { mll: 4500, dll: 2700, fdll: 2700, target: 9000, maxMicros: 100 } };
// Sizing: risk budget = riskFrac x MLL per trade, in whole micros; skip the trade if even 1 micro is over budget
// Near the trailing floor the budget shrinks so one stop-out can't breach the account (90% of the room left)
const micros = (stop, plan, riskFrac, room = Infinity) => Math.min(plan.maxMicros, Math.floor(Math.min(riskFrac * plan.mll, 0.9 * room) / (stop * 10)));

const money = (x) => `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(0)}`;
function period(label, from, to, plan, riskFrac) {
  const sel = trades.filter((x) => x.day >= from && x.day <= to);
  let net = 0, taken = 0, wins = 0;
  const lines = [];
  for (const x of sel) {
    const n = micros(x.stop, plan, riskFrac);
    const p = n * x.pnl1;
    if (n > 0) { net += p; taken++; if (p > 0) wins++; }
    lines.push(`    ${x.day} ${x.side.padEnd(5)} @ ${x.entry.toFixed(2)} stop $${x.stop.toFixed(2)} -> ${x.reason.padEnd(6)} ${n ? `${n} MGC ${money(p)}` : 'skipped (stop too wide for the budget)'}`);
  }
  console.log(`${label}: ${taken} trades, ${wins} wins, net ${money(net)}${sel.length <= 6 ? `\n${lines.join('\n')}` : ''}`);
}

// Evaluation: start on the first trading day of each month since Jan 2023 and run until pass or breach
function evalRun(plan, size, riskFrac, startIdx) {
  let bal = size, peak = size, floor = size - plan.mll, days = 0, lastDay = null;
  for (let k = startIdx; k < trades.length; k++) {
    const x = trades[k];
    if (x.day !== lastDay) { days++; lastDay = x.day; }
    const n = micros(x.stop, plan, riskFrac, bal - floor);
    if (!n) continue;
    if (bal - n * x.mae1 <= floor || bal + n * x.pnl1 <= floor) return { result: 'breached', days };
    bal += n * x.pnl1;
    if (bal >= size + plan.target) return { result: 'passed', days };
    peak = Math.max(peak, bal); // one trade a day, so the end-of-day balance is the balance after it
    floor = Math.min(peak - plan.mll, size + 100);
  }
  return { result: bal - floor < 10 * 3 ? 'stalled' : 'open', days };
}

const P50 = PLANS[50000];
console.log('LUCIDPRO 50K, MGC, risk per trade 15% of the max loss limit ($300):');
period('  Day   15 Oct 2026', '2026-10-15', '2026-10-15', P50, 0.15);
period('  Week  5-9 Oct 2026', '2026-10-05', '2026-10-09', P50, 0.15);
period('  Month September 2026', '2026-09-01', '2026-09-30', P50, 0.15);
period('  2026 so far (1 Jan - 15 Oct)', '2026-01-01', '2026-10-15', P50, 0.15);

console.log('\nEVALUATIONS started on the 1st of every month, Jan 2023 - Sep 2026:');
const starts = [];
for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const d = `${y}-${String(m).padStart(2, '0')}-01`; if (d <= '2026-09-01') starts.push(trades.findIndex((x) => x.day >= d)); }
for (const size of [25000, 50000, 100000, 150000]) for (const rf of [0.1, 0.15, 0.25]) {
  const plan = PLANS[size];
  const runs = starts.map((s) => evalRun(plan, size, rf, s));
  const done = runs.filter((r) => r.result === 'passed' || r.result === 'breached');
  const passed = runs.filter((r) => r.result === 'passed');
  const open = runs.filter((r) => r.result === 'open').length;
  const med = passed.map((r) => r.days).sort((a, b) => a - b)[Math.floor(passed.length / 2)];
  console.log(`  ${String(size / 1000).padStart(3)}K risk ${String(rf * 100).padStart(2)}% of MLL ($${(rf * plan.mll).toFixed(0)}): passed ${passed.length}/${done.length} (${((passed.length / done.length) * 100).toFixed(0)}%), breached ${done.length - passed.length}, still running ${open}, median ${med ?? '-'} trading days to pass`);
}
await E.vite.close();
