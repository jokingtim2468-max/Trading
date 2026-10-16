// Copy trading: XP and ranks, account plans, and script signals copied to every account in a group
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipher } from '../../server/crypto.js';
import { createBackend, entityDefaults } from '../../server/backend.js';
import { createCopier, orderMessage } from '../../server/copier.js';
import { createChatTools } from '../../server/lib/chatTools.js';
import { createScriptFolders, codeFromReply, slug } from '../../server/scriptFolders.js';
import { startServer } from '../../server/index.js';
import {
  xpForTrade, levelFromXp, tierOf, pointValue, randomName, applyClose, nyDay, evaluate, PLANS, ACCOUNT_STEP, SCRIPT_STEP,
} from '../../server/lib/copyRules.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-copy-'));

function dbIn(dir) {
  const c = createCipher(dir);
  const be = createBackend({ dataDir: dir, encrypt: c.encrypt, decrypt: c.decrypt, userName: 'Copy', defaults: entityDefaults(path.resolve('server/entities')) });
  return { run: async (...a) => be.handle('entity', ...a), sync: { run: (...a) => be.handle('entity', ...a) } };
}

const lucid50 = (extra = {}) => {
  const p = PLANS.lucid50;
  return { platform: 'TradingView', plan: 'lucid50', start_balance: p.start, balance: p.start, target: p.target, max_loss: p.maxLoss, trailing: p.trailing, risk_usd: 300, ...extra };
};

describe('copy trading rules', () => {
  test('XP per closed trade by its profit', () => {
    assert.deepEqual([-250, 0, 5, 5.01, 10, 20, 20.5, 900].map(xpForTrade), [10, 10, 10, 20, 20, 30, 50, 50]);
  });

  test('ranks: accounts need 100, then 200, 300 ...; scripts 1000, 2000 ...', () => {
    assert.deepEqual([0, 99, 100, 299, 300, 600, 1000].map((xp) => levelFromXp(xp, ACCOUNT_STEP).level), [0, 0, 1, 1, 2, 3, 4]);
    assert.deepEqual(levelFromXp(150, ACCOUNT_STEP), { level: 1, into: 50, need: 200, progress: 0.25 });
    assert.equal(levelFromXp(3000, SCRIPT_STEP).level, 2);
    assert.equal(tierOf(0).name, 'Unranked');
    assert.deepEqual([1, 3, 4, 12, 21].map((l) => `${tierOf(l).name} ${tierOf(l).division}`), ['Iron I', 'Iron III', 'Bronze I', 'Gold III', 'Master III']);
    assert.equal(`${tierOf(25).name} ${tierOf(25).division}`, 'Legend 4');
  });

  test('evaluation of closed trades', () => {
    const t = (pnl, closed, extra = {}) => ({ status: 'closed', pnl, side: 'long', opened_at: '2026-03-02T14:00:00Z', closed_at: closed, reason: pnl > 0 ? 'tp' : 'sl', xp: xpForTrade(pnl), ...extra });
    const e = evaluate([t(300, '2026-03-02T15:00:00Z'), t(-200, '2026-03-03T15:00:00Z'), t(-100, '2026-03-04T15:00:00Z'), t(500, '2026-03-05T15:00:00Z', { side: 'short' }), { status: 'open', pnl: 0 }]);
    assert.deepEqual([e.trades, e.open, e.wins, e.losses, e.net, e.avgWin, e.avgLoss, e.maxDrawdown, e.best, e.worst, e.longs, e.shorts], [4, 1, 2, 2, 500, 400, -150, 300, 500, -200, 3, 1]);
    assert.equal(e.profitFactor, 800 / 300);
    assert.equal(e.expectancy, 125);
    assert.deepEqual(e.reasons, { tp: 2, sl: 2 });
    assert.equal(e.xp, 120);
  });

  test('contract sizes and names', () => {
    assert.deepEqual(['MGC1!', 'COMEX:GC1!', 'MNQZ2026', 'ES1!', 'OANDA:XAUUSD', 'US100', 'EURUSD'].map(pointValue), [10, 100, 2, 50, 100, 1, 1]);
    assert.match(randomName(), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.equal(randomName(() => 0), 'Crimson Falcon');
    assert.equal(nyDay(Date.parse('2026-03-10T03:00:00Z')), '2026-03-09');
  });

  test('a Lucid account passes at the target and fails at the trailing max loss', () => {
    let a = lucid50();
    a = { ...a, ...applyClose(a, 1500, 50, '2026-03-02') };
    assert.equal(a.status, 'active');
    assert.equal(a.floor, 48000);
    // next day the floor trails the best end-of-day balance, locked at start + $100
    a = { ...a, ...applyClose(a, -100, 10, '2026-03-03') };
    assert.equal(a.floor, 49500);
    a = { ...a, ...applyClose(a, 2000, 50, '2026-03-03') };
    assert.equal(a.status, 'passed');
    assert.equal(a.xp, 110);
    const b = applyClose(lucid50(), -2000, 10, '2026-03-02');
    assert.equal(b.status, 'failed');
  });
});

describe('copier', () => {
  let db, sent, copier, script, group, accounts;
  const lines = [];
  before(async () => {
    db = dbIn(tmp());
    sent = [];
    copier = createCopier({ db, log: (l) => lines.push(l), forward: async (url, body) => { sent.push({ url, body }); return 200; } });
    script = await db.run('Script', 'create', { name: 'QB Gold London-NY', language: 'Pine', code: '//@version=5' });
    group = await db.run('CopyGroup', 'create', { name: 'Gold squad', platform: 'Futures', script_id: script.id, max_trades: 2 });
    accounts = [
      await db.run('TradingAccount', 'create', lucid50({ label: 'A', display_name: 'Crimson Falcon', group_id: group.id, forward_url: 'https://webhooks.traderspost.io/x' })),
      await db.run('TradingAccount', 'create', lucid50({ label: 'B', display_name: 'Silent Wolf', group_id: group.id, risk_usd: 0, copy_qty: 2 })),
      await db.run('TradingAccount', 'create', lucid50({ label: 'C', group_id: 'other' })),
    ];
  });
  const sig = (s) => ({ symbol: 'MGC1!', strategy: 'QB Gold London-NY', trade_id: 'T1', created_date: '2026-03-02T14:00:00Z', ...s });
  const trades = (accountId) => db.run('AccountTrade', 'filter', { account_id: accountId }, 'opened_at');

  test('a buy is copied to every account in the group, sized by its risk', async () => {
    const r = await copier.onSignal(sig({ event: 'buy', price: 2400, sl: 2396, tp: 2406, qty: 1 }));
    assert.deepEqual(r, { script: 'QB Gold London-NY', accounts: 2 });
    const [a] = await trades(accounts[0].id), [b] = await trades(accounts[1].id);
    assert.equal(a.qty, 7); // $300 / ($4 stop x $10 per point)
    assert.equal(b.qty, 2); // no risk set: script qty x copy_qty
    assert.equal(a.side, 'long');
    assert.equal((await trades(accounts[2].id)).length, 0);
    assert.equal((await db.run('CopyGroup', 'get', group.id)).trades_made, 1);
    assert.deepEqual(sent[0].body, { ticker: 'MGC1!', action: 'buy', quantity: 7, price: 2400, stopLoss: { type: 'stop', stopPrice: 2396 }, takeProfit: { limitPrice: 2406 } });
    assert.equal((await trades(accounts[0].id))[0].forwarded, 'open sent (200)');
  });

  test('stop moves and the close score P&L and XP for the account and the script', async () => {
    await copier.onSignal(sig({ event: 'set_sl', sl: 2400 }));
    assert.equal((await trades(accounts[0].id))[0].sl, 2400);
    await copier.onSignal(sig({ event: 'close', price: 2406, reason: 'tp' }));
    const [a] = await trades(accounts[0].id);
    assert.equal(a.status, 'closed');
    assert.equal(a.pnl, 420);
    assert.equal(a.xp, 50);
    const acc = await db.run('TradingAccount', 'get', accounts[0].id);
    assert.equal(acc.balance, 50420);
    assert.equal(acc.xp, 50);
    const s = await db.run('Script', 'get', script.id);
    assert.deepEqual([s.trades, s.xp, s.pnl], [2, 100, 540]); // B: 2 x 6 x $10 = $120, 50 XP
    assert.deepEqual(sent.at(-1).body, { ticker: 'MGC1!', action: 'exit', price: 2406 });
  });

  test('the group stops at its max trades; an opposite signal reverses open trades', async () => {
    await copier.onSignal(sig({ event: 'sell', price: 2410, sl: 2415, trade_id: 'T2' }));
    await copier.onSignal(sig({ event: 'buy', price: 2405, sl: 2400, trade_id: 'T3' }));
    assert.equal((await db.run('CopyGroup', 'get', group.id)).trades_made, 2);
    const a = await trades(accounts[0].id);
    assert.equal(a.length, 2);
    assert.equal(a[1].side, 'short');
    assert.equal(a[1].status, 'open');
  });

  test('every step is in the activity log and the log file', async () => {
    const ev = await db.run('CopyEvent', 'filter', {}, 'created_date');
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ['signal', 'open', 'move', 'close', 'order', 'limit']) assert.ok(kinds.has(k), `no ${k} event`);
    const open = ev.find((e) => e.kind === 'open' && e.account_id === accounts[0].id);
    assert.match(open.message, /Crimson Falcon bought 7 MGC1! @ 2400 SL 2396 TP 2406 \(risk \$300 \/ \(4 stop x \$10\) = 7; risking \$280\.00\) - group trade 1\/2/);
    assert.equal(open.data.risk, 280);
    const close = ev.find((e) => e.kind === 'close' && e.account_id === accounts[0].id && e.data?.pnl === 420);
    assert.match(close.message, /closed long 7 MGC1! 2400 -> 2406 \(tp\): \+\$420\.00, \+50 XP, balance \$50,420\.00/);
    assert.match(ev.find((e) => e.kind === 'limit').message, /Gold squad is at its max of 2 trades: buy not copied/);
    assert.match(ev.find((e) => e.kind === 'move').message, /SL 2396 -> 2400/);
    assert.ok(lines.some((l) => l.startsWith('copy open: Crimson Falcon bought 7')));
  });

  test('a failed account takes no more trades; unknown scripts are ignored', async () => {
    await db.run('CopyGroup', 'update', group.id, { max_trades: 10 });
    await copier.onSignal(sig({ event: 'close', price: 2700, trade_id: 'T2' }));
    const acc = await db.run('TradingAccount', 'get', accounts[0].id);
    assert.equal(acc.status, 'failed');
    await copier.onSignal(sig({ event: 'buy', price: 2700, sl: 2690, trade_id: 'T4' }));
    assert.equal((await trades(accounts[0].id)).length, 2);
    assert.deepEqual(await copier.onSignal(sig({ event: 'buy', price: 1, strategy: 'Nobody' })), { script: null, accounts: 0 });
    assert.deepEqual(orderMessage('close', { price: 5 }, { symbol: 'X' }), { ticker: 'X', action: 'exit', price: 5 });
    const ev = await db.run('CopyEvent', 'filter', {}, '-created_date');
    assert.ok(ev.some((e) => e.kind === 'status' && /Crimson Falcon FAILED: balance .* hit the max loss floor \$48,000\.00/.test(e.message)));
    assert.ok(ev.some((e) => e.kind === 'skip' && /Crimson Falcon skipped: account failed/.test(e.message)));
    assert.ok(ev.some((e) => e.kind === 'ignore' && /no script has that name/.test(e.message)));
  });

  test('the chat reads the copy trading summary, log and trades', async () => {
    const tools = createChatTools({ db: db.sync, market: null });
    const sum = JSON.parse(await tools.run('copy_trading_summary', {}));
    assert.equal(sum.scripts[0].name, 'QB Gold London-NY');
    assert.equal(sum.accounts.find((a) => a.trader === 'Crimson Falcon').status, 'failed');
    assert.ok(sum.overall.trades >= 3);
    const log = JSON.parse(await tools.run('copy_trading_log', { account: 'crimson falcon', problems_only: true }));
    assert.ok(log.events.length && log.events.every((e) => e.level !== 'info'));
    const tr = JSON.parse(await tools.run('copy_trading_trades', { account: 'Silent Wolf' }));
    assert.equal(tr.trades[0].pnl, 120);
    assert.match(JSON.parse(await tools.run('copy_trading_log', { script: 'nope' })).error, /No "nope"\. Known: QB Gold London-NY/);
  });
});

describe('copy trading webhook', () => {
  let app, base, key;
  before(async () => {
    app = await startServer({ port: 0, dataDir: tmp(), userName: 'Copy' });
    base = `http://localhost:${app.port}`;
    key = (await (await fetch(`${base}/api/signals/config`)).json()).key;
  });
  after(() => app.close());
  const invoke = async (...args) => (await (await fetch(`${base}/api/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'entity', args }) })).json()).result;

  test("a script's own webhook address trades its groups", async () => {
    const script = await invoke('Script', 'create', { name: 'My bot', language: 'Pine', code: '' });
    const group = await invoke('CopyGroup', 'create', { name: 'G', platform: 'Futures', script_id: script.id });
    const acc = await invoke('TradingAccount', 'create', lucid50({ label: 'X', group_id: group.id }));
    const hook = (body) => fetch(`${base}/hook/${key}/s/${script.id}`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await hook({ event: 'sell', symbol: 'MNQ1!', price: 20000, sl: 20010, strategy: 'anything' })).status, 200);
    assert.equal((await hook({ event: 'close', symbol: 'MNQ1!', price: 19990, strategy: 'anything' })).status, 200);
    const [t] = await invoke('AccountTrade', 'filter', { account_id: acc.id });
    assert.equal(t.qty, 15); // $300 / (10 points x $2)
    assert.equal(t.pnl, 300);
    assert.equal((await invoke('Signal', 'filter', {}))[0].script_id, script.id);
    assert.equal((await invoke('CopyGroup', 'get', group.id)).trades_made, 1);
  });
});

describe('one trade per account', () => {
  test("a second script's signal is skipped while the account holds the first script's trade", async () => {
    const db = dbIn(tmp());
    const copier = createCopier({ db });
    const a = await db.run('Script', 'create', { name: 'A', language: 'Pine' });
    const b = await db.run('Script', 'create', { name: 'B', language: 'Pine' });
    const g1 = await db.run('CopyGroup', 'create', { name: 'G1', platform: 'Futures', script_ids: [a.id] });
    const g2 = await db.run('CopyGroup', 'create', { name: 'G2', platform: 'Futures', script_ids: [b.id] });
    const acc = await db.run('TradingAccount', 'create', lucid50({ label: 'X', display_name: 'Swift Fox', group_id: g1.id }));
    await copier.onSignal({ event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, strategy: 'A' });
    // the account moved to B's group but kept A's open trade
    await db.run('TradingAccount', 'update', acc.id, { group_id: g2.id });
    const r = await copier.onSignal({ event: 'sell', symbol: 'MNQ1!', price: 20000, sl: 20010, strategy: 'B' });
    assert.equal(r.accounts, 0);
    assert.equal((await db.run('AccountTrade', 'filter', { account_id: acc.id })).length, 1);
    const skip = (await db.run('CopyEvent', 'filter', { kind: 'skip' }))[0];
    assert.match(skip.message, /Swift Fox skipped sell MNQ1!: there is already a A long on MGC1! on this account \(one trade per account\)/);
  });
});

describe('script folders for Claude', () => {
  test('each script gets CLAUDE.md, its code, activity.log, trades.csv, summary.json and notes.md; your notes are kept', async () => {
    const dir = tmp();
    const db = dbIn(dir);
    const root = path.join(dir, 'scripts');
    const folders = createScriptFolders({ root, db });
    const copier = createCopier({ db });
    const script = await db.run('Script', 'create', { name: 'Gold Breakout!', language: 'Pine', code: '//@version=5' });
    const g = await db.run('CopyGroup', 'create', { name: 'Squad', platform: 'Futures', script_ids: [script.id] });
    await db.run('TradingAccount', 'create', lucid50({ label: 'L1', display_name: 'Swift Fox', group_id: g.id }));
    await copier.onSignal({ event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, strategy: 'Gold Breakout!' });
    await copier.onSignal({ event: 'close', symbol: 'MGC1!', price: 2404, reason: 'tp', strategy: 'Gold Breakout!' });
    const out = await folders.sync();
    const sd = path.join(root, 'gold-breakout');
    assert.equal(out.scripts[0].dir, sd);
    assert.deepEqual(fs.readdirSync(sd).sort(), ['CLAUDE.md', 'activity.log', 'notes.md', 'script.pine', 'summary.json', 'trades.csv']);
    const md = fs.readFileSync(path.join(sd, 'CLAUDE.md'), 'utf8');
    assert.match(md, /# Gold Breakout!/);
    assert.match(md, /Group Squad: 1\/100 trades made/);
    assert.match(md, /Swift Fox \(L1, TradingView\): active, balance \$50,280\.00/);
    assert.match(md, /1 closed trades \(0 open\): net \$280\.00/);
    assert.match(fs.readFileSync(path.join(sd, 'activity.log'), 'utf8'), /open   Swift Fox: Swift Fox bought 7 MGC1!/);
    assert.match(fs.readFileSync(path.join(sd, 'trades.csv'), 'utf8'), /,Swift Fox,Squad,,MGC1!,long,7,2400,2396,,2404,280,50,tp,closed,/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(sd, 'summary.json'), 'utf8')).overall.net, 280);
    assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /gold-breakout\/: Gold Breakout! \(Pine, 1 trades, \$280\.00\)/);
    // Your notes go back into QuantBot and survive a rebuilt folder
    fs.writeFileSync(path.join(sd, 'notes.md'), 'Try a 2h max hold');
    await folders.sync();
    assert.equal((await db.run('Script', 'get', script.id)).notes, 'Try a 2h max hold');
    fs.rmSync(root, { recursive: true });
    await createScriptFolders({ root, db }).sync();
    assert.equal(fs.readFileSync(path.join(sd, 'notes.md'), 'utf8'), 'Try a 2h max hold');
    assert.match(fs.readFileSync(path.join(sd, 'CLAUDE.md'), 'utf8'), /## Trader notes\nTry a 2h max hold/);
    // A deleted script's folder goes
    await db.run('Script', 'delete', script.id);
    await folders.sync();
    assert.ok(!fs.existsSync(sd));
  });

  test('code in a reply and folder names', () => {
    assert.deepEqual(codeFromReply('x\n```pine\n//@version=5\nplot(close)\n```'), { code: '//@version=5\nplot(close)', language: 'Pine' });
    assert.equal(codeFromReply('```mql5\nvoid OnTick(){}\n```').language, 'MT5');
    assert.equal(codeFromReply('no code'), null);
    assert.equal(slug('Gold: London/NY v2!'), 'gold-london-ny-v2');
  });
});
