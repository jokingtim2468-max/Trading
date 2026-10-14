import { playStage } from './lucidStage';

// LucidPro rules from support.lucidtrading.com (Aug 2026). Trail balance = size + MLL + $100, lock = size + $100.
export const LUCID_PRO = {
  25000: { target: 1250, mll: 1000, evalDll: null, fundedDll: 600, maxMini: 2, minProfit: 250, maxPayout: [1000, 1500] },
  50000: { target: 3000, mll: 2000, evalDll: 1200, fundedDll: 1200, maxMini: 4, minProfit: 500, maxPayout: [2000, 2500] },
  100000: { target: 6000, mll: 3000, evalDll: 1800, fundedDll: 1800, maxMini: 6, minProfit: 750, maxPayout: [2500, 3000] },
  150000: { target: 9000, mll: 4500, evalDll: 2700, fundedDll: 2700, maxMini: 10, minProfit: 1000, maxPayout: [3000, 3500] },
};
export const LUCID_SIZES = [25000, 50000, 100000, 150000];

const SESSION_SHIFT = 2 * 3600000; // Futures trading day ends 5 PM New York, about 22:00 UTC

// Groups trades by futures session day of their exit
export function groupDays(trades) {
  const days = [];
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    const d = Math.floor((t.exitTime + SESSION_SHIFT) / 86400000);
    const last = days[days.length - 1];
    if (last && last.d === d) last.trades.push(t);
    else days.push({ d, trades: [t] });
  }
  return days;
}

export function stageOptions(s, contractSize) {
  const plan = LUCID_PRO[s.size];
  return { plan, opts: { dllOn: s.dllOn, maxLots: plan.maxMini * (Number(s.lotsPerMini) || 1), contractSize } };
}

// Evaluation first; if it passes, the remaining days run on a fresh funded account
export function simulateLucid(trades, s, contractSize) {
  const days = groupDays(trades);
  const { plan, opts } = stageOptions(s, contractSize);
  const ev = playStage(days, 0, plan, s.size, { ...opts, stage: 'eval' });
  const funded = ev.status === 'passed' ? playStage(days, ev.end + 1, plan, s.size, { ...opts, stage: 'funded' }) : null;
  return { plan, eval: ev, funded, totalDays: days.length };
}