import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateProp, firmsForSize, presetOf, withDailyLimit } from '../../src/lib/backtest/propRules.js';

const presets = JSON.parse(fs.readFileSync(new URL('../../server/presets/account_iterations_presets.json', import.meta.url)));
const DAY = 86400000, T0 = Date.UTC(2025, 0, 6, 12);
const trades = (pnls) => pnls.map((pnl, i) => ({ exitTime: T0 + Math.floor(i / 2) * DAY + (i % 2) * 3600000, pnl })); // 2 trades/day

test('the picker only offers firms and models that have the size', () => {
  const at10k = firmsForSize(presets, 10000);
  assert.deepEqual(Object.keys(at10k).sort(), ['Alpha Capital', 'FTMO', 'FTMO US (OANDA)', 'The5ers'], 'Lucid has no $10K account');
  assert.ok(firmsForSize(presets, 150000)['Lucid Trading'].includes('LucidPro'), 'Lucid offers a 150K Pro');
  assert.ok(!firmsForSize(presets, 150000).FTMO, 'FTMO has no 150K');
  const at25k = firmsForSize(presets, 25000);
  assert.ok(at25k['Lucid Trading'].includes('LucidFlex') && at25k['Lucid Trading'].includes('LucidPro'));
});

test('FTMO 10K: the $1,000 target passes only after 4 trading days', () => {
  const ftmo = presetOf(presets, 'FTMO', 'Evaluation (2-Step)', 10000);
  const early = evaluateProp(trades([400, 300, 200, 200]), ftmo); // target on day 2
  assert.equal(early.status, 'in progress');
  assert.match(early.reason, /2 of 4 trading days/);
  const r = evaluateProp(trades([400, 300, 200, 200, 50, 0, 50, 0]), ftmo); // 4 days
  assert.equal(r.status, 'passed');
  assert.match(r.reason, /target/);
});

test('The5ers needs 3 profitable days (0.5%+ of the start)', () => {
  const t5 = presetOf(presets, 'The5ers', 'High Stakes Step 1', 10000);
  const r = evaluateProp(trades([600, 500, 10, 0]), t5); // $1,100 in one day + a $10 day: 1 profitable day
  assert.equal(r.status, 'in progress');
  assert.match(r.reason, /1 of 3 profitable days/);
});

test('FTMO 10K: fails on the $500 daily loss limit', () => {
  const r = evaluateProp(trades([100, 50, -300, -250]), presetOf(presets, 'FTMO', 'Evaluation (2-Step)', 10000));
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /daily loss/);
});

test('Lucid Flex 25K: the end-of-day trailing floor follows profits up', () => {
  // +900 over the first days lifts the floor from 24,000 toward 25,100; then a -1,000 slide fails it
  const flex = presetOf(presets, 'Lucid Trading', 'LucidFlex', 25000);
  // Bought without the optional daily loss limit: only the trailing floor applies
  const r = evaluateProp(trades([300, 300, 300, 0, -400, -400, -400, 0]), withDailyLimit(flex, false));
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /trailing floor/);
  // With the daily loss limit on ($600), the -$800 day fails it first
  const on = evaluateProp(trades([300, 300, 300, 0, -400, -400, -400, 0]), withDailyLimit(flex, true));
  assert.match(on.reason, /daily loss limit/);
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
  // FTMO 1-Step: 3% daily, and the max loss trails the best midnight balance with no lock
  const one = presetOf(presets, 'FTMO', '1-Step Challenge', 100000);
  assert.equal(simAccount(one, [{ exitTime: now - 3 * DAY, pnl: 5000 }], 0, now).floor, 95000, 'peak 105,000 - 10,000, never locked');
  assert.equal(simAccount(one, [], -3000, now).status, 'failed', '3% daily on $100K');
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
