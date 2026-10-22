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

test('replay forms the current candle up to the clock', async () => {
  const { replayBars, pathPrice } = await import('../../src/lib/terminalLive.js');
  assert.equal(pathPrice(10, 14, 8, 12, 0), 10); assert.equal(pathPrice(10, 14, 8, 12, 1), 12);
  const H = 3600000, b = { time: [0, H, 2 * H], open: [10, 12, 13], high: [14, 15, 16], low: [8, 11, 12], close: [12, 13, 15] };
  const half = replayBars(b, null, H, H + H / 2);
  assert.equal(half.time.length, 2); assert.equal(half.open[1], 12); assert.ok(half.high[1] <= 15 && half.low[1] >= 11);
  const end = replayBars(b, null, H, 2 * H - 1);
  assert.ok(Math.abs(end.close[1] - 13) < 0.2);
});

test('training gets example scripts: the shipped strategies plus the trader\'s scripts that passed the bar', async () => {
  const { scriptExamples } = await import('../../server/train.js');
  const ex = scriptExamples([{ name: 'Good Bot', target: 'Pine', symbol: 'XAUUSD', code: '//@version=5\n' + 'x'.repeat(300), pf: 1.6, dd: 6.2, trades: 80, summary: 'London breakout' }]);
  assert.ok(ex.some((e) => /Pine Script/.test(e.prompt) && /@version/.test(e.answer)), 'shipped Pine strategies');
  assert.ok(ex.some((e) => /MQL5 Expert Advisor/.test(e.prompt) && /OnTick/.test(e.answer)), 'shipped MQL5 EAs');
  assert.ok(ex.some((e) => /"Good Bot".*PF 1\.6, max drawdown 6\.2% over 80 trades/.test(e.prompt)), "the trader's good script");
});

test('risk share: a quarter of the smaller limit sizes the trade', async () => {
  const { ruleRisk, copyQty } = await import('../../server/lib/copyRules.js');
  const a = { platform: 'MT5', daily_loss: 500, max_loss: 1000, risk_share: 0.25 };
  assert.equal(ruleRisk(a), 125);
  const q = copyQty(a, { price: 2000, sl: 1995, qty: 1 }, 100);
  assert.equal(q.risk, 125); assert.equal(q.qty, 0.25, '$125 / ($5 stop x $100 per $1) = 0.25 lots');
  assert.equal(copyQty({ ...a, risk_usd: 50 }, { price: 2000, sl: 1995 }, 100).risk, 50, 'a fixed $ risk wins');
});

test('model track record: past predictions against the real day and the simple guess', async () => {
  const { trackRecord } = await import('../../src/lib/terminalLive.js');
  const n = 30, D = 86400000, t0 = Date.UTC(2026, 0, 1);
  const daily = { time: Array.from({ length: n }, (_, i) => t0 + i * D), open: Array(n).fill(100), high: Array(n).fill(102), low: Array(n).fill(98) };
  const day = (i) => new Date(t0 + i * D).toISOString().slice(0, 10);
  const r = trackRecord([{ symbol: 'X', day: day(25), high: 102, low: 98 }, { symbol: 'X', day: day(26), high: 103, low: 97 }, { symbol: 'X', day: day(29), high: 1, low: 1 }, { symbol: 'Y', day: day(25), high: 1, low: 1 }], daily, 'X');
  assert.equal(r.days, 2, "today and other symbols don't count");
  assert.equal(r.rows[0].model, 0); assert.equal(r.highHit, 50); assert.equal(r.lowHit, 50);
  assert.equal(r.guessErr, 0, 'guess = open +/- half the 4% average range = the real 102 / 98');
});
