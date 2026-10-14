import { useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';
import { MODELS } from '@/lib/models';
import { loadDatasets, loadBars, sliceBars } from '@/lib/backtest/data';
import { WINDOWS, findUnseenWindow, customWindow, overlapsSeen, fmtDate } from '@/lib/backtest/windows';
import { runInWorker } from '@/lib/backtest/runWorker';
import { computeMetrics, downsample } from '@/lib/backtest/metrics';
import { buildFixPrompt } from '@/lib/backtest/fixPrompt';
import { createTestSession, saveRun } from '@/lib/backtest/persist';
import { testSignals } from '@/lib/backtest/signals';
import { runMonteCarlo } from '@/lib/backtest/monteCarlo';
import { marketStats } from '@/lib/backtest/marketStats';

const WARMUP = 500;
const { StrategyRun, DataUsage } = client.entities;

export default function useStrategyLab(config) {
  const [datasets, setDatasets] = useState([]);
  const [runs, setRuns] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const stopRef = useRef(false);
  const runsRef = useRef([]);
  const sessionsRef = useRef({});

  useEffect(() => { loadDatasets().then(setDatasets); }, []);

  async function pickWindow(ds, bars) {
    const page = await DataUsage.filter({ bot_name: config.botName, symbol: ds.symbol }, { limit: 500 });
    const used = page.items.map((u) => ({ start: Date.parse(u.start), end: Date.parse(u.end) }));
    const def = WINDOWS.find((w) => w.id === config.windowId);
    const w = def.id === 'custom'
      ? customWindow(bars.time, config.customFrom, config.customTo)
      : findUnseenWindow(bars.time, used, def.ms);
    if (!w) throw new Error(def.id === 'custom' ? 'No bars in that date range.' : `No ${def.label} window left for "${config.botName}" on ${ds.symbol} (data runs ${fmtDate(bars.time[0])} to ${fmtDate(bars.time[bars.time.length - 1])}).`);
    return { ...w, label: def.label, reused: def.id === 'custom' && overlapsSeen(bars.time, w, used) };
  }

  async function runOnce(previous, session, ds) {
    if (!config.botName.trim()) throw new Error('Give the bot a name so its unseen data can be tracked.');
    setPhase(`${ds.symbol}: loading market data...`);
    const log = [];
    const add = (level, msg) => log.push({ level, msg, t: Date.now() });

    const bars = await loadBars(ds);
    const w = await pickWindow(ds, bars);
    const windowText = `${w.label}: ${fmtDate(bars.time[w.from])} to ${fmtDate(bars.time[w.to])} (${w.to - w.from + 1} bars, ${ds.symbol} ${ds.timeframe})`;
    add('info', `Test window ${windowText}`);
    if (w.reused) add('warn', 'Part of this custom range was already seen by this bot.');

    const modelLabel = MODELS.find((m) => m.id === config.model)?.label;
    setPhase(previous ? `Fixing v${previous.version} with ${modelLabel}...` : `Converting to ${config.target} with ${modelLabel}...`);
    const t0 = Date.now();
    const market = { symbol: ds.symbol, timeframe: ds.timeframe, contract_size: ds.contract_size, point: ds.point, balance: config.balance, stats: marketStats(bars) };
    const res = await client.functions.invoke('strategyTester', {
      strategy: config.strategy, rules: config.rules, target: config.target, model: config.model, market,
      previous: previous && { code: previous.code, sim_code: previous.sim_code, fix_prompt: previous.fixPrompt },
    });
    const conv = res.data;
    add('info', `${previous ? `Fixed v${previous.version}` : 'Converted'} with ${modelLabel} in ${Math.round((Date.now() - t0) / 1000)}s`);
    const failed = conv.results.filter((r) => r.status !== 'pass').length;
    add(failed ? 'warn' : 'info', `Rule test: ${conv.results.length - failed}/${conv.results.length} passed`);

    setPhase('Simulating trades...');
    const from = Math.max(0, w.from - WARMUP);
    const sim = await runInWorker({
      bars: sliceBars(bars, from, w.to), startIndex: w.from - from, simCode: conv.sim_code,
      balance: config.balance, contractSize: ds.contract_size || 100, point: ds.point || 0.01,
    });
    sim.log.forEach((e) => log.push(e));
    const metrics = computeMetrics(sim.trades, sim.equity, config.balance, ds.contract_size || 100);
    add(metrics.net >= 0 ? 'info' : 'warn', `Backtest: ${metrics.trades} trades, net ${metrics.net.toFixed(2)}, max DD ${metrics.maxDDPct.toFixed(2)}%`);
    const signals = testSignals(sim.trades);
    const results = [...conv.results, ...signals.results];
    const sigFailed = signals.results.filter((r) => r.status !== 'pass').length;
    add(sigFailed ? 'warn' : 'info', `Signal test: ${Object.entries(signals.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);

    setPhase('Running Monte Carlo robustness test...');
    const mc = runMonteCarlo(sim.trades, config.balance);
    add(mc && mc.score >= 50 ? 'info' : 'warn', mc
      ? `Monte Carlo (${mc.iterations} runs): score ${mc.score}/100 (${mc.grade}), ${(mc.probProfit * 100).toFixed(0)}% profitable, 95th pct drawdown ${mc.dd95.toFixed(1)}%`
      : 'Monte Carlo skipped: fewer than 5 trades.');

    setPhase('Saving run...');
    const version = (await StrategyRun.count({ bot_name: config.botName })) + 1;
    const fixPrompt = buildFixPrompt({ version, windowText, metrics, results, log, mc });
    const logText = log.map((e) => `[${e.level.toUpperCase()}] ${e.t ? new Date(e.t).toISOString().slice(0, 16) : ''} ${e.msg}`).join('\n').slice(0, 20000);
    const { saved, session: nextSession } = await saveRun(session || await createTestSession(config, ds), {
      bot_name: config.botName, version, target: config.target, model: config.model, symbol: ds.symbol,
      window_label: w.label, start: new Date(bars.time[w.from]).toISOString(), end: new Date(bars.time[w.to]).toISOString(),
      rules: config.rules, code: conv.code, sim_code: conv.sim_code, summary: conv.summary, results,
      metrics: { ...metrics, profitFactor: Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : null, mc: mc ? { ...mc, bands: undefined } : null },
      log: logText, fix_prompt: fixPrompt,
    }, sim.trades);
    sessionsRef.current[nextSession.id] = nextSession;

    const priceBars = Array.from({ length: w.to - w.from + 1 }, (_, k) => {
      const j = w.from + k;
      return { t: bars.time[j], open: bars.open[j], close: bars.close[j], high: bars.high[j], low: bars.low[j], volume: bars.volume[j] };
    });
    return {
      id: saved.id, sessionId: nextSession.id, version, target: config.target, windowText, ...conv, results, metrics, log, fixPrompt,
      trades: sim.trades, equity: downsample(sim.equity), price: priceBars, balance: config.balance,
      mc, contractSize: ds.contract_size || 100, ds,
    };
  }

  async function execute(previous, iterations = 1) {
    setError('');
    stopRef.current = false;
    const push = (run) => {
      runsRef.current = [...runsRef.current, run];
      setRuns(runsRef.current);
      setActiveIdx(runsRef.current.length - 1);
    };
    try {
      if (!previous) {
        const picked = datasets.filter((d) => config.datasetIds.includes(d.id));
        if (!picked.length) throw new Error('Pick at least one market.');
        for (const ds of picked) {
          if (stopRef.current) break;
          push(await runOnce(null, null, ds));
        }
      } else {
        let prev = previous;
        for (let k = 0; k < iterations && !stopRef.current; k++) {
          const run = await runOnce(prev, sessionsRef.current[prev.sessionId], prev.ds);
          push(run);
          prev = run;
        }
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
    setPhase('');
  }

  const updateFixPrompt = (idx, text) => {
    runsRef.current = runsRef.current.map((x, k) => (k === idx ? { ...x, fixPrompt: text } : x));
    setRuns(runsRef.current);
  };

  return {
    datasets, runs, activeIdx, setActiveIdx, phase, error, running: !!phase,
    run: () => execute(null), fix: (run, iterations) => execute(run, iterations),
    stop: () => { stopRef.current = true; }, updateFixPrompt,
  };
}