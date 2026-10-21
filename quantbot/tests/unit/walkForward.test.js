import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkForward, robustnessVerdict } from '../../src/lib/backtest/walkForward.js';

const DAY = 86400000;
// n trades spread evenly over `spanDays`, each with pnl from fn(i)
const series = (n, spanDays, fn) => Array.from({ length: n }, (_, i) => ({ exitTime: Date.UTC(2024, 0, 1) + (i / n) * spanDays * DAY, pnl: fn(i, n) }));

test('a consistently profitable strategy is robust and holds out-of-sample', () => {
  const wf = walkForward(series(200, 400, () => 10), { windows: 4 });
  assert.ok(wf.enough);
  assert.equal(wf.profitableWindows, 4);
  assert.ok(wf.oosHolds);
  assert.ok(wf.score > 0.9);
  assert.match(robustnessVerdict(wf), /robust/);
});

test('a strategy that only won early is caught as overfit (loses out-of-sample)', () => {
  // big wins in the first 60% of time, losses after -> OOS should fail
  const wf = walkForward(series(200, 400, (i, n) => (i < n * 0.6 ? 20 : -15)), { windows: 5 });
  assert.ok(!wf.oosHolds, 'OOS must not hold');
  assert.ok(wf.oos.net < 0);
  assert.ok(wf.score < 0.6);
  assert.match(robustnessVerdict(wf), /overfit|weak/);
});

test('too few trades returns enough:false, score 0', () => {
  const wf = walkForward(series(8, 100, () => 5), { windows: 4 });
  assert.equal(wf.enough, false);
  assert.equal(wf.score, 0);
  assert.match(robustnessVerdict(wf), /not enough/);
});
