import { useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';
import { MODELS } from '@/lib/models';
import { loadDatasets, loadTestBars, sliceBars, asTested, firstDate, lastDate, WARMUP_BARS } from '@/lib/backtest/data';
import { WINDOWS, findUnseenWindow, customWindow, fmtDate } from '@/lib/backtest/windows';
import { runInWorker } from '@/lib/backtest/runWorker';
import { computeMetrics, downsample } from '@/lib/backtest/metrics';
import { buildFixPrompt } from '@/lib/backtest/fixPrompt';
import { createTestSession, saveRun } from '@/lib/backtest/persist';
import { testSignals } from '@/lib/backtest/signals';
import { runMonteCarlo } from '@/lib/backtest/monteCarlo';
import { marketStats } from '@/lib/backtest/marketStats';
import { openConverterChat, addVersionToChat } from '@/lib/backtest/converterChat';

const WARMUP = WARMUP_BARS;
const DAY = 86400000;
const { StrategyRun, DataUsage } = client.entities;

export default function useStrategyLab(config) {
  const [datasets, setDatasets] = useState([]);
  const [runs, setRuns] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [chatId, setChatId] = useState(null);
  const stopRef = useRef(null); // AbortController of the run in progress
  const runsRef = useRef([]);
  const sessionsRef = useRef({});

  useEffect(() => { loadDatasets().then(setDatasets); }, []);

  // Waits for p, but gives up the moment this run's Stop is pressed (whatever p was doing is ignored)
  const guard = (p, signal) => {
    if (signal.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));
    return Promise.race([p, new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }))]);
  };

  // Picks the test dates from the calendar (every day the data covers), so 20 years of history never has to load
  // just to find a window. -> { start, end } in ms, label, reused
  async function pickDates(ds) {
    const page = await DataUsage.filter({ bot_name: config.botName, symbol: ds.symbol }, { limit: 500 });
    const used = page.items.map((u) => ({ start: Date.parse(u.start), end: Date.parse(u.end) }));
    const def = WINDOWS.find((w) => w.id === config.windowId);
    const first = Date.parse(`${firstDate(ds, config.timeframe)}T00:00:00Z`);
    const last = Date.parse(`${lastDate(ds)}T00:00:00Z`);
    const days = [];
    for (let t = first; t <= last; t += DAY) days.push(t);
    if (def.id === 'custom') {
      const w = customWindow(days, config.customFrom, config.customTo);
      if (!w) throw new Error(`No ${ds.symbol} data between ${config.customFrom} and ${config.customTo} (it starts ${fmtDate(first)}).`);
      const start = days[w.from], end = days[w.to] + DAY - 1;
      return { start, end, label: def.label, reused: used.some((u) => start <= u.end && end >= u.start) };
    }
    const w = findUnseenWindow(days, used, def.ms);
    if (!w) throw new Error(`No ${def.label} window left for "${config.botName}" on ${ds.symbol} (data runs ${fmtDate(first)} to ${fmtDate(last)}).`);
    return { start: days[w.from], end: days[w.to] + DAY - 1, label: def.label, reused: false };
  }

  // Bars for the window plus warm-up bars before it (the same loader the Strategy Tester uses)
  async function windowBars(ds, dates, say = setPhase) {
    const { bars, start } = await loadTestBars(ds, {
      tf: ds.timeframe, from: fmtDate(dates.start), to: fmtDate(dates.end),
      onProgress: (done, total) => total && say(`${ds.symbol}: downloading ${ds.timeframe} history (${done} of ${total} files)...`),
    });
    return { bars, w: { from: start, to: bars.time.length - 1 } };
  }

  // reuse: a conversion from an earlier market of the same run, so every market tests the same bot (one AI call)
  // signal: this run's stop signal; everything slow gives up the moment it fires
  async function runOnce(previous, session, ds, reuse, signal) {
    const until = (p) => guard(p, signal);
    // Progress text only while this run is live (a stopped run's leftovers stay quiet)
    const say = (text) => { if (!signal.aborted) setPhase(text); };
    if (!config.botName.trim()) throw new Error('Give the bot a name so its unseen data can be tracked.');
    say(`${ds.symbol}: loading market data...`);
    const log = [];
    const add = (level, msg) => log.push({ level, msg, t: Date.now() });

    const dates = await until(pickDates(ds));
    const { bars, w: span } = await until(windowBars(ds, dates, say));
    const w = { ...span, label: dates.label, reused: dates.reused };
    const windowText = `${w.label}: ${fmtDate(bars.time[w.from])} to ${fmtDate(bars.time[w.to])} (${w.to - w.from + 1} bars, ${ds.symbol} ${ds.timeframe})`;
    add('info', `Test window ${windowText}`);
    if (w.reused) add('warn', 'Part of this custom range was already seen by this bot.');

    const modelLabel = MODELS.find((m) => m.id === config.model)?.label;
    let conv = reuse;
    if (conv) {
      add('info', `Same conversion as ${reuse.firstSymbol}, tested on ${ds.symbol}`);
    } else {
      say(previous ? `Fixing v${previous.version} with ${modelLabel}...` : `Converting to ${config.target} with ${modelLabel}...`);
      const t0 = Date.now();
      const market = { symbol: ds.symbol, timeframe: ds.timeframe, contract_size: ds.contract_size, point: ds.point, balance: config.balance, stats: marketStats(bars) };
      const res = await until(client.functions.invoke('strategyTester', {
        strategy: config.strategy, rules: config.rules, target: config.target, model: config.model, market,
        previous: previous && { code: previous.code, sim_code: previous.sim_code, fix_prompt: previous.fixPrompt },
      }));
      conv = { ...res.data, firstSymbol: ds.symbol };
      add('info', `${previous ? `Fixed v${previous.version}` : 'Converted'} with ${modelLabel} in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    const failed = conv.results.filter((r) => r.status !== 'pass').length;
    add(failed ? 'warn' : 'info', `Rule test: ${conv.results.length - failed}/${conv.results.length} passed`);

    say('Simulating trades...');
    const from = Math.max(0, w.from - WARMUP);
    const sim = await runInWorker({
      bars: sliceBars(bars, from, w.to), startIndex: w.from - from, simCode: conv.sim_code,
      balance: config.balance, contractSize: ds.contract_size || 100, point: ds.point || 0.01,
    }, 30000, signal);
    sim.log.forEach((e) => log.push(e));
    const metrics = computeMetrics(sim.trades, sim.equity, config.balance, ds.contract_size || 100);
    add(metrics.net >= 0 ? 'info' : 'warn', `Backtest: ${metrics.trades} trades, net ${metrics.net.toFixed(2)}, max DD ${metrics.maxDDPct.toFixed(2)}%`);
    const signals = testSignals(sim.trades);
    const results = [...conv.results, ...signals.results];
    const sigFailed = signals.results.filter((r) => r.status !== 'pass').length;
    add(sigFailed ? 'warn' : 'info', `Signal test: ${Object.entries(signals.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);

    say('Running Monte Carlo robustness test...');
    const mc = runMonteCarlo(sim.trades, config.balance);
    add(mc && mc.score >= 50 ? 'info' : 'warn', mc
      ? `Monte Carlo (${mc.iterations} runs): score ${mc.score}/100 (${mc.grade}), ${(mc.probProfit * 100).toFixed(0)}% profitable, 95th pct drawdown ${mc.dd95.toFixed(1)}%`
      : 'Monte Carlo skipped: fewer than 5 trades.');

    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    say('Saving run...');
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
      id: saved.id, sessionId: nextSession.id, version, target: config.target, windowText, ...conv, convResults: conv.results, results, metrics, log, fixPrompt,
      trades: sim.trades, equity: downsample(sim.equity), price: priceBars, balance: config.balance,
      mc, contractSize: ds.contract_size || 100, ds,
    };
  }

  async function execute(previous, iterations = 1) {
    setError('');
    const controller = new AbortController();
    stopRef.current = controller;
    const stopped = () => controller.signal.aborted;
    if (!previous) setChatId(null);
    const push = (run) => {
      if (stopped()) return;
      runsRef.current = [...runsRef.current, run];
      setRuns(runsRef.current);
      setActiveIdx(runsRef.current.length - 1);
    };
    try {
      if (!previous) {
        const picked = datasets.filter((d) => config.datasetIds.includes(d.id)).map((d) => asTested(d, config.timeframe));
        if (!picked.length) throw new Error('Pick at least one market.');
        // Convert once, then test that same bot on every picked market
        let conv = null;
        const tested = [];
        try {
          for (const ds of picked) {
            if (stopped()) break;
            const run = await runOnce(null, null, ds, conv, controller.signal);
            conv = conv || { code: run.code, sim_code: run.sim_code, summary: run.summary, results: run.convResults, firstSymbol: ds.symbol };
            tested.push(run);
            push(run);
          }
        } finally {
          // Then a chat linked to this bot opens with the results and code, ready for fine-tuning
          if (tested.length && !stopped()) {
            setPhase('Opening a chat to fine-tune it...');
            setChatId(await openConverterChat(config, tested));
          }
        }
      } else {
        let prev = previous;
        for (let k = 0; k < iterations && !stopped(); k++) {
          const run = await runOnce(prev, sessionsRef.current[prev.sessionId], prev.ds, null, controller.signal);
          push(run);
          if (chatId && !stopped()) await addVersionToChat(chatId, config, run);
          prev = run;
        }
      }
    } catch (e) {
      if (!stopped()) setError(e.response?.data?.error || e.message);
    }
    // A stopped run already went back to idle; a newer run may have started since
    if (stopRef.current === controller) { stopRef.current = null; setPhase(''); }
  }

  const updateFixPrompt = (idx, text) => {
    runsRef.current = runsRef.current.map((x, k) => (k === idx ? { ...x, fixPrompt: text } : x));
    setRuns(runsRef.current);
  };

  return {
    datasets, runs, activeIdx, setActiveIdx, phase, error, running: !!phase, chatId,
    run: () => execute(null), fix: (run, iterations) => execute(run, iterations),
    // Stops at once: downloads, the AI call and the simulation in progress are dropped and the page is ready again
    stop: () => { stopRef.current?.abort(); setPhase(''); }, updateFixPrompt,
  };
}