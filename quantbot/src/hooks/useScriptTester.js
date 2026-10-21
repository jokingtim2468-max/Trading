import { useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';
import * as api from '@/lib/quantApi';
import { defaultModel, MODELS } from '@/lib/models';
import { loadDatasets, loadTestBars, asTested } from '@/lib/backtest/data';
import { runInWorker } from '@/lib/backtest/runWorker';
import { computeMetrics, downsample } from '@/lib/backtest/metrics';
import { evaluateProp } from '@/lib/backtest/propRules';
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
  const stopper = useRef(null);

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
  // account: { size, preset } — the balance to test with (default $10K) and, optionally, the prop-firm rules to judge by
  async function run(chatId, datasetIds, range, account = { size: 10000, preset: null }) {
    setError('');
    setResults([]);
    const ctl = new AbortController();
    stopper.current = ctl;
    // One translation per run, shared by every market (and any rewrite or check it needed)
    const shared = { prepared: null, rewrote: false, rechecked: false };
    for (const picked of datasets.filter((d) => datasetIds.includes(d.id))) {
      const r = await runOne(chatId, asTested(picked, range.tf), range, ctl.signal, shared, account);
      if (!r || ctl.signal.aborted) break;
      setResults((xs) => [...xs, r]);
    }
    // A run that was stopped leaves the screen to whatever started after it
    if (stopper.current === ctl) {
      stopper.current = null;
      setPhase('');
    }
  }

  // Stops the test at once, whatever step it is on
  function stop() {
    stopper.current?.abort();
    stopper.current = null;
    setPhase('');
  }

  async function runOne(chatId, ds, range, signal, shared, account) {
    const live = (text) => { if (!signal.aborted) setPhase(text); };
    const stopped = () => { if (signal.aborted) throw new DOMException('Stopped', 'AbortError'); };
    const chat = chats.find((c) => c.id === chatId);
    const modelLabel = MODELS.find((m) => m.id === model)?.label;
    const log = [];
    const add = (level, msg) => log.push({ level, msg, t: Date.now() });
    try {
      live('Pulling the newest script from the chat...');
      const script = await latestScript(chatId);
      if (!script) throw new Error(`No MT5 or Pine script in "${chat.title}" yet. Ask QuantBot to write one in that chat first.`);
      add('info', `Script "${chat.title}" (${script.language}) from the reply sent ${new Date(script.at).toLocaleString()}`);

      live(`${ds.symbol}: loading market data...`);
      // Warm-up bars come from before the chosen dates, so the whole range is traded
      const { bars, start } = await loadTestBars(ds, {
        tf: range.tf, from: range.from, to: range.to,
        onProgress: (done, total) => total && live(`${ds.symbol}: downloading ${ds.timeframe} history (${done} of ${total} files)...`),
      });
      const n = bars.time.length;
      if (n - start < 20) throw new Error(`Only ${n - start} bars of ${ds.symbol} ${ds.timeframe} between ${range.from} and ${range.to}. Pick a longer range.`);

      stopped();
      const market = { symbol: ds.symbol, timeframe: ds.timeframe, contract_size: ds.contract_size, point: ds.point, stats: marketStats(bars) };
      const translate = async (extra, what) => {
        live(`${ds.symbol}: ${what}`);
        const t0 = Date.now();
        const res = await client.functions.invoke('scriptTester', { code: script.code, language: script.language, model, market, ...extra });
        stopped();
        return { data: res.data, seconds: Math.round((Date.now() - t0) / 1000) };
      };
      const contractSize = ds.contract_size || 100;
      const simulate = (prep) => runInWorker(
        { bars, startIndex: start, simCode: prep.sim_code, balance: account.size, contractSize, point: ds.point || 0.01 },
        { maxMs: 120000, signal, onProgress: (done, total) => live(`${ds.symbol}: simulating trades... ${Math.floor((done / total) * 100)}% of ${total.toLocaleString()} bars`) },
      );

      // The script is translated once per run and the same test code runs on every market
      if (!shared.prepared) {
        const r = await translate({}, `reading the script with ${modelLabel}...`);
        shared.prepared = r.data;
        add('info', `Prepared the test with ${modelLabel} in ${r.seconds}s`);
      } else add('info', 'Same test code as the first market');

      let sim;
      try {
        sim = await simulate(shared.prepared);
      } catch (e) {
        if (!e.slow || shared.rewrote) throw e;
        // Slow test code (usually a loop over the whole chart on every bar): one rewrite, then the same check again
        add('warn', e.message);
        shared.rewrote = true;
        const r = await translate({ slow: { ...e.slow, sim_code: shared.prepared.sim_code } }, `the test code was too slow, asking ${modelLabel} for a faster version...`);
        shared.prepared = r.data;
        add('info', `Rewrote the test code for speed with ${modelLabel} in ${r.seconds}s`);
        try {
          sim = await simulate(shared.prepared);
        } catch (e2) {
          if (!e2.slow) throw e2;
          throw new Error(`${e2.message} A rewrite didn't fix it. Try a shorter date range, or ask the chat to simplify the script's loops.`);
        }
      }

      // No order at all over the whole range usually means a translation bug: one check with the condition counts
      if (!sim.trades.length && !sim.orders && !shared.rechecked) {
        shared.rechecked = true;
        sim.log.forEach((e) => log.push(e));
        add('warn', 'The test code took no trades, so it was sent back to be checked for translation bugs');
        const r = await translate({
          idle: { sim_code: shared.prepared.sim_code, bars: n - start, counts: sim.counts, log: sim.log.filter((e) => e.level !== 'info' || !e.msg.startsWith('Opened')).map((e) => e.msg) },
        }, `no trades, asking ${modelLabel} to check the test code...`);
        shared.prepared = r.data;
        add('info', `Checked the test code with ${modelLabel} in ${r.seconds}s. Results below are from the checked version.`);
        sim = await simulate(shared.prepared);
      }
      const prepared = shared.prepared;
      const { sim_code: simCode, summary, rules } = prepared;
      const balance = account.size;
      sim.log.forEach((e) => log.push(e));
      const metrics = computeMetrics(sim.trades, sim.equity, balance, contractSize);
      const signals = testSignals(sim.trades);
      const mc = runMonteCarlo(sim.trades, balance);
      // Judged against the chosen prop firm's rules, when one is picked
      const prop = account.preset ? evaluateProp(sim.trades, account.preset) : null;
      if (prop) add(prop.status === 'failed' ? 'warn' : 'info', `${prop.firm} ${prop.model} $${prop.size.toLocaleString()}: ${prop.status.toUpperCase()}${prop.date ? ` on ${prop.date}` : ''} — ${prop.reason}`);
      add(metrics.net >= 0 ? 'info' : 'warn', `Backtest: ${metrics.trades} trades, net ${metrics.net.toFixed(2)}, max DD ${metrics.maxDDPct.toFixed(2)}%`);

      stopped();
      live('Saving results...');
      const period = { start: new Date(bars.time[start]).toISOString(), end: new Date(bars.time[n - 1]).toISOString() };
      const test = { name: chat.title, script, ds, model, balance, summary, rules, simCode, metrics, results: signals.results, ...period };
      const saved = await saveScriptTest({ ...test, logText: log.map(logLine).join('\n').slice(0, 20000) }, sim.trades);
      // The tested candles (no copy: views into the loaded arrays) for the replay
      const tested = Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map((k) => [k, bars[k].subarray(start)]));
      return { ...test, ...saved, modelLabel, log, mc, prop, bars: tested, trades: sim.trades, equity: downsample(sim.equity) };
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) return null;
      setError(`${ds.symbol}: ${e.response?.data?.error || e.message}`);
      return null;
    }
  }

  return { chats, datasets, model, ready, phase, error, results, running: !!phase, run, stop };
}