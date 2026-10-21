import test from 'node:test';
import assert from 'node:assert/strict';
import { runIndicator, UnsupportedPine, isMql5 } from '../../src/lib/indicators/pine.js';

const n = 300;
const close = Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 10) + i * 0.05);
const bars = { time: close.map((_, i) => Date.UTC(2026, 0, 1) + i * 900000), open: close.map((c) => c - 0.2), high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map(() => 100) };

test('SMA overlay matches a hand calculation', () => {
  const r = runIndicator(`//@version=5
indicator("My MA", overlay=true)
len = input.int(20, "Length")
ma = ta.sma(close, len)
plot(ma, "MA", color=color.orange, linewidth=2)`, bars);
  assert.equal(r.title, 'My MA'); assert.equal(r.overlay, true);
  const want = close.slice(n - 20).reduce((a, b) => a + b, 0) / 20;
  assert.ok(Math.abs(r.plots[0].values[n - 1] - want) < 1e-9);
  assert.equal(r.plots[0].color, '#ff9800'); assert.ok(Number.isNaN(r.plots[0].values[18]));
});

test('RSI with hlines, MACD tuple, wrapped lines, history, ternary', () => {
  const r = runIndicator(`indicator("Osc")
r = ta.rsi(close,
     14)
[m, s, h] = ta.macd(close, 12, 26, 9)
up = m > s ? 1 : 0
d = close - close[1]
plot(r)
plot(h, title="Hist")
hline(70)
hline(30)`, bars);
  const v = r.plots[0].values[n - 1];
  assert.ok(v > 0 && v < 100); assert.equal(r.overlay, false); assert.equal(r.hlines.length, 2); assert.equal(r.plots[1].name, 'Hist');
});

test('unsupported code and MQL5 ask for the rewrite', () => {
  assert.throws(() => runIndicator('indicator("x")\nfor i = 0 to 10\n    x = i\nplot(close)', bars), UnsupportedPine);
  assert.throws(() => runIndicator('#property indicator_chart_window\nint OnCalculate(){return 0;}', bars), UnsupportedPine);
  assert.ok(isMql5('int OnCalculate(const int rates_total) {}'));
});
