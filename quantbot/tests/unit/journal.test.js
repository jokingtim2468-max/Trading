import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, stats, bySetup, rOf } from '../../src/lib/journal.js';

test('reads an MT5 positions export (repeated Time / Price columns, fees in)', () => {
  const tsv = 'Time\tPosition\tSymbol\tType\tVolume\tPrice\tS / L\tT / P\tTime\tPrice\tCommission\tSwap\tProfit\n'
    + '2026.10.14 09:30:05\t5501\tXAUUSD\tbuy\t0.50\t4715.20\t4705\t4740\t2026.10.14 11:02:44\t4731.00\t-3.50\t0\t790.00\n'
    + '2026.10.15 14:00:00\t5502\tUS100\tsell\t2\t20100\t\t\t2026.10.15 14:20:00\t20150\t0\t0\t-100.00\n'
    + 'Balance\t\t\t\t\t\t\t\t\t\t\t\t\n';
  const r = parseHistory(tsv);
  assert.equal(r.trades.length, 2);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.trades[0], { symbol: 'XAUUSD', side: 'long', qty: 0.5, entry: 4715.2, exit: 4731, entry_time: '2026-10-14T09:30:05.000Z', exit_time: '2026-10-14T11:02:44.000Z', pnl: 786.5, fees: -3.5 });
  assert.equal(r.trades[1].side, 'short');
});

test('reads a generic CSV with quoted thousands', () => {
  const csv = 'symbol,side,qty,open time,open price,close time,close price,pnl\nNQ,Long,1,2026-10-01T14:30:00Z,"20,100.25",2026-10-01T15:00:00Z,"20,110.25","1,000.50"\n';
  const t = parseHistory(csv).trades[0];
  assert.equal(t.entry, 20100.25);
  assert.equal(t.pnl, 1000.5);
});

test('stats and R per setup', () => {
  const list = [{ pnl: 200, risk_open: 100, setup: 'Breakout' }, { pnl: -100, risk_open: 100, setup: 'Breakout' }, { pnl: 50, setup: '' }];
  assert.equal(rOf(list[0]), 2);
  assert.deepEqual(stats(list), { trades: 3, wins: 2, winRate: 67, net: 150, pf: 2.5, avgR: 0.5 });
  assert.deepEqual(bySetup(list).map((s) => [s.setup, s.trades, s.avgR]), [['Breakout', 2, 0.5], ['No setup', 1, null]]);
});

import { mergeCandles, stepPractice } from '../../src/lib/terminalLive.js';

test('live minute candles fold into the last bar or start a new one', () => {
  const M15 = 15 * 60000;
  const bars = { time: [0, M15], open: [1, 2], high: [3, 4], low: [0, 1], close: [2, 3] };
  const out = mergeCandles(bars, [{ time: M15 + 60000, open: 3, high: 6, low: 2, close: 5 }, { time: 2 * M15, open: 5, high: 5.5, low: 4.5, close: 5.2 }], M15);
  assert.deepEqual(out.time, [0, M15, 2 * M15]);
  assert.deepEqual([out.high[1], out.low[1], out.close[1]], [6, 1, 5]);
  assert.equal(mergeCandles(bars, [{ time: 0, open: 1, high: 1, low: 1, close: 1 }].slice(1), M15), bars);
});

test('replay: the stop is checked before the target, trailing only tightens', () => {
  const t = { side: 'long', entry: 100, qty: 1, point_value: 100, sl: 95, tp: 110 };
  assert.equal(stepPractice([t], { high: 111, low: 94, close: 100 }).closed[0].pnl, -500, 'both in one bar: the stop');
  assert.equal(stepPractice([t], { high: 111, low: 99, close: 108 }).closed[0].reason, 'target');
  const tr = stepPractice([{ ...t, tp: null, trail: 3 }], { high: 106, low: 101, close: 105 }).open[0];
  assert.equal(tr.sl, 102);
  assert.equal(stepPractice([tr], { high: 104, low: 102.5, close: 103 }).open[0].sl, 102);
});
