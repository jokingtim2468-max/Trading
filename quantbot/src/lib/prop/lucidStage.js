// Plays one LucidPro account (stage 'eval' or 'funded') through session days, starting at day index `from`
export function playStage(days, from, plan, size, { stage, dllOn, maxLots, contractSize }) {
  const trail = size + plan.mll + 100, lock = size + 100;
  let bal = size, peak = size, floor = size - plan.mll, cycleStart = size, cycleBest = 0, dllHits = 0, oversize = 0;
  const payouts = [], curve = [];
  const point = (k) => curve.push({ t: days[k].d, balance: bal, floor });
  const result = (status, end, reason) => ({ status, end, reason, days: end - from + 1, balance: bal, floor, dllHits, oversize, payouts, curve });

  for (let k = from; k < days.length; k++) {
    // Fixed DLL; funded switches to LucidScale (60% of peak EOD profit) once it closes above the trail balance
    const dll = !dllOn ? null : stage === 'eval' ? plan.evalDll : peak > trail ? 0.6 * (peak - size) : plan.fundedDll;
    const open = bal;
    for (const t of days[k].trades) {
      if (t.lots > maxLots + 1e-9) oversize++;
      const worst = bal - (t.mae || 0) * t.lots * contractSize;
      bal += t.pnl;
      if (worst <= floor || bal <= floor) {
        bal = Math.min(bal, floor);
        point(k);
        return result('breached', k, `Max loss limit hit on day ${k - from + 1}`);
      }
      if (stage === 'eval' && bal >= size + plan.target) {
        point(k);
        return result('passed', k, `Profit target hit on day ${k - from + 1}`);
      }
      if (dll != null && open - bal >= dll) { dllHits++; break; }
    }

    peak = Math.max(peak, bal);
    floor = Math.min(peak - plan.mll, lock);

    if (stage === 'funded') {
      cycleBest = Math.max(cycleBest, bal - open);
      const profit = bal - cycleStart;
      const amount = Math.floor(Math.min(plan.maxPayout[payouts.length ? 1 : 0], bal - trail));
      // Payout needs the minimum profit goal, 40% consistency and $500+ above the buffer balance
      if (profit >= plan.minProfit && cycleBest <= 0.4 * profit && amount >= 500) {
        bal -= amount;
        payouts.push({ day: k - from + 1, amount, toTrader: amount * 0.9 });
        cycleStart = bal;
        cycleBest = 0;
      }
    }
    point(k);
  }
  return result('open', days.length - 1, stage === 'eval' ? 'Profit target not reached in this window' : 'Account still active at end of window');
}