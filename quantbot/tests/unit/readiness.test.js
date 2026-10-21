import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployReadiness, readinessLine } from '../../src/lib/quant/readiness.js';

const mk = (pf, ddPct, net, trades, oosHolds, consistencyPct = 80) => ({
  metrics: { profitFactor: pf, maxDDPct: ddPct, net, trades },
  robust: { enough: trades >= 20, oosHolds, consistencyPct, oos: { net: oosHolds ? 500 : -100, pf: oosHolds ? 1.4 : 0.8 } },
});

test('a robust, profitable, OOS-holding script PASSES', () => {
  const rd = deployReadiness({ results: [mk(1.5, 8, 4000, 150, true)], mc: { score: 75 } });
  assert.equal(rd.pass, true);
  assert.equal(rd.grade, 'PASS');
  assert.match(readinessLine(rd), /PASS/);
});

test('a script that fails out-of-sample is blocked (FAIL)', () => {
  const rd = deployReadiness({ results: [mk(1.8, 7, 5000, 150, false)] });
  assert.equal(rd.pass, false);
  assert.equal(rd.grade, 'FAIL');
  assert.ok(rd.reasons.some((x) => /out-of-sample/i.test(x)));
});

test('drawdown over the account limit fails', () => {
  const rd = deployReadiness({ results: [mk(1.4, 30, 3000, 150, true)], maxDDLimitPct: 20 });
  assert.equal(rd.pass, false);
  assert.ok(rd.reasons.some((x) => /Drawdown/i.test(x)));
});

test('thin trade count or soft PF is CAUTION, not FAIL', () => {
  const rd = deployReadiness({ results: [mk(1.2, 9, 800, 45, true)] });
  assert.equal(rd.pass, true);
  assert.equal(rd.grade, 'CAUTION');
});

test('no result is FAIL', () => {
  assert.equal(deployReadiness({ results: [] }).grade, 'FAIL');
});
