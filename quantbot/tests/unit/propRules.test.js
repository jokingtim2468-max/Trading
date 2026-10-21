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

test('simAccount: floating losses count toward the floor and the daily limit, like the firms', async () => {
  const { simAccount } = await import('../../src/lib/backtest/propRules.js');
  const ftmo = presetOf(presets, 'FTMO', 'Evaluation (2-Step)', 10000);
  const now = T0;
  const ok = simAccount(ftmo, [{ exitTime: now - 3600000, pnl: -200 }], -100, now);
  assert.equal(ok.status, 'active');
  assert.equal(ok.dailyLeft, 200, '$500 limit - $200 closed - $100 floating');
  const dll = simAccount(ftmo, [{ exitTime: now - 3600000, pnl: -200 }], -320, now);
  assert.equal(dll.status, 'failed');
  assert.match(dll.reason, /daily loss/);
  // Lucid Flex 25K: the floor trails yesterday's close and stops at start + $100
  const flex = presetOf(presets, 'Lucid Trading', 'LucidFlex', 25000);
  const s = simAccount(flex, [{ exitTime: now - 2 * DAY, pnl: 900 }], 0, now);
  assert.equal(s.floor, 24900, 'peak 25,900 - 1,000');
  const s2 = simAccount(flex, [{ exitTime: now - 2 * DAY, pnl: 1500 }], 0, now);
  assert.equal(s2.floor, 25100, 'locked at start + $100');
});

test('rankAccounts: earliest pass is best, then survivors, then in progress, failed last', async () => {
  const { rankAccounts } = await import('../../src/lib/backtest/propRules.js');
  const r = rankAccounts([
    { firm: 'A', status: 'failed', date: '2026-02-01', size: 10000, finalBalance: 9000, tradingDays: 3 },
    { firm: 'B', status: 'passed', date: '2026-03-10', size: 25000, finalBalance: 26300, tradingDays: 9 },
    { firm: 'C', status: 'in progress', size: 50000, target: 3000, finalBalance: 52000, tradingDays: 20 },
    { firm: 'D', status: 'passed', date: '2026-02-20', size: 10000, finalBalance: 11000, tradingDays: 6 },
    { firm: 'E', status: 'failed', date: '2026-04-01', size: 100000, finalBalance: 90000, tradingDays: 30 },
  ]);
  assert.deepEqual(r.map((x) => x.firm), ['D', 'B', 'C', 'E', 'A']);
});
