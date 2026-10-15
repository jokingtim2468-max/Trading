// Backtest engine, signal checks, metrics, Monte Carlo, prop-firm simulation and the page helpers.
// src/ uses Vite-style imports, so the modules are loaded through Vite.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite;
const load = (p) => vite.ssrLoadModule(p);
before(async () => { vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' }); });
after(() => vite.close());

const H = 3600000;
const T0 = Date.UTC(2026, 0, 5); // a Monday

// Bars from a list of closes: open = previous close, high/low 1 above/below the bar body
function makeBars(closes, { spread = 0 } = {}) {
  const n = closes.length;
  const b = { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n), spread: new Float64Array(n) };
  closes.forEach((c, i) => {
    const o = i ? closes[i - 1] : c;
    b.time[i] = T0 + i * H;
    b.open[i] = o;
    b.close[i] = c;
    b.high[i] = Math.max(o, c) + 1;
    b.low[i] = Math.min(o, c) - 1;
    b.volume[i] = 100;
    b.spread[i] = spread;
  });
  return b;
}

describe('engine', () => {
  test('fills at next open, hits TP, SL and strategy close', async () => {
    const { runBacktest } = await load('/src/lib/backtest/engine.js');
    //            0    1    2    3    4    5    6    7    8    9    10   11
    const bars = makeBars([100, 100, 102, 106, 111, 110, 108, 103, 98, 100, 101, 104]);
    const sim = `
      if (ctx.i === 0) return {action:'buy', lots: 1, sl: 95, tp: 110};
      if (ctx.i === 5) return {action:'sell', lots: 1, sl: 115, tp: 90};
      if (ctx.i === 8) return {action:'close'};
      if (ctx.i === 9) return {action:'buy', lots: 2, sl: 99.5, tp: 150};
      return null;`;
    const { trades, equity, errors } = runBacktest({ bars, startIndex: 0, simCode: sim, balance: 10000, contractSize: 1, point: 0.01 });
    assert.equal(errors, 0);
    assert.equal(equity.length, bars.time.length);
    assert.deepEqual(trades.map((t) => [t.side, t.entry, t.exit, t.reason]), [
      ['long', 100, 110, 'tp'],    // opened at bar 1 open, TP touched on bar 4
      ['short', 110, 98, 'signal'], // opened at bar 6 open, closed at bar 9 open
      ['long', 100, 99.5, 'sl'],    // opened at bar 10 open (100), bar 10 low 99 hits SL
    ]);
    assert.deepEqual(trades.map((t) => t.pnl), [10, 12, -1]);
  });

  test('spread is paid on the buy side, bad stops are rejected, errors are logged', async () => {
    const { runBacktest } = await load('/src/lib/backtest/engine.js');
    const bars = makeBars([100, 100, 100, 100, 100], { spread: 50 });
    const r = runBacktest({ bars, startIndex: 0, simCode: "if (ctx.i===0) return {action:'buy', lots:1, sl: 50, tp: 200}; if (ctx.i===1) return {action:'sell', lots:1, sl: 90}; if (ctx.i===2) throw new Error('boom');", balance: 1000, contractSize: 1, point: 0.01 });
    assert.equal(r.trades[0].entry, 100.5, 'long fills at ask');
    assert.equal(r.trades[0].reason, 'end');
    assert.ok(r.log.some((l) => /wrong side/.test(l.msg)));
    assert.ok(r.log.some((l) => /Runtime error: boom/.test(l.msg)));
    const broken = runBacktest({ bars, startIndex: 0, simCode: 'return (', balance: 1000, contractSize: 1, point: 0.01 });
    assert.match(broken.log[0].msg, /does not compile/);
  });

  test('indicators are available on ctx.ta', async () => {
    const { runBacktest } = await load('/src/lib/backtest/engine.js');
    const bars = makeBars(Array.from({ length: 40 }, (_, i) => 100 + i));
    const r = runBacktest({ bars, startIndex: 0, simCode: 'ctx.state.v = [ctx.ta.sma(ctx.close, 5), ctx.ta.ema(ctx.close, 5), ctx.ta.rsi(ctx.close, 14), ctx.ta.atr(14)]; if (ctx.i===39) throw new Error(JSON.stringify(ctx.state.v));', balance: 1, contractSize: 1, point: 1 });
    const [sma, ema, rsi, atr] = JSON.parse(r.log.find((l) => l.level === 'error').msg.replace('Runtime error: ', ''));
    assert.ok(Math.abs(sma - 137) < 1e-9);
    assert.ok(Math.abs(ema - 137) < 1e-9);
    assert.equal(rsi, 100);
    assert.ok(atr > 0);
  });

  test('rolling indicators match a plain recount, pivots match Pine', async () => {
    const { createTA } = await load('/src/lib/backtest/indicators.js');
    const closes = Array.from({ length: 300 }, (_, i) => 100 + 10 * Math.sin(i / 7) + ((i * 37) % 11));
    const bars = makeBars(closes);
    let i = 0;
    const ta = createTA(bars, () => i);
    for (i = 20; i < 300; i += 13) {
      const w = Array.from(bars.high.subarray(i - 19, i + 1));
      assert.equal(ta.highest(bars.high, 20), Math.max(...w));
      assert.equal(ta.lowest(bars.low, 20), Math.min(...Array.from(bars.low.subarray(i - 19, i + 1))));
      const c = Array.from(bars.close.subarray(i - 19, i + 1)), m = c.reduce((a, b) => a + b) / 20;
      assert.ok(Math.abs(ta.stdev(bars.close, 20) - Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / 20)) < 1e-6);
      // Pivot high confirmed 3 bars later: above the 3 bars before it, not beaten by the 3 after, NaN otherwise
      const p = i - 3, v = bars.high[p];
      const isPivot = [1, 2, 3].every((k) => bars.high[p - k] < v && bars.high[p + k] <= v);
      const got = ta.pivothigh(bars.high, 3, 3);
      assert.equal(Number.isNaN(got) ? null : got, isPivot ? v : null);
    }
  });

  test('New York time, progress and a reason when nothing trades', async () => {
    const { runBacktest } = await load('/src/lib/backtest/engine.js');
    const bars = makeBars(Array.from({ length: 2500 }, () => 100));
    const seen = [];
    const r = runBacktest({ bars, startIndex: 0, simCode: 'if (ctx.i === 0) ctx.state.t = [ctx.hour, ctx.nyHour]; return null;', balance: 1, contractSize: 1, point: 1 }, (d, t) => seen.push([d, t]));
    for (const p of [[0, 2500], [1000, 2500], [2000, 2500]]) assert.ok(seen.some(([d, t]) => d === p[0] && t === p[1]), `no progress at ${p[0]}`);
    assert.match(r.log.at(-1).msg, /^No trades: the entry conditions never triggered in 2500 bars/);
    const counted = runBacktest({ bars, startIndex: 0, simCode: "ctx.count('in session'); if (ctx.i % 10 === 0) ctx.count('sweep'); return null;", balance: 1, contractSize: 1, point: 1 });
    assert.deepEqual(counted.counts, { 'in session': 2500, sweep: 250 });
    assert.equal(counted.log.at(-2).msg, 'Condition counts over 2,500 bars: in session 2,500, sweep 250');
    const bad = runBacktest({ bars, startIndex: 0, simCode: "return {action:'buy', lots:1, sl: 200, tp: 300};", balance: 1, contractSize: 1, point: 1 });
    assert.match(bad.log.at(-1).msg, /^No trades: all 2500 orders had the stop loss on the wrong side/);
    const { runBacktest: run2 } = await load('/src/lib/backtest/engine.js');
    const ny = run2({ bars, startIndex: 0, simCode: 'throw new Error(ctx.hour + "/" + ctx.nyHour);', balance: 1, contractSize: 1, point: 1 });
    assert.equal(ny.log[0].msg, 'Runtime error: 0/17'); // 00:00 server time is 17:00 the evening before in New York
  });

  test('the ICT rules used by the live check run without errors', async () => {
    const { runBacktest } = await load('/src/lib/backtest/engine.js');
    const { ICT_SIM_CODE } = await import('../support/ictSim.js');
    const closes = Array.from({ length: 20000 }, (_, i) => 2000 + 30 * Math.sin(i / 40) + 12 * Math.sin(i / 3.1) + ((i * 7919) % 13) - 6);
    const r = runBacktest({ bars: makeBars(closes), startIndex: 500, simCode: ICT_SIM_CODE, balance: 10000, contractSize: 100, point: 0.01 });
    assert.equal(r.errors, 0, r.log.find((l) => l.level === 'error')?.msg);
    assert.ok(r.counts['in session'] > 0);
  });

  test('incremental ICT-style code runs 50,000 bars in well under the limit', async () => {
    const { runBacktest } = await load('/src/lib/backtest/engine.js');
    const closes = Array.from({ length: 50000 }, (_, i) => 2000 + 30 * Math.sin(i / 40) + 8 * Math.sin(i / 5.3));
    const bars = makeBars(closes);
    // Swings from pivots, fair value gaps kept in a capped list, New York killzone, fixed work per bar
    const sim = `
      const s = ctx.state; s.fvg ||= []; const i = ctx.i;
      if (i < 3) return null;
      const ph = ctx.ta.pivothigh(ctx.high, 5, 5), pl = ctx.ta.pivotlow(ctx.low, 5, 5);
      if (!Number.isNaN(ph)) s.hi = ph;
      if (!Number.isNaN(pl)) s.lo = pl;
      if (ctx.low[i] > ctx.high[i - 2]) { s.fvg.push({ top: ctx.low[i], bot: ctx.high[i - 2] }); if (s.fvg.length > 50) s.fvg.shift(); }
      s.fvg = s.fvg.filter((g) => ctx.low[i] > g.bot);
      const kz = ctx.nyHour >= 8 && ctx.nyHour < 11;
      if (!ctx.position && kz && s.fvg.length && s.lo && ctx.close[i] > ctx.ta.ema(ctx.close, 50))
        return { action: 'buy', lots: 0.1, sl: Math.min(s.lo, ctx.low[i]) - 1, tp: ctx.close[i] + 2 * (ctx.close[i] - Math.min(s.lo, ctx.low[i]) + 1) };
      return null;`;
    const t0 = Date.now();
    const r = runBacktest({ bars, startIndex: 500, simCode: sim, balance: 10000, contractSize: 100, point: 0.01 });
    assert.equal(r.errors, 0);
    assert.ok(r.trades.length > 10, `${r.trades.length} trades`);
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
  });
});

describe('results', () => {
  const trades = [
    { side: 'long', entry: 100, exit: 110, sl0: 95, tp0: 110, lots: 1, pnl: 10, reason: 'tp', entryTime: T0, exitTime: T0 + H },
    { side: 'short', entry: 110, exit: 115, sl0: 115, tp0: 100, lots: 1, pnl: -5, reason: 'sl', entryTime: T0 + 2 * H, exitTime: T0 + 3 * H },
    { side: 'long', entry: 100, exit: 104, sl0: 95, tp0: 120, lots: 1, pnl: 4, reason: 'signal', entryTime: T0 + 4 * H, exitTime: T0 + 6 * H },
  ];

  test('signal test passes when BUY, SELL, CLOSE, TP and SL all fire', async () => {
    const { testSignals } = await load('/src/lib/backtest/signals.js');
    const { results, counts } = testSignals(trades);
    assert.deepEqual(counts, { BUY: 2, SELL: 1, CLOSE: 1, TP: 1, SL: 1 });
    assert.ok(results.every((r) => r.status === 'pass'), JSON.stringify(results));
    assert.equal(testSignals([]).results[0].status, 'fail');
  });

  test('metrics', async () => {
    const { computeMetrics, downsample } = await load('/src/lib/backtest/metrics.js');
    const equity = [{ t: T0, equity: 1000 }, { t: T0 + H, equity: 1010 }, { t: T0 + 3 * H, equity: 1005 }, { t: T0 + 6 * H, equity: 1009 }];
    const m = computeMetrics(trades, equity, 1000, 1);
    assert.equal(m.net, 9);
    assert.equal(m.trades, 3);
    assert.equal(Math.round(m.winRate), 67);
    assert.equal(m.profitFactor, 14 / 5);
    assert.equal(m.maxDD, 5);
    assert.equal(m.tpHits, 1);
    assert.equal(m.slHits, 1);
    assert.equal(m.avgR, (2 + -1 + 0.8) / 3);
    assert.equal(downsample(Array.from({ length: 2000 }, (_, i) => i), 100).length, 101);
  });

  test('Monte Carlo is reproducible and graded', async () => {
    const { runMonteCarlo } = await load('/src/lib/backtest/monteCarlo.js');
    const many = Array.from({ length: 60 }, (_, i) => ({ pnl: i % 3 ? 40 : -30 }));
    const a = runMonteCarlo(many, 10000);
    assert.deepEqual(a, runMonteCarlo(many, 10000));
    assert.equal(a.iterations, 1000);
    assert.ok(a.probProfit > 0.9);
    assert.match(a.grade, /^[A-F]$/);
    assert.equal(runMonteCarlo(many.slice(0, 4), 10000), null, 'needs 5+ trades');
  });

  test('unseen data windows', async () => {
    const { findUnseenWindow, customWindow, overlapsSeen } = await load('/src/lib/backtest/windows.js');
    const time = Array.from({ length: 48 }, (_, i) => T0 + i * H);
    const w = findUnseenWindow(time, [], 6 * H);
    assert.deepEqual(w, { from: 42, to: 47 }, "6 one-hour bars");
    const used = [{ start: time[42], end: time[47] }];
    assert.deepEqual(findUnseenWindow(time, used, 6 * H), { from: 36, to: 41 });
    assert.ok(overlapsSeen(time, w, used));
    assert.deepEqual(customWindow(time, '2026-01-05', '2026-01-05'), { from: 0, to: 23 });
  });
});

describe('data files', () => {
  test('parses MT5 and TradingView exports', async () => {
    const { parseCandles } = await load('/src/lib/backtest/data.js');
    const mt5 = parseCandles('<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2026.01.02\t01:00:00\t1\t2\t0.5\t1.5\t10\t0\t4\n');
    assert.equal(mt5.time[0], Date.UTC(2026, 0, 2, 1));
    assert.deepEqual([mt5.open[0], mt5.high[0], mt5.low[0], mt5.close[0], mt5.volume[0], mt5.spread[0]], [1, 2, 0.5, 1.5, 10, 4]);
    const tv = parseCandles('time,open,high,low,close,Volume\n1767225600,5,6,4,5.5,7\n2026-01-02T00:00:00Z,1,1,1,1,0');
    assert.equal(tv.time[0], 1767225600000);
    assert.equal(tv.time[1], Date.UTC(2026, 0, 2));
    assert.equal(tv.volume[0], 7);
  });

  test('market stats from candles', async () => {
    const { marketStats } = await load('/src/lib/backtest/marketStats.js');
    const s = marketStats(makeBars(Array.from({ length: 50 }, (_, i) => 100 + (i % 5))));
    assert.equal(s.bars, 50);
    assert.equal(s.avgBarRangeByServerHour.length, 24);
    assert.equal(marketStats(makeBars([1, 2, 3])), null);
  });
});

describe('prop firm (LucidPro)', () => {
  test('evaluation passes on the profit target, breaches on the max loss', async () => {
    const { simulateLucid } = await load('/src/lib/prop/lucidPro.js');
    const day = (k, pnl) => ({ pnl, lots: 1, mae: 0, exitTime: T0 + k * 24 * H });
    const s = { size: 50000, dllOn: true, lotsPerMini: 1 };
    const pass = simulateLucid([day(0, 1000), day(1, 1000), day(2, 1200), day(3, 500)], s, 1);
    assert.equal(pass.eval.status, 'passed');
    assert.equal(pass.eval.days, 3);
    assert.ok(pass.funded, 'funded stage runs after a pass');
    const breach = simulateLucid([day(0, -1100), day(1, -1100)], s, 1);
    assert.equal(breach.eval.status, 'breached');
  });

  test('Monte Carlo odds', async () => {
    const { lucidMonteCarlo } = await load('/src/lib/prop/lucidMonteCarlo.js');
    const days = Array.from({ length: 20 }, (_, k) => ({ pnl: k % 4 ? 600 : -300, lots: 1, mae: 0, exitTime: T0 + k * 24 * H }));
    const mc = lucidMonteCarlo(days, { size: 50000, dllOn: true, lotsPerMini: 1 }, 1, 200);
    assert.equal(mc.iterations, 200);
    assert.ok(mc.passRate > 0.5);
  });
});

describe('page helpers', () => {
  test('P&L calendar dates', async () => {
    const { weekStart, monthGrid, weeksOfYear, shiftMonth, viewRange, usd } = await load('/src/lib/pnl.js');
    assert.equal(weekStart(Date.UTC(2026, 9, 18)), '2026-10-12');
    const grid = monthGrid(2026, 9);
    assert.equal(grid[0][3], '2026-10-01');
    assert.ok(grid.every((w) => w.length === 7));
    assert.equal(weeksOfYear(2026)[0], '2026-01-05');
    assert.deepEqual(shiftMonth({ y: 2026, m: 0 }, -1), { y: 2025, m: 11 });
    assert.deepEqual(viewRange('day', { y: 2026, m: 11 }), { field: 'exit_day', from: '2026-12-01', to: '2027-01-01' });
    assert.equal(usd(-12.5), '-$12.5');
  });

  test('finds the newest full script in a chat reply', async () => {
    const { scriptFromMessage } = await load('/src/lib/chatScript.js');
    const msg = 'Short ```js\nx\n``` and the EA:\n```mql5\n// Script: Gold\n#property strict\nvoid OnTick(){}\n```';
    assert.deepEqual(scriptFromMessage(msg), { code: '// Script: Gold\n#property strict\nvoid OnTick(){}', language: 'MT5' });
    assert.equal(scriptFromMessage('```\n//@version=5\nstrategy("x")\n```').language, 'Pine');
    assert.equal(scriptFromMessage('no code'), null);
  });
});

describe('signals page', () => {
  test('positions follow buy, stop moves, limits, cancels and closes', async () => {
    const { positionsFrom, signalText } = await load('/src/lib/signals.js');
    let t = 0;
    const s = (event, extra) => ({ event, symbol: 'MNQ1!', strategy: 'DOL', created_date: new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(), ...extra });
    const list = [
      s('buy', { price: 100, sl: 90, tp: 120, qty: 2, trade_id: 'a' }),
      s('set_sl', { sl: 100, trade_id: 'a' }),
      s('sell_limit', { symbol: 'MGC1!', price: 2000, sl: 2010, tp: 1980, qty: 1, trade_id: 'b' }),
    ];
    let open = positionsFrom(list);
    assert.equal(open.length, 2);
    assert.deepEqual(open.find((p) => p.symbol === 'MNQ1!'), { ...open.find((p) => p.symbol === 'MNQ1!'), side: 'long', status: 'open', entry: 100, sl: 100, tp: 120 });
    assert.equal(open.find((p) => p.symbol === 'MGC1!').status, 'pending');
    list.push(s('close', { price: 120, reason: 'tp', trade_id: 'a' }), s('cancel', { symbol: 'MGC1!', trade_id: 'b' }));
    open = positionsFrom(list);
    assert.equal(open.length, 0);
    assert.equal(signalText(list[0]), 'BUY 2 MNQ1! @ 100 SL 90 TP 120');
    assert.equal(signalText(list[3]), 'CLOSE MNQ1! @ 120 (tp)');
  });
});
