// The London-NY gold bot on FTMO 2-Step accounts trading XAUUSD (1 lot = 100 oz, $100 per $1; 0.01-lot steps).
// Each trade is simulated once with QuantBot's engine (15-point minimum spread) and scaled to any size afterwards.
// Rules: Challenge +10%, Verification +5%, both at least 4 trading days, no time limit; fail on a 5% daily loss
// (from the day's starting balance, counting the worst open loss) or 10% below the starting balance.
// Funded: payouts every 14 days at 80% (profit out, balance back to the start); a breach ends the account.
// usage: node scripts/xau-ftmo.mjs <XAUUSD M5 csv> [commission $ per lot round trip]
import { loadEngine, loadMt5, slice } from './research-lib.mjs';
import { LONDON_NY_SIM } from './xau-london-ny.sim.js';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const COMMISSION = Number(process.argv[3] || 0);
const { bars, start } = slice(all, '2022-12-01', '2026-10-16');
const raw = E.runBacktest({ bars, startIndex: start, simCode: LONDON_NY_SIM.replace(/const lots = .*;/, 'const lots = 1;'), balance: 1e7, contractSize: 100, point: 0.01 }).trades
  .filter((t) => t.entryTime >= Date.parse('2023-01-01'));
// Per trade for 1 lot: Prague trading day, stop distance, P&L, worst open loss
const pragueDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(ms));
const trades = raw.map((t) => ({ day: pragueDay(t.entryTime), t: t.entryTime, stop: Math.abs(t.entry - t.sl0), pnl1: t.pnl, mae1: (t.mae || 0) * 100 }));
const lotsFor = (risk, stop, room) => Math.floor(Math.min(risk, 0.9 * room) / (stop * 100) * 100 + 1e-9) / 100;

// One phase / funded run from trade k with size S and risk fraction r of S; stops at target, breach or end
function run(S, r, k0, { target = null, minDays = 4, payoutDays = null, maxDays = null } = {}) {
  let bal = S, day = null, dayStart = S, days = 0, k = k0, out = 0, lastPay = trades[k0]?.t;
  const floor = S * 0.9;
  for (; k < trades.length; k++) {
    const x = trades[k];
    if (x.day !== day) { day = x.day; dayStart = bal; days++; }
    if (maxDays && (x.t - trades[k0].t) / 86400000 > maxDays) break;
    // Payout: every N days when in profit (the bot is flat between trades)
    if (payoutDays && (x.t - lastPay) / 86400000 >= payoutDays && bal > S) { out += (bal - S) * 0.8; bal = S; dayStart = S; lastPay = x.t; }
    // Size so one stop-out can't breach either limit (90% of the room left)
    const dailyRoom = bal - (dayStart - S * 0.05);
    const n = lotsFor(r * S, x.stop, Math.min(bal - floor, dailyRoom));
    if (n <= 0) continue;
    const worst = bal - n * x.mae1;
    if (worst <= floor || worst <= dayStart - S * 0.05) return { result: 'breached', days, k, out, bal };
    bal += n * x.pnl1 - n * COMMISSION;
    if (bal <= floor || bal <= dayStart - S * 0.05) return { result: 'breached', days, k, out, bal };
    if (target && bal >= S + target && days >= minDays) return { result: 'passed', days, k: k + 1, out, bal, t: x.t };
  }
  return { result: 'open', days, k, out, bal };
}

const S = 100000;
const starts = [];
for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const d = `${y}-${String(m).padStart(2, '0')}-01`; if (d <= '2026-09-01') starts.push(trades.findIndex((x) => x.day >= d)); }
console.log(`FTMO 100K 2-Step on XAUUSD, ${trades.length} trades 2023-2026, commission $${COMMISSION}/lot. Evaluations started on the 1st of each month:`);
for (const r of [0.005, 0.0075, 0.01, 0.015, 0.02]) {
  const res = starts.map((k0) => {
    const p1 = run(S, r, k0, { target: S * 0.1 });
    if (p1.result !== 'passed') return { result: p1.result === 'breached' ? 'failed challenge' : 'still in challenge' };
    const p2 = run(S, r, p1.k, { target: S * 0.05 });
    if (p2.result !== 'passed') return { result: p2.result === 'breached' ? 'failed verification' : 'still in verification' };
    return { result: 'funded', weeks: (p2.t - trades[k0].t) / 604800000, at: p2.k };
  });
  const funded = res.filter((x) => x.result === 'funded');
  const failed = res.filter((x) => x.result.startsWith('failed')).length;
  const weeks = funded.map((x) => x.weeks).sort((a, b) => a - b);
  // Funded year after passing: payouts every 14 days at 80%, and whether it breaches
  const years = funded.filter((x) => trades[x.at] && trades.at(-1).t - trades[x.at].t > 365 * 86400000).map((x) => run(S, r, x.at, { payoutDays: 14, maxDays: 365 }));
  const avgOut = years.length ? years.reduce((s, y) => s + y.out + (y.result === 'open' ? Math.max(0, (y.bal - S) * 0.8) : 0), 0) / years.length : null;
  const breached = years.filter((y) => y.result === 'breached').length;
  console.log(`  risk ${(r * 100).toFixed(2)}% ($${r * S}): funded ${funded.length}/${funded.length + failed} finished (${Math.round((funded.length / (funded.length + failed)) * 100)}%), failed ${failed}, still going ${res.length - funded.length - failed}; median ${weeks.length ? weeks[Math.floor(weeks.length / 2)].toFixed(0) : '-'} weeks to funded`
    + (years.length ? ` | first funded year (${years.length} cases): your 80% avg $${avgOut.toFixed(0)} ($${(avgOut / 52).toFixed(0)}/week), breached ${breached}/${years.length}` : ''));
}
await E.vite.close();
