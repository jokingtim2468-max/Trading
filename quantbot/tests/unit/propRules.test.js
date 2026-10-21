import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateProp, firmsForSize, presetOf } from '../../src/lib/backtest/propRules.js';

const presets = JSON.parse(fs.readFileSync(new URL('../../server/presets/account_iterations_presets.json', import.meta.url)));
const DAY = 86400000, T0 = Date.UTC(2025, 0, 6, 12);
const trades = (pnls) => pnls.map((pnl, i) => ({ exitTime: T0 + Math.floor(i / 2) * DAY + (i % 2) * 3600000, pnl })); // 2 trades/day

test('the picker only offers firms and models that have the size', () => {
  const at10k = firmsForSize(presets, 10000);
  assert.deepEqual(Object.keys(at10k), ['FTMO'], 'only FTMO has a $10K account');
  const at25k = firmsForSize(presets, 25000);
  assert.ok(at25k['Lucid Trading'].includes('LucidFlex') && at25k['Lucid Trading'].includes('LucidPro'));
  assert.ok(!firmsForSize(presets, 150000)['Lucid Trading'].includes('LucidPro'), 'no LucidPro 150K');
});

test('FTMO 10K: passes at the $1,000 target', () => {
  const r = evaluateProp(trades([200, 150, 300, 200, 250]), presetOf(presets, 'FTMO', 'Evaluation (2-Step)', 10000));
  assert.equal(r.status, 'passed');
  assert.match(r.reason, /target/);
});

test('FTMO 10K: fails on the $500 daily loss limit', () => {
  const r = evaluateProp(trades([100, 50, -300, -250]), presetOf(presets, 'FTMO', 'Evaluation (2-Step)', 10000));
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /daily loss/);
});

test('Lucid Flex 25K: the end-of-day trailing floor follows profits up', () => {
  // +900 over the first days lifts the floor from 24,000 toward 25,100; then a -1,000 slide fails it
  const r = evaluateProp(trades([300, 300, 300, 0, -400, -400, -400, 0]), presetOf(presets, 'Lucid Trading', 'LucidFlex', 25000));
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /trailing floor/);
});

test('consistency: a target hit by one huge day must be diluted first', () => {
  // Lucid Flex 25K, 50% consistency: +1,300 in one day is 100% of profit -> not passed yet
  const r = evaluateProp(trades([700, 600]), presetOf(presets, 'Lucid Trading', 'LucidFlex', 25000));
  assert.equal(r.status, 'in progress');
  assert.match(r.reason, /consistency/);
});
