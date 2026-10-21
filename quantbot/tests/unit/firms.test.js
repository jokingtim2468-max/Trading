// FTMO and Lucid rules, news blackouts, the MT5 copier bridge and auto-withdraw
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipher } from '../../server/crypto.js';
import { createBackend, entityDefaults } from '../../server/backend.js';
import { createCopier } from '../../server/copier.js';
import { createMt5Bridge, orderTag } from '../../server/mt5.js';
import { createPayouts } from '../../server/payouts.js';
import { parseFF, parseFTMO, createNews } from '../../server/news.js';
import { blackoutAt, upcomingNews, currenciesFor } from '../../server/lib/blackout.js';
import { PLANS, applyClose, firmLimitError, firmUsage, dayIn } from '../../server/lib/copyRules.js';
import { startServer } from '../../server/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-firms-'));
function dbIn(dir) {
  const c = createCipher(dir);
  const be = createBackend({ dataDir: dir, encrypt: c.encrypt, decrypt: c.decrypt, userName: 'F', defaults: entityDefaults(path.resolve('server/entities')) });
  return { run: async (...a) => be.handle('entity', ...a) };
}
const ftmoAcc = (k, extra = {}) => {
  const p = PLANS[`ftmo${k}`];
  return { platform: 'MT5', plan: `ftmo${k}`, stage: 'challenge', start_balance: p.start, balance: p.start, target: p.stages.challenge, max_loss: p.maxLoss, daily_loss: p.dailyLoss, day_zone: p.dayZone, ...extra };
};
const EVENTS = [
  { source: 'ff', title: 'CPI m/m', currency: 'USD', impact: 'high', time: '2026-10-14T12:30:00.000Z', restricted: false },
  { source: 'ftmo', title: 'CPI m/m', currency: 'USD + US INDICES + XAUUSD + DXY', impact: 'high', time: '2026-10-14T12:30:00.000Z', restricted: true },
  { source: 'ff', title: 'Unemployment Rate', currency: 'AUD', impact: 'high', time: '2026-10-15T00:30:00.000Z', restricted: false },
];

describe('firm rules', () => {
  test('FTMO: 5% daily loss resets each Prague day, 10% max loss is fixed, 10% / 5% targets by stage', () => {
    let a = ftmoAcc(100);
    a = { ...a, ...applyClose(a, -3000, 10, '2026-10-16') };
    a = { ...a, ...applyClose(a, -1900, 10, '2026-10-16') };
    assert.equal(a.status, 'active');
    a = { ...a, ...applyClose(a, -200, 10, '2026-10-16') };
    assert.deepEqual([a.status, a.status_reason], ['failed', 'daily loss']);
    let b = ftmoAcc(100);
    for (const [pnl, day] of [[-4000, '2026-10-12'], [-4000, '2026-10-13'], [-2100, '2026-10-14']]) b = { ...b, ...applyClose(b, pnl, 10, day) };
    assert.deepEqual([b.status, b.status_reason], ['failed', 'max loss']);
    assert.equal(b.floor, 90000, 'FTMO max loss does not trail');
    assert.deepEqual(PLANS.ftmo100.stages, { challenge: 10000, verification: 5000, funded: null });
    assert.equal(dayIn(Date.parse('2026-10-16T22:30:00Z'), 'Europe/Prague'), '2026-10-17');
  });

  test('Lucid: 5 funded accounts per person; FTMO: any number, $400K funded at once', () => {
    const lucid = [1, 2, 3, 4, 5].map((i) => ({ id: `l${i}`, plan: 'lucid50', stage: 'funded', start_balance: 50000 }));
    assert.match(firmLimitError(lucid, { plan: 'lucid50', stage: 'funded', start_balance: 50000 }), /5 funded accounts per person/);
    assert.equal(firmLimitError(lucid, { plan: 'lucid50', stage: 'evaluation', start_balance: 50000 }), null, 'evaluations are unlimited');
    assert.equal(firmLimitError([...lucid.slice(0, 4), { ...lucid[4], status: 'failed' }], { plan: 'lucid50', stage: 'funded', start_balance: 50000 }), null, 'failed accounts free a place');
    const ftmo = [{ id: 'a', plan: 'ftmo200', stage: 'funded', start_balance: 200000 }, { id: 'b', plan: 'ftmo100', stage: 'funded', start_balance: 100000 }];
    assert.equal(firmLimitError(ftmo, { plan: 'ftmo100', stage: 'funded', start_balance: 100000 }), null);
    assert.match(firmLimitError(ftmo, { plan: 'ftmo200', stage: 'funded', start_balance: 200000 }), /\$400,000 of funded capital/);
    assert.equal(firmLimitError(ftmo, { id: 'a', plan: 'ftmo200', stage: 'funded', start_balance: 200000 }), null, 'an account is not counted twice');
    assert.deepEqual(firmUsage([...lucid, ...ftmo]).map((u) => [u.firm, u.funded, u.capital]), [['Lucid', 5, 250000], ['FTMO', 2, 300000]]);
  });
});

describe('news blackouts', () => {
  test('calendars are read from Forex Factory and FTMO', () => {
    assert.deepEqual(parseFF([{ title: 'CPI m/m', country: 'USD', date: '2026-10-14T08:30:00-04:00', impact: 'High' }]),
      [{ source: 'ff', title: 'CPI m/m', currency: 'USD', impact: 'high', time: '2026-10-14T12:30:00.000Z', restricted: false }]);
    assert.equal(parseFTMO({ items: [{ title: 'CPI m/m', instrument: 'USD + XAUUSD', impact: 'high', restriction: true, date: '2026-10-14T14:30:00+02:00' }] })[0].restricted, true);
  });

  test('blocks around news for the symbol, FTMO restricted events, weekdays, windows and dates in the time zone', () => {
    const t = (s) => Date.parse(s);
    assert.match(blackoutAt({}, EVENTS, t('2026-10-14T12:26:00Z'), 'MGC1!', 'America/New_York').reason, /News: USD CPI m\/m .*no new trades 08:25-08:35/);
    assert.equal(blackoutAt({}, EVENTS, t('2026-10-14T12:20:00Z'), 'MGC1!', 'America/New_York'), null);
    assert.equal(blackoutAt({}, EVENTS, t('2026-10-15T00:30:00Z'), 'XAUUSD', 'UTC'), null, 'AUD news does not block gold');
    assert.match(blackoutAt({ news: false }, EVENTS, t('2026-10-14T12:31:00Z'), 'XAUUSD', 'UTC').reason, /FTMO restricted news/);
    assert.equal(blackoutAt({ news: false }, EVENTS, t('2026-10-14T12:33:00Z'), 'XAUUSD', 'UTC'), null, 'restricted window is 2 minutes');
    assert.equal(blackoutAt({ days: [5] }, [], t('2026-10-16T15:00:00Z'), 'X', 'America/New_York').kind, 'day');
    assert.equal(blackoutAt({ windows: [{ from: '22:00', to: '02:00' }] }, [], t('2026-10-16T03:30:00Z'), 'X', 'America/New_York').kind, 'window');
    assert.equal(blackoutAt({ windows: [{ from: '22:00', to: '02:00' }] }, [], t('2026-10-16T03:30:00Z'), 'X', 'Asia/Tokyo'), null, 'same moment, other time zone');
    assert.match(blackoutAt({ dates: [{ from: '2026-12-21', to: '2026-12-31', note: 'Holidays' }] }, [], t('2026-12-24T15:00:00Z'), 'X', 'UTC').reason, /Holidays/);
    assert.equal(upcomingNews({}, EVENTS, 'XAUUSD', t('2026-10-14T00:00:00Z')).length, 3);
    assert.deepEqual(currenciesFor('EURUSD'), ['EUR', 'USD']);
  });

  test('the copier takes no new trade inside a block, and still follows the close', async () => {
    const db = dbIn(tmp());
    const copier = createCopier({ db, news: () => EVENTS });
    const s = await db.run('Script', 'create', { name: 'S', language: 'Pine' });
    const g = await db.run('CopyGroup', 'create', { name: 'G', platform: 'Futures', script_ids: [s.id], blackout: { tz: 'America/New_York' } });
    const a = await db.run('TradingAccount', 'create', { platform: 'TradingView', label: 'A', group_id: g.id, start_balance: 50000, balance: 50000 });
    await copier.onSignal({ event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, strategy: 'S', created_date: '2026-10-14T12:27:00.000Z' });
    assert.equal((await db.run('AccountTrade', 'filter', { account_id: a.id })).length, 0);
    assert.equal((await db.run('CopyGroup', 'get', g.id)).trades_made || 0, 0, 'a blocked signal is not counted');
    const ev = (await db.run('CopyEvent', 'filter', { kind: 'block' }))[0];
    assert.match(ev.message, /G: buy MGC1! not copied\. News: USD CPI m\/m/);
    await copier.onSignal({ event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, strategy: 'S', created_date: '2026-10-14T13:00:00.000Z' });
    assert.equal((await db.run('AccountTrade', 'filter', { account_id: a.id })).length, 1);
  });

  test('the news feed keeps what it has seen, and a failing source only logs', async () => {
    const dir = tmp();
    const logs = [];
    const fake = async (url) => (url.includes('faireconomy')
      ? new Response(JSON.stringify([{ title: 'NFP', country: 'USD', date: '2026-10-16T08:30:00-04:00', impact: 'High' }]))
      : new Response('down', { status: 503 }));
    const n = createNews({ dataDir: dir, log: (l) => logs.push(l), fetch: fake });
    assert.deepEqual(await n.refresh(), { ff: 1, ftmo: 0 });
    assert.equal(n.status().errors.ftmo, 'HTTP 503');
    assert.ok(logs.some((l) => /FTMO calendar failed: HTTP 503/.test(l)));
    assert.equal(createNews({ dataDir: dir, fetch: fake }).events()[0].title, 'NFP', 'saved in data/news.json');
  });
});

describe('MT5 copier bridge', () => {
  test('orders go to the EA in lots on the mapped symbol; fills and errors come back to the log', async () => {
    const db = dbIn(tmp());
    const copier = createCopier({ db });
    const bridge = createMt5Bridge({ db, note: copier.note });
    const s = await db.run('Script', 'create', { name: 'Gold', language: 'Pine' });
    const g = await db.run('CopyGroup', 'create', { name: 'FTMO', platform: 'MT5', script_ids: [s.id] });
    const a = await db.run('TradingAccount', 'create', ftmoAcc(100, { label: 'F1', display_name: 'Iron Hawk', group_id: g.id, risk_usd: 500, mt5_on: true, symbol_map: 'MGC1!=XAUUSD' }));
    await copier.onSignal({ event: 'buy', symbol: 'MGC1!', price: 2400, sl: 2396, tp: 2410, strategy: 'Gold', trade_id: 'G1' });
    const [t] = await db.run('AccountTrade', 'filter', { account_id: a.id });
    assert.deepEqual([t.symbol, t.qty, t.point_value], ['XAUUSD', 1.25, 100]); // $500 / (4 x $100 per lot)
    const lines = (await bridge.poll(a.id)).split('\n');
    assert.equal(lines.length, 1);
    const [id, action, sym, side, lots, sl, tp, tag] = lines[0].split('|');
    assert.deepEqual([action, sym, side, lots, sl, tp, tag], ['open', 'XAUUSD', 'long', '1.25', '2396', '2410', orderTag(t.id)]);
    assert.equal(await bridge.poll(a.id), '', 'a sent order is not sent again right away');
    assert.equal(await bridge.ack(a.id, `${id}|1|5551234|2400.35|\n`), 1);
    assert.equal((await db.run('AccountTrade', 'get', t.id)).mt5_ticket, '5551234');
    const filled = (await db.run('CopyEvent', 'filter', { kind: 'order' })).map((e) => e.message);
    assert.ok(filled.some((m) => /Iron Hawk: MT5 open buy 1.25 lots XAUUSD done \(#5551234\) at 2400.35, \+0.35 from the signal price/.test(m)), filled.join('\n'));
    await copier.onSignal({ event: 'set_sl', symbol: 'MGC1!', sl: 2400, strategy: 'Gold', trade_id: 'G1' });
    await copier.onSignal({ event: 'close', symbol: 'MGC1!', price: 2410, reason: 'tp', strategy: 'Gold', trade_id: 'G1' });
    const next = (await bridge.poll(a.id)).split('\n').map((l) => l.split('|'));
    assert.deepEqual(next.map((f) => [f[1], f[5], f[8]]), [['modify', '2400', '5551234'], ['close', '2400', '5551234']]);
    await bridge.ack(a.id, `${next[1][0]}|0|0|0|close rejected: market closed\n`);
    assert.ok((await db.run('CopyEvent', 'filter', { kind: 'order', level: 'error' })).some((e) => /failed: close rejected: market closed/.test(e.message)));
    await assert.rejects(bridge.poll('nope'), /Not an MT5 account/);
  });

  test("the EA's address answers only on this PC with the key", async () => {
    const app = await startServer({ port: 0, dataDir: tmp(), userName: 'M', newsFetch: async () => new Response('[]') });
    try {
      const base = `http://localhost:${app.port}`;
      const inv = async (...args) => (await (await fetch(`${base}/api/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'entity', args }) })).json()).result;
      const acc = await inv('TradingAccount', 'create', { platform: 'MT5', label: 'M1', mt5_on: true });
      const { url } = await (await fetch(`${base}/api/mt5/url?account=${acc.id}`)).json();
      assert.match(url, new RegExp(`/mt5/[0-9a-f]{32}/${acc.id}$`));
      const res = await fetch(`${url.replace('127.0.0.1', 'localhost')}/poll`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '');
      assert.equal((await fetch(`${base}/mt5/${'a'.repeat(32)}/${acc.id}/poll`)).status, 404);
      assert.ok((await inv('TradingAccount', 'get', acc.id)).mt5_seen_at, 'the EA shows as connected');
      assert.match(await (await fetch(`${base}/api/mt5/ea`)).text(), /QuantBot Copier/);
    } finally { await app.close(); }
  });
});

describe('auto-withdraw', () => {
  test('FTMO funded accounts pay out every 14 days at 80% when flat and in profit, keeping a 2.5% drawdown buffer', async () => {
    const db = dbIn(tmp());
    const copier = createCopier({ db });
    const payouts = createPayouts({ db, note: copier.note });
    const day = 86400000, t0 = Date.parse('2026-10-01T00:00:00Z');
    const a = await db.run('TradingAccount', 'create', ftmoAcc(100, { label: 'F', display_name: 'Lunar Fox', stage: 'funded', target: null, auto_withdraw: true, funded_at: new Date(t0).toISOString(), balance: 104000 }));
    assert.equal((await payouts.check(t0 + 13 * day)).length, 0, 'not before 14 days');
    const open = await db.run('AccountTrade', 'create', { account_id: a.id, status: 'open', symbol: 'XAUUSD', side: 'long', qty: 1 });
    assert.equal((await payouts.check(t0 + 14 * day)).length, 0, 'waits for the account to be flat');
    await db.run('AccountTrade', 'update', open.id, { status: 'closed' });
    const [p] = await payouts.check(t0 + 14 * day);
    assert.deepEqual([p.gross, p.split, p.net, p.retained, p.status], [1500, 0.8, 1200, 2500, 'due'], '$4,000 profit minus the $2,500 buffer');
    const after = await db.run('TradingAccount', 'get', a.id);
    assert.deepEqual([after.balance, after.withdrawn], [102500, 1200], 'never back to the starting balance');
    assert.match((await db.run('CopyEvent', 'filter', { kind: 'payout' }))[0].message, /Lunar Fox: FTMO withdrawal ready: request \$1,500.00 \(your 80% = \$1,200.00\); \$2,500.00 stays in as the drawdown buffer\. Request it at https:\/\/ftmo.com/);
    assert.equal((await payouts.check(t0 + 20 * day)).length, 0, 'next one is 14 days after this one');
  });
});
