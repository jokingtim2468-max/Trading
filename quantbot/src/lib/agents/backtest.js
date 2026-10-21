import { client } from '@/api/client';
import { loadDatasets, loadTestBars, asTested } from '@/lib/backtest/data';
import { runInWorker } from '@/lib/backtest/runWorker';
import { computeMetrics } from '@/lib/backtest/metrics';
import { marketStats } from '@/lib/backtest/marketStats';
import { testSignals } from '@/lib/backtest/signals';
import { walkForward } from '@/lib/backtest/walkForward';

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// The markets an agent tests on and their stats files (data/<SYMBOL>_<TF>.stats.json)
export async function agentMarkets({ tf = 'M5', days = 180 } = {}, onPhase = () => {}) {
  const to = day(Date.now()), from = day(Date.now() - days * 86400000);
  const out = [];
  for (const ds of await loadDatasets()) {
    onPhase(`Loading ${ds.symbol} ${tf}…`);
    const { bars, start } = await loadTestBars(asTested(ds, tf), { tf, from, to });
    out.push({ ds: asTested(ds, tf), bars, start, from, to, tf, stats: marketStats(bars) });
  }
  return out;
}

// BACKTEST for an agent: the app's model reads the script once (the Script Tester's translation), then the same
// test code runs on every market -> { results, errors }
export async function backtestScript({ code, language, model, markets, signal, onPhase = () => {} }) {
  const results = [], errors = [];
  let prepared = null;
  for (const m of markets) {
    if (signal?.aborted) break;
    const market = { symbol: m.ds.symbol, timeframe: m.tf, contract_size: m.ds.contract_size, point: m.ds.point, stats: m.stats };
    try {
      if (!prepared) {
        onPhase('reading the script…');
        prepared = (await client.functions.invoke('scriptTester', { code, language, model, market })).data;
      }
      onPhase(`testing on ${m.ds.symbol}…`);
      const sim = await runInWorker(
        { bars: m.bars, startIndex: m.start, simCode: prepared.sim_code, balance: prepared.settings.balance, contractSize: m.ds.contract_size || 100, point: m.ds.point || 0.01 },
        { maxMs: 90000, signal },
      );
      const metrics = computeMetrics(sim.trades, sim.equity, prepared.settings.balance, m.ds.contract_size || 100);
      const robust = walkForward(sim.trades);
      results.push({ symbol: m.ds.symbol, timeframe: m.tf, from: m.from, to: m.to, metrics, robust, rules: testSignals(sim.trades).results, errors: sim.errors });
    } catch (e) {
      if (e.name === 'AbortError') break;
      errors.push(`${m.ds.symbol}: ${e.response?.data?.error || e.message}`);
    }
  }
  return { results, errors };
}
