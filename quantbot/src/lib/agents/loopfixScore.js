// One number per backtest so loop-fix rounds can be compared: reward profit factor and profit, punish drawdown;
// a script that takes too few trades can't be trusted, so it scores low. Pure — no app imports, so it is unit-tested.
export function scoreOf(results) {
  const ok = (results || []).filter((r) => r.metrics && Number.isFinite(r.metrics.profitFactor));
  if (!ok.length) return { score: -1e9, pf: 0, ddPct: 0, net: 0, trades: 0, robust: 0, oosHolds: false };
  const avg = (f) => ok.reduce((a, r) => a + f(r.metrics), 0) / ok.length;
  const pf = avg((m) => Math.min(m.profitFactor, 3));
  const ddPct = avg((m) => m.maxDDPct || 0);
  const net = ok.reduce((a, r) => a + (r.metrics.net || 0), 0);
  const trades = ok.reduce((a, r) => a + (r.metrics.trades || 0), 0);
  // Robustness (walk-forward) is optional on the result; when present it dominates, because a strategy that holds
  // out-of-sample is worth far more than one with a prettier in-sample curve. This is what stops the loop overfitting.
  const withWf = ok.filter((r) => r.robust && r.robust.enough);
  const robust = withWf.length ? withWf.reduce((a, r) => a + r.robust.score, 0) / withWf.length : 0;
  const oosHolds = withWf.length > 0 && withWf.every((r) => r.robust.oosHolds);
  let score = pf * 100 - ddPct * 2 + Math.min(trades, 200) * 0.05 + (net > 0 ? 10 : 0) - (trades < 30 ? (30 - trades) * 5 : 0);
  score += robust * 120 + (oosHolds ? 60 : 0);                 // reward holding up across unseen windows
  if (withWf.length && !withWf.some((r) => r.robust.oos.net > 0)) score -= 80; // overfit: loses out-of-sample everywhere
  return { score: Math.round(score * 100) / 100, pf: Math.round(pf * 100) / 100, ddPct: Math.round(ddPct * 10) / 10, net: Math.round(net), trades, robust: Math.round(robust * 100) / 100, oosHolds };
}
