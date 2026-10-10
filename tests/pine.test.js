import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePine } from '../src/pine.js';
import { sma, rsi } from '../src/indicators.js';

const close = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
const bars = { open: close, high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map(() => 1000) };

test('sma basic', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2).slice(1), [1.5, 2.5, 3.5]);
});

test('pine plots sma with input', () => {
  const r = compilePine(`//@version=5
indicator("My MA", overlay=true)
len = input.int(10, "Length")
plot(ta.sma(close, len), "MA", color=color.red)`, bars);
  assert.equal(r.title, 'My MA');
  assert.equal(r.overlay, true);
  assert.equal(r.plots[0].color, '#F23645');
  assert.deepEqual(r.plots[0].data, sma(close, 10));
});

test('pine tuple destructuring, history and crossover', () => {
  const r = compilePine(`indicator("MACD")
[m, s, h] = ta.macd(close, 12, 26, 9)
plot(m)
plot(close - close[1], "diff")
x = ta.crossover(m, s)
plotshape(x, location=location.belowbar)
hline(0)`, bars);
  assert.equal(r.plots.length, 2);
  assert.ok(Number.isNaN(r.plots[1].data[0]));
  assert.equal(r.hlines[0].price, 0);
});

test('pine rsi matches', () => {
  const r = compilePine('indicator("R")\nplot(ta.rsi(close, 14))', bars);
  assert.deepEqual(r.plots[0].data, rsi(close, 14));
});

test('input overrides', () => {
  const r = compilePine('indicator("x")\nl = input(5, "L")\nplot(ta.sma(close, l))', bars, { L: 3 });
  assert.deepEqual(r.plots[0].data, sma(close, 3));
});

test('bridge exposes no order endpoints', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../bridge/mt5_bridge.py', import.meta.url), 'utf8');
  assert.ok(!/order_send|order_check|post_order|post_close/.test(src));
});

test('quote parts emphasise pips', async () => {
  const { quoteParts } = await import('../src/chartpane.js').catch(() => ({}));
  if (!quoteParts) return; // chartpane imports the chart lib (browser-only)
  assert.deepEqual(quoteParts(2730.63, 2), { small: '2730.', big: '63', sup: '' });
  assert.deepEqual(quoteParts(1.08453, 5), { small: '1.08', big: '45', sup: '3' });
});
