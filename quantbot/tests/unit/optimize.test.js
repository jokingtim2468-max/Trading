import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInputs, applyInputs, trialSets, optimizeScript } from '../../src/lib/quant/optimize.js';

const PINE = `//@version=5
strategy("x")
float riskPerTrade = input.float(75.0, "Risk ($)")
float tpRatio      = input.float(2.0, "TP Ratio", step=0.1)
int   atrPeriod    = input.int(14, "ATR Period")
float stopFloor    = input.float(1.5, "Stop Floor")
`;
const MQL = `input double RiskUsd = 75.0; // risk
input double TpRatio = 2.0;  // tp
input int    MaxLosses = 2;  // kill
input double StopFloor = 1.5; // stop`;

test('parseInputs finds numbers and flags only signal/exit knobs as tunable', () => {
  const p = parseInputs(PINE, 'Pine');
  const byName = Object.fromEntries(p.map((x) => [x.name, x]));
  assert.equal(byName.tpRatio.tunable, true);
  assert.equal(byName.atrPeriod.tunable, true);
  assert.equal(byName.stopFloor.tunable, true);
  assert.equal(byName.riskPerTrade.tunable, false, 'risk/size is not an edge knob');
});

test('parseInputs handles MQL5 and skips non-edge inputs', () => {
  const p = parseInputs(MQL, 'MT5');
  const byName = Object.fromEntries(p.map((x) => [x.name, x]));
  assert.equal(byName.TpRatio.tunable, true);
  assert.equal(byName.RiskUsd.tunable, false);
  assert.equal(byName.MaxLosses.tunable, false);
});

test('applyInputs patches only the named default', () => {
  const out = applyInputs(PINE, 'Pine', { tpRatio: 3.0 });
  assert.match(out, /tpRatio\s*=\s*input\.float\(3\b/);
  assert.match(out, /riskPerTrade\s*=\s*input\.float\(75/); // untouched
});

test('trialSets perturbs tunables and stays within the cap', () => {
  const sets = trialSets(parseInputs(PINE, 'Pine'), 5);
  assert.ok(sets.length > 0 && sets.length <= 5);
  assert.ok(sets.every((s) => Object.keys(s).every((k) => ['tpRatio', 'atrPeriod', 'stopFloor'].includes(k))));
});

test('optimizeScript keeps the variant with the best out-of-sample score', async () => {
  // Fake backtest: tpRatio=3.0 is the robust winner, everything else is mediocre.
  const backtest = async (code) => {
    const win = /tpRatio\s*=\s*input\.float\(2\.8\b/.test(code);
    const robust = win ? { enough: true, score: 0.95, oosHolds: true, oos: { net: 800, pf: 1.5 } } : { enough: true, score: 0.3, oosHolds: false, oos: { net: -100, pf: 0.9 } };
    return { results: [{ metrics: { profitFactor: win ? 1.6 : 1.1, maxDDPct: 8, net: win ? 2000 : 200, trades: 100 }, robust }], errors: [] };
  };
  const r = await optimizeScript({ code: PINE, language: 'Pine', trials: 6, backtest });
  assert.ok(r.improved, 'should find a better variant');
  assert.equal(r.best.oosHolds, true);
  assert.match(r.best.code, /tpRatio\s*=\s*input\.float\(2\.8\b/);
});
