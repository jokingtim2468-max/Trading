import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantFeatures, featureVector } from '../../src/lib/quant/features.js';

// Build a synthetic M5 series: a gentle uptrend with intraday range, so the stats have known signs.
function makeBars(n = 1000) {
  const time = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n);
  let p = 2000;
  const t0 = Date.UTC(2025, 0, 6, 0, 0, 0); // a Monday
  for (let i = 0; i < n; i++) {
    const drift = 0.02, wiggle = Math.sin(i / 7) * 1.5;
    open[i] = p; close[i] = p + drift + wiggle * 0.1; high[i] = Math.max(open[i], close[i]) + 1.2; low[i] = Math.min(open[i], close[i]) - 1.2;
    time[i] = t0 + i * 5 * 60000; p = close[i];
  }
  return { time, open, high, low, close };
}

test('quantFeatures returns a full pack with sane shapes', () => {
  const f = quantFeatures(makeBars());
  assert.ok(f && f.meta.bars === 1000);
  assert.equal(f.returns.hist.length, 21);
  assert.equal(f.volatility.byHour.length, 24);
  assert.equal(f.volatility.byWeekday.length, 7);
  assert.equal(f.autocorr.length, 5);
  assert.ok(f.structure.breakoutRatePct >= 0 && f.structure.breakoutRatePct <= 100);
  assert.ok(f.returns.upRatePct > 50, 'an uptrend should have >50% up bars');
});

test('too few bars returns null', () => {
  assert.equal(quantFeatures({ time: [1, 2, 3], open: [1, 1, 1], high: [1, 1, 1], low: [1, 1, 1], close: [1, 1, 1] }), null);
});

test('featureVector flattens the pack into a numeric row for ML', () => {
  const v = featureVector(quantFeatures(makeBars()));
  assert.ok(typeof v.ret_mean === 'number' && typeof v.momentum_bias === 'number');
  assert.ok('autocorr_1' in v && 'range_h0' in v);
});
