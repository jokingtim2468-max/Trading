// Account profiles, the safety guard and the payout audit
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { presetFor, safetyBlock, payoutAudit, accountId, findPreset } from '../../server/lib/fleetRules.js';
import { setFile } from '../../server/fleet.js';

const DAY = 86400000;

test('presets: the master spec numbers, ids and the MT5 set file', () => {
  const p = presetFor('Lucid Trading', 'LucidFlex', 100000);
  assert.deepEqual([p.risk_usd, p.tp_ratio, p.daily_profit_cap, p.daily_loss_floor, p.kill_switch_losses, p.buffer_usd], [300, 2, 2400, -800, 2, 2000]);
  assert.equal(presetFor('FTMO', 'Funded Account', 100000).buffer_usd, 2500);
  assert.equal(presetFor('The5ers', 'HyperGrowth', 100000), null, 'no numbers given for that one');
  assert.equal(accountId(p, ['LUCID-FLEX-100K-01']), 'LUCID-FLEX-100K-02');
  assert.match(setFile(p), /RiskUsd=300\r\nTpRatio=2\r\nDailyProfitCap=2400\r\nDailyLossFloor=-800\r\nMaxLosses=2\r\nStopFloor=1.5/);
});

test('safety guard: daily floor, profit cap and the 2-strike kill switch', () => {
  const a = { daily_floor: -200, daily_cap: 600, kill_losses: 2 };
  assert.equal(safetyBlock(a, [{ pnl: -75 }]), null);
  assert.match(safetyBlock(a, [{ pnl: -75 }, { pnl: -75 }]), /kill switch: 2 losing trades/);
  assert.match(safetyBlock(a, [{ pnl: -210 }]), /daily loss floor/);
  assert.match(safetyBlock(a, [{ pnl: 450 }, { pnl: 150 }]), /daily profit cap reached/);
});

test('payout audit: cycle, buffer, consistency, flat', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const a = { start_balance: 100000, balance: 106000, funded_at: new Date(now - 15 * DAY).toISOString(), payout_days: 14, buffer_usd: 2000, consistency: 40, day_zone: 'America/New_York' };
  const t = (pnl, d) => ({ status: 'closed', pnl, closed_at: new Date(now - d * DAY).toISOString(), opened_at: new Date(now - d * DAY).toISOString() });
  let r = payoutAudit(a, [t(1500, 10), t(1500, 9), t(1500, 8), t(1500, 7)], 0, now);
  assert.equal(r.ok, true);
  assert.deepEqual([r.withdraw, r.retain], [4000, 2000], '$100,000 account at $106,000 keeps $2,000 and withdraws $4,000');
  r = payoutAudit(a, [t(3600, 10), t(1200, 9), t(1200, 8)], 0, now);
  assert.equal(r.ok, false);
  assert.equal(r.needed, 3000, 'best day $3,600 is 60%; $3,000 more over other days brings it to 40%');
  assert.equal(payoutAudit({ ...a, funded_at: new Date(now - 5 * DAY).toISOString() }, [t(6000, 3)], 0, now).rules[0].ok, false, 'cycle not over');
  assert.equal(payoutAudit(a, [t(1500, 10), t(1500, 9), t(1500, 8), t(1500, 7)], 1, now).rules[3].ok, false, 'not flat');
  assert.equal(payoutAudit({ ...a, buffer_usd: null, balance: 102000 }, [t(2000, 9)], 0, now).withdraw, 0, 'under the 2.5% buffer, nothing');
});

let srv, base, dir;
before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-fleet-')); srv = await startServer({ port: 0, dataDir: dir, quiet: true }); base = `http://127.0.0.1:${srv.port}`; });
after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

test('deploy a profile, see it in the fleet, skip trades after the kill switch, audit and pause', async () => {
  let r = await (await post('/api/fleet/deploy', { preset_id: 'lucid-flex-25k', platform: 'TradingView' })).json();
  assert.equal(r.account.label, 'LUCID-FLEX-25K-01');
  assert.equal(r.account.risk_usd, 75);
  assert.equal(r.account.profile_name, '1m Exhaustion Pro (Flex 1:2.0)');
  assert.equal((await post('/api/fleet/deploy', { preset_id: 'lucid-flex-25k', platform: 'NinjaTrader' })).status, 400);
  const set = await (await fetch(base + r.set_file)).text();
  assert.match(set, /RiskUsd=75/);
  const fleet = await (await fetch(`${base}/api/fleet`)).json();
  assert.deepEqual(fleet.kpis, { active: 1, passed: 0, failed: 0, net: 0, week: 0, today: 0, week_trades: 0, week_wins: 0 });
  assert.equal(fleet.rows[0].firm, 'Lucid Trading');

  // Two losing trades today: the safety guard stops the next copy for the day
  const db = (...a) => srv.backend.handle('entity', ...a);
  const g = db('CopyGroup', 'create', { name: 'Flex', enabled: true, blackout: { news: false } });
  db('TradingAccount', 'update', r.account.id, { group_id: g.id });
  const now = new Date().toISOString();
  for (const pnl of [-75, -75]) db('AccountTrade', 'create', { account_id: r.account.id, status: 'closed', pnl, closed_at: now, opened_at: now });
  // The Terminal's rule guard refuses it up front; with the guard off, the copier's safety guard still skips it
  const res = await post('/api/terminal/order', { event: 'buy', group_id: g.id, symbol: 'XAUUSD', price: 4715, sl: 4710, qty: 1 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /LUCID-FLEX-25K-01: kill switch: 2 losing trades today/);
  const o = await (await post('/api/terminal/order', { event: 'buy', group_id: g.id, symbol: 'XAUUSD', price: 4715, sl: 4710, qty: 1, guard: false })).json();
  assert.equal(o.copied, 0);
  assert.match(o.reasons.join(' '), /kill switch: 2 losing trades today/);

  const audit = await (await post('/api/fleet/audit', { account_id: r.account.id })).json();
  assert.equal(audit.ok, false);
  await post('/api/fleet/pause', { account_id: r.account.id, paused: true });
  assert.equal((await (await fetch(`${base}/api/fleet`)).json()).kpis.active, 0);
  assert.equal((await post('/api/fleet/settings', { notify_url: 'http://evil.example' })).status, 400);
  assert.ok(findPreset('ftmo-eval-100k'));
});
