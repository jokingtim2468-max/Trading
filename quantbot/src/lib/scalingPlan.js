// Prop scaling planner: Monte Carlo of buying FTMO-style 2-Step challenges, passing both phases under the daily and
// max loss rules, then trading funded accounts with payouts and the scaling plan. Daily returns are drawn from a
// normal distribution with the strategy's average and swing (as % of the account), so pass odds, time and payouts
// come out of the same numbers.
//
// opts: { mean, sd: daily return % of the account; size: account $; accounts: how many at once; fee: $ per challenge;
//   target1, target2, daily, maxLoss: % rules; minDays; split: 0.8; payoutDays: 14 (trading days); scaleEvery: 4 months;
//   scaleStep: 0.25; cap: $ total funded before scaling; scaleCap: $ max after scaling; months: horizon; runs }
// -> { months: [{ month, funded (median $), payouts (median cumulative $), fees (median cumulative $), net }], passRate,
//      medianMonthsToFunded, p10Net, p90Net, medianNet }
export function planScaling(o) {
  const opt = { size: 100000, accounts: 2, fee: 499, target1: 10, target2: 5, daily: 5, maxLoss: 10, minDays: 4, split: 0.8, payoutDays: 14, scaleEvery: 4, scaleStep: 0.25, cap: 400000, scaleCap: 2000000, months: 36, runs: 400, seed: 7, ...o };
  let s = opt.seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const D = 21; // trading days per month
  const total = opt.months * D;
  const per = Array.from({ length: opt.months }, () => ({ funded: [], payouts: [], fees: [] }));
  let passes = 0, attempts = 0;
  const toFunded = [], nets = [];

  for (let run = 0; run < opt.runs; run++) {
    // Each slot is one account: challenge phase 1 -> 2 -> funded, re-bought when it fails
    const slots = Array.from({ length: opt.accounts }, () => ({}));
    let fees = 0, paid = 0, fundedSize = 0, firstFunded = null;
    const buy = (x) => { Object.assign(x, { stage: 1, bal: 0, days: 0, sincePay: 0 }); fees += opt.fee; attempts++; };
    slots.forEach(buy);
    for (let d = 0; d < total; d++) {
      const month = Math.floor(d / D);
      // Scaling: each account grows by scaleStep every scaleEvery months after the first funded one, up to scaleCap in total
      const steps = firstFunded == null ? 0 : Math.floor((d - firstFunded) / (opt.scaleEvery * D));
      const mult = Math.min((1 + opt.scaleStep) ** steps, opt.scaleCap / (opt.size * opt.accounts));
      fundedSize = 0;
      for (const x of slots) {
        const r = opt.mean + opt.sd * gauss();          // % of the account today
        const worst = Math.min(r, r - Math.abs(opt.sd * gauss()) * 0.5); // intraday dip before the close
        x.days++;
        const failed = worst <= -opt.daily || x.bal + worst <= -opt.maxLoss;
        if (failed) { buy(x); continue; }
        x.bal += r;
        if (x.stage === 1 && x.bal >= opt.target1 && x.days >= opt.minDays) Object.assign(x, { stage: 2, bal: 0, days: 0 });
        else if (x.stage === 2 && x.bal >= opt.target2 && x.days >= opt.minDays) {
          Object.assign(x, { stage: 3, bal: 0, days: 0, sincePay: 0 }); passes++; fees -= opt.fee; // FTMO refunds the fee with the first reward
          if (firstFunded == null) { firstFunded = d; toFunded.push(d / D); }
        } else if (x.stage === 3) {
          x.sincePay++;
          if (x.sincePay >= opt.payoutDays && x.bal > 0) {
            paid += (x.bal / 100) * opt.size * mult * opt.split; x.bal = 0; x.sincePay = 0;
          }
        }
        if (x.stage === 3) fundedSize += opt.size * mult;
      }
      if (d % D === D - 1) {
        per[month].funded.push(fundedSize);
        per[month].payouts.push(paid); per[month].fees.push(fees);
      }
    }
    if (firstFunded == null) toFunded.push(Infinity);
    nets.push(paid - fees);
  }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
  return {
    months: per.map((m, i) => ({ month: i + 1, funded: med(m.funded), payouts: med(m.payouts), fees: med(m.fees), net: med(m.payouts) - med(m.fees) })),
    passRate: attempts ? passes / attempts : 0,
    medianMonthsToFunded: med(toFunded),
    neverFunded: toFunded.filter((x) => x === Infinity).length / opt.runs,
    p10Net: pct(nets, 0.1), medianNet: med(nets), p90Net: pct(nets, 0.9),
  };
}
