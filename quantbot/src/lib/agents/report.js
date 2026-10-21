// A BACKTEST's per-market results as the markdown report the agent reads back (and results/<name>.results.md)
import { robustnessVerdict } from '../backtest/walkForward.js';

const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

export function reportText(name, results, errors = []) {
  const lines = [`# ${name} backtest`, ''];
  let net = 0, trades = 0;
  for (const r of results) {
    const m = r.metrics;
    net += m.net; trades += m.trades;
    lines.push(`## ${r.symbol} ${r.timeframe} (${r.from} to ${r.to})`,
      `net ${f(m.net)} (${f(m.returnPct)}%), trades ${m.trades} (${m.longs} long / ${m.shorts} short), win rate ${f(m.winRate, 1)}%, profit factor ${f(m.profitFactor)}`,
      `max drawdown ${f(m.maxDD)} (${f(m.maxDDPct)}%), avg R ${m.avgR == null ? 'n/a' : f(m.avgR)}, expectancy ${f(m.expectancy)}, SL hits ${m.slHits}, TP hits ${m.tpHits}, max loss streak ${m.maxLossStreak}`,
      ...(r.costs ? [`spread cost ${f(r.costs.spread)}, slippage cost ${f(r.costs.slippage)}`] : []),
      ...(r.robust ? [`walk-forward: ${robustnessVerdict(r.robust)}${r.robust.enough ? ` — profitable in ${r.robust.profitableWindows}/${r.robust.totalWindows} windows, out-of-sample net ${f(r.robust.oos.net)} (PF ${f(r.robust.oos.pf)})` : ''}`] : []),
      ...(r.rules?.length ? ['rule checks:', ...r.rules.map((x) => `- ${x.status}: ${x.rule}${x.detail ? ` (${x.detail})` : ''}`)] : []),
      '');
  }
  for (const e of errors) lines.push(`ERROR ${e}`);
  // A real pass must also hold out-of-sample where we have enough trades to judge — no overfit "winners".
  const oosOk = results.every((r) => !r.robust || !r.robust.enough || r.robust.oosHolds);
  const pass = results.length && results.every((r) => r.metrics.profitFactor > 1.3 && r.metrics.maxDDPct < 10) && trades >= 30 && oosOk;
  lines.push(`TOTAL net ${f(net)} over ${trades} trades on ${results.length} market(s). Target (PF > 1.3, max DD < 10%, 30+ trades, holds out-of-sample, every market): ${pass ? 'MET' : 'not met'}.`);
  return lines.join('\n');
}
