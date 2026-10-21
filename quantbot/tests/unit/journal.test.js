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

import { zonedUtc, sessionBoxes } from '../../src/lib/terminalLive.js';

test('session times follow each city\'s daylight saving', () => {
  assert.equal(new Date(zonedUtc('2026-07-15', 9, 30, 'America/New_York')).toISOString(), '2026-07-15T13:30:00.000Z');
  assert.equal(new Date(zonedUtc('2026-01-15', 9, 30, 'America/New_York')).toISOString(), '2026-01-15T14:30:00.000Z');
  assert.equal(new Date(zonedUtc('2026-07-15', 8, 0, 'Europe/London')).toISOString(), '2026-07-15T07:00:00.000Z');
  assert.equal(new Date(zonedUtc('2026-07-15', 9, 0, 'Asia/Tokyo')).toISOString(), '2026-07-15T00:00:00.000Z');
  const b = sessionBoxes(Date.parse('2026-10-16T00:00:00Z'), Date.parse('2026-10-18T23:00:00Z'));
  assert.deepEqual([...new Set(b.map((x) => new Date(x.from).toISOString().slice(0, 10)))], ['2026-10-16', '2026-10-19'], 'no weekend sessions');
});

import { weekStart, weekly, scorecard } from '../../src/lib/journal.js';

test('weekly report and the model scorecard', () => {
  const w = weekStart('2026-10-14T12:00:00Z');
  assert.equal(new Date(w).toISOString(), '2026-10-12T00:00:00.000Z');
  const list = [{ pnl: 300, exit_time: '2026-10-13T10:00:00Z', setup: 'Breakout' }, { pnl: -100, exit_time: '2026-10-14T10:00:00Z', setup: 'Range' }, { pnl: 50, exit_time: '2026-10-20T10:00:00Z' }];
  const r = weekly(list, w, [{ kind: 'block', created_date: '2026-10-13T09:00:00Z' }, { kind: 'open', created_date: '2026-10-13T09:00:00Z' }]);
  assert.deepEqual([r.trades, r.net, r.bestSetup.setup, r.worstSetup.setup, r.bestDay.day, r.blocks], [2, 200, 'Breakout', 'Range', '2026-10-13', 1]);
  const s = scorecard([{ day: '2026-10-13', high: 4740, low: 4690, confidence: 80 }, { day: '2026-10-14', high: 4760, low: 4700, confidence: 40 }],
    [{ day: '2026-10-13', high: 4745, low: 4688 }, { day: '2026-10-14', high: 4720, low: 4650 }]);
  assert.deepEqual([s.days, s.hitRate, s.rows[0].hit, s.rows[1].hit, s.buckets[2].hitRate, s.buckets[0].hitRate], [2, 50, true, false, 100, 0]);
});

import { parseCommand } from '../../src/lib/agents/parse.js';
import { reportText } from '../../src/lib/agents/report.js';

test('agent replies: one command, even with chatter or backticks around it', () => {
  assert.deepEqual(parseCommand('LIST data'), { cmd: 'LIST', arg: 'data' });
  assert.deepEqual(parseCommand('Let me look.\n`READ data/XAUUSD_M15.stats.json`'), { cmd: 'READ', arg: 'data/XAUUSD_M15.stats.json' });
  const w = parseCommand('WRITE scripts/a.mq5\n```mql5\n#include <Trade/Trade.mqh>\nint OnInit(){return 0;}\n```\n');
  assert.equal(w.cmd, 'WRITE');
  assert.equal(w.arg, 'scripts/a.mq5');
  assert.match(w.code, /^#include <Trade\/Trade.mqh>\nint OnInit/);
  assert.equal(parseCommand('WRITE scripts/a.mq5\nno code').code, null);
  assert.deepEqual(parseCommand('DONE PF 1.4\nall markets ok'), { cmd: 'DONE', arg: 'PF 1.4\nall markets ok' });
  assert.equal(parseCommand('I think we should trade gold.'), null);
  const r = reportText('a', [{ symbol: 'XAUUSD', timeframe: 'M15', from: '2026-01-01', to: '2026-06-01', metrics: { net: 500, returnPct: 5, trades: 40, longs: 20, shorts: 20, winRate: 45, profitFactor: 1.5, maxDD: 300, maxDDPct: 3, avgR: 0.3, expectancy: 12.5, slHits: 22, tpHits: 18, maxLossStreak: 4 } }]);
  assert.match(r, /TOTAL net 500.00 over 40 trades on 1 market\(s\)\. Target .*: MET\./);
});
