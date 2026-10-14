import { mulberry32, pctile } from '@/lib/backtest/rng';
import { groupDays, stageOptions } from './lucidPro';
import { playStage } from './lucidStage';

// Replays the session days in random orders to estimate pass, breach and payout odds
export function lucidMonteCarlo(trades, s, contractSize, iterations = 500) {
  const days = groupDays(trades);
  if (days.length < 3) return null;
  const { plan, opts } = stageOptions(s, contractSize);
  const rand = mulberry32(42);
  let passed = 0, breached = 0, fundedAlive = 0, paid = 0;
  const toPass = [];

  for (let it = 0; it < iterations; it++) {
    const d = [...days];
    for (let k = d.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [d[k], d[j]] = [d[j], d[k]];
    }
    const ev = playStage(d, 0, plan, s.size, { ...opts, stage: 'eval' });
    if (ev.status === 'breached') breached++;
    if (ev.status !== 'passed') continue;
    passed++;
    toPass.push(ev.days);
    const f = playStage(d, ev.end + 1, plan, s.size, { ...opts, stage: 'funded' });
    if (f.status !== 'breached') fundedAlive++;
    paid += f.payouts.reduce((a, p) => a + p.toTrader, 0);
  }
  toPass.sort((a, b) => a - b);
  return {
    iterations, passRate: passed / iterations, breachRate: breached / iterations,
    medianDays: toPass.length ? pctile(toPass, 0.5) : null,
    fundedSurvival: passed ? fundedAlive / passed : null, avgPaid: paid / iterations,
  };
}