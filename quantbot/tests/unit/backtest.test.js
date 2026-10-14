// Backtest engine, signal checks, metrics, Monte Carlo, prop-firm simulation and the page helpers.
// src/ uses Vite-style imports, so the modules are loaded through Vite.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite;
const load = (p) => vite.ssrLoadModule(p);
before(async () => { vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' }); });
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
