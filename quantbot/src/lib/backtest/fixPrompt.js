const money = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;

// Turns a run's metrics, rule results and log into a ready-to-send fix request
export function buildFixPrompt({ version, windowText, metrics: m, results, log, mc }) {
  const issues = [];
  results.filter((r) => r.status !== 'pass').forEach((r) => issues.push(`Rule ${r.status.toUpperCase()}: ${r.rule}. ${r.detail}`));
  log.filter((e) => e.level === 'error').slice(0, 8).forEach((e) => issues.push(`Simulator error: ${e.msg}`));
  log.filter((e) => e.level === 'warn' && !e.msg.startsWith('Closed')).slice(0, 8).forEach((e) => issues.push(`Simulator warning: ${e.msg}`));
  if (m.trades === 0) issues.push('No trades were taken in the test window: entry conditions are too strict or never trigger.');
  if (m.trades > 0 && m.profitFactor < 1) issues.push(`Losing system: profit factor ${m.profitFactor.toFixed(2)}, net ${money(m.net)}.`);
  if (m.maxDDPct > 10) issues.push(`Max drawdown ${m.maxDDPct.toFixed(1)}% is too high: tighten risk per trade or add a daily loss limit.`);
  if (m.trades >= 5 && m.winRate < 35 && (m.avgR ?? 0) < 1.5) issues.push(`Win rate ${m.winRate.toFixed(0)}% with average ${(m.avgR ?? 0).toFixed(2)}R: improve entry filtering or reward-to-risk.`);
  if (m.maxLossStreak >= 6) issues.push(`${m.maxLossStreak} losses in a row: add a regime/volatility filter.`);
  if (mc && mc.score < 50) issues.push(`Monte Carlo robustness ${mc.score}/100 (${mc.grade}): only ${(mc.probProfit * 100).toFixed(0)}% of ${mc.iterations} resampled runs were profitable and the 95th percentile drawdown is ${mc.dd95.toFixed(1)}%. Make the edge less dependent on a few lucky trades.`);

  return [
    `Version ${version} was backtested on ${windowText}.`,
    `Results: ${m.trades} trades, net ${money(m.net)} (${m.returnPct.toFixed(2)}%), win rate ${m.winRate.toFixed(1)}%, profit factor ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'}, max drawdown ${m.maxDDPct.toFixed(2)}%, Sharpe ${m.sharpe.toFixed(2)}, SL hits ${m.slHits}, TP hits ${m.tpHits}.`,
    ...(mc ? [`Monte Carlo (${mc.iterations} runs): robustness ${mc.score}/100 (${mc.grade}), ${(mc.probProfit * 100).toFixed(0)}% profitable, median net ${money(mc.p50)}, worst 5% net ${money(mc.p5)}, 95th pct drawdown ${mc.dd95.toFixed(1)}%.`] : []),
    '',
    issues.length ? 'Issues found:' : 'No hard issues found. Improve robustness and risk-adjusted return without overfitting.',
    ...issues.map((s, k) => `${k + 1}. ${s}`),
    '',
    'Fix every issue above while keeping the strategy\'s core idea and all rules satisfied. Do not curve-fit to this window. Return the full updated code and sim_code.',
  ].join('\n');
}