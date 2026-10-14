import { mulberry32, pctile } from './rng';

const ITER = 1000, RUIN_PCT = 20, BANDS = 60;
const clamp = (v) => Math.max(0, Math.min(1, v));

// Resamples the trade P&L (with replacement) 1000 times to stress order and luck, then scores it 0-100
export function runMonteCarlo(trades, balance) {
  const pnls = trades.map((t) => t.pnl);
  const n = pnls.length;
  if (n < 5) return null;
  const rand = mulberry32(42);
  const nSteps = Math.min(BANDS, n);
  const steps = Array.from({ length: nSteps }, (_, k) => Math.round(((k + 1) * n) / nSteps));
  const atStep = steps.map(() => new Float64Array(ITER));
  const nets = new Float64Array(ITER), dds = new Float64Array(ITER);

  for (let it = 0; it < ITER; it++) {
    let eq = balance, peak = balance, maxDD = 0, s = 0;
    for (let j = 1; j <= n; j++) {
      eq += pnls[Math.floor(rand() * n)];
      if (eq > peak) peak = eq;
      maxDD = Math.max(maxDD, ((peak - eq) / peak) * 100);
      if (j === steps[s]) atStep[s++][it] = eq;
    }
    nets[it] = eq - balance;
    dds[it] = maxDD;
  }
  nets.sort();
  dds.sort();

  const probProfit = nets.filter((v) => v > 0).length / ITER;
  const ruin = dds.filter((v) => v >= RUIN_PCT).length / ITER;
  const p5 = pctile(nets, 0.05), p50 = pctile(nets, 0.5), p95 = pctile(nets, 0.95);
  const dd50 = pctile(dds, 0.5), dd95 = pctile(dds, 0.95);
  // 40% profitable runs, 20% worst-5% outcome, 25% bad-case drawdown, 15% sample size
  const score = Math.round(probProfit * 40 + clamp(0.5 + (p5 / balance) * 20) * 20 + clamp(1 - dd95 / 30) * 25 + clamp(n / 100) * 15);
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  const bands = steps.map((trade, k) => {
    const v = atStep[k].sort();
    return { trade, p5: pctile(v, 0.05), p50: pctile(v, 0.5), p95: pctile(v, 0.95) };
  });
  return { iterations: ITER, ruinPct: RUIN_PCT, trades: n, score, grade, probProfit, ruin, p5, p50, p95, dd50, dd95, bands };
}