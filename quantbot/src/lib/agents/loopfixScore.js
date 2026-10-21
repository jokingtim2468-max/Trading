// One number per backtest so loop-fix rounds can be compared: reward profit factor and profit, punish drawdown;
// a script that takes too few trades can't be trusted, so it scores low. Pure — no app imports, so it is unit-tested.
export function scoreOf(results) {
  const ok = (results || []).filter((r) => r.metrics && Number.isFinite(r.metrics.profitFactor));
  if (!ok.length) return { score: -1e9, pf: 0, ddPct: 0, net: 0, trades: 0 };
  const avg = (f) => ok.reduce((a, r) => a + f(r.metrics), 0) / ok.length;
  const pf = avg((m) => Math.min(m.profitFactor, 3));
  const ddPct = avg((m) => m.maxDDPct || 0);
  const net = ok.reduce((a, r) => a + (r.metrics.net || 0), 0);
  const trades = ok.reduce((a, r) => a + (r.metrics.trades || 0), 0);
  const score = pf * 100 - ddPct * 2 + Math.min(trades, 200) * 0.05 + (net > 0 ? 10 : 0) - (trades < 30 ? (30 - trades) * 5 : 0);
  return { score: Math.round(score * 100) / 100, pf: Math.round(pf * 100) / 100, ddPct: Math.round(ddPct * 10) / 10, net: Math.round(net), trades };
}
