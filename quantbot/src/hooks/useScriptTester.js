import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import * as api from '@/lib/quantApi';
import { defaultModel, MODELS } from '@/lib/models';
import { loadDatasets, loadTestBars, asTested } from '@/lib/backtest/data';
import { runInWorker } from '@/lib/backtest/runWorker';
import { computeMetrics, downsample } from '@/lib/backtest/metrics';
import { marketStats } from '@/lib/backtest/marketStats';
import { testSignals } from '@/lib/backtest/signals';
import { runMonteCarlo } from '@/lib/backtest/monteCarlo';
import { latestScript } from '@/lib/chatScript';
import { saveScriptTest } from '@/lib/backtest/saveScriptTest';

const logLine = (e) => `[${e.level.toUpperCase()}] ${e.t ? new Date(e.t).toISOString().slice(0, 16) : ''} ${e.msg}`;

export default function useScriptTester() {
  const [chats, setChats] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [model, setModel] = useState('builtin');
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    Promise.all([client.auth.me(), api.getKeyStatus(), loadDatasets()]).then(async ([user, status, ds]) => {
      // Default model from Settings when a key is linked, otherwise the built-in model
      setModel(status?.anthropic?.linked || status?.google?.linked ? defaultModel(status, user) : 'builtin');
      setDatasets(ds);
      setChats(await api.loadSessions(user.id));
      setReady(true);
    });
  }, []);

  // range: { tf, from, to } (YYYY-MM-DD); uploaded files keep their own timeframe
  async function run(chatId, datasetIds, range) {
    setError('');
    setResults([]);
    for (const picked of datasets.filter((d) => datasetIds.includes(d.id))) {
      const r = await runOne(chatId, asTested(picked, range.tf), range);
      if (!r) break;
      setResults((xs) => [...xs, r]);
    }
    setPhase('');
  }

  async function runOne(chatId, ds, range) {
    const chat = chats.find((c) => c.id === chatId);
    const modelLabel = MODELS.find((m) => m.id === model)?.label;
    const log = [];
    const add = (level, msg) => log.push({ level, msg, t: Date.now() });
    try {
      setPhase('Pulling the newest script from the chat...');
      const script = await latestScript(chatId);
      if (!script) throw new Error(`No MT5 or Pine script in "${chat.title}" yet. Ask QuantBot to write one in that chat first.`);
      add('info', `Script "${chat.title}" (${script.language}) from the reply sent ${new Date(script.at).toLocaleString()}`);

      setPhase(`${ds.symbol}: loading market data...`);
      // Warm-up bars come from before the chosen dates, so the whole range is traded
      const { bars, start } = await loadTestBars(ds, {
        tf: range.tf, from: range.from, to: range.to,
        onProgress: (done, total) => total && setPhase(`${ds.symbol}: downloading ${ds.timeframe} history (${done} of ${total} files)...`),
      });
      const n = bars.time.length;
      if (n - start < 20) throw new Error(`Only ${n - start} bars of ${ds.symbol} ${ds.timeframe} between ${range.from} and ${range.to}. Pick a longer range.`);

      setPhase(`Reading the script with ${modelLabel}...`);
      const t0 = Date.now();
      const res = await client.functions.invoke('scriptTester', {
        code: script.code, language: script.language, model,
        market: { symbol: ds.symbol, timeframe: ds.timeframe, contract_size: ds.contract_size, point: ds.point, stats: marketStats(bars) },
      });
      const { sim_code: simCode, summary, rules, settings } = res.data;
      add('info', `Prepared the test with ${modelLabel} in ${Math.round((Date.now() - t0) / 1000)}s`);

      setPhase('Simulating trades...');
      const contractSize = ds.contract_size || 100;
      const sim = await runInWorker({ bars, startIndex: start, simCode, balance: settings.balance, contractSize, point: ds.point || 0.01 }, 90000);
      sim.log.forEach((e) => log.push(e));
      const metrics = computeMetrics(sim.trades, sim.equity, settings.balance, contractSize);
      const signals = testSignals(sim.trades);
      const mc = runMonteCarlo(sim.trades, settings.balance);
      add(metrics.net >= 0 ? 'info' : 'warn', `Backtest: ${metrics.trades} trades, net ${metrics.net.toFixed(2)}, max DD ${metrics.maxDDPct.toFixed(2)}%`);

      setPhase('Saving results...');
      const period = { start: new Date(bars.time[start]).toISOString(), end: new Date(bars.time[n - 1]).toISOString() };
      const test = { name: chat.title, script, ds, model, balance: settings.balance, summary, rules, simCode, metrics, results: signals.results, ...period };
      const saved = await saveScriptTest({ ...test, logText: log.map(logLine).join('\n').slice(0, 20000) }, sim.trades);
      return { ...test, ...saved, modelLabel, log, mc, trades: sim.trades, equity: downsample(sim.equity) };
    } catch (e) {
      setError(`${ds.symbol}: ${e.response?.data?.error || e.message}`);
      return null;
    }
  }

  return { chats, datasets, model, ready, phase, error, results, running: !!phase, run };
}