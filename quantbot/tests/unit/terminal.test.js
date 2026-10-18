// Terminal page: chart settings (presets, versions, revert), the AI chart editor's checks, and orders reaching a
// copy group's accounts through the copier
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanChartChange, DEFAULT_CHART } from '../../server/lib/chartTheme.js';
import { createTerminal, jsonIn, editorPrompt, failPrice, cleanPrediction } from '../../server/terminal.js';
import { accountRoom, copyQty, protectionFor } from '../../server/lib/copyRules.js';
import { startServer } from '../../server/index.js';
import { moveAt, moneyAt, usdSigned, groupTrades } from '../../src/lib/tradeMath.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-terminal-'));

describe('Chart settings', () => {
  test('only chart settings pass the check', () => {
    assert.deepEqual(cleanChartChange({ background: '#000000', showGrid: false }), { background: '#000000', showGrid: false });
    assert.deepEqual(cleanChartChange({ wickUp: '' }), { wickUp: '' });
    assert.throws(() => cleanChartChange({ background: 'black' }), /color/);
    assert.throws(() => cleanChartChange({ code: 'alert(1)' }), /isn't a chart setting/);
    assert.throws(() => cleanChartChange({ hollow: 'yes' }), /true or false/);
    assert.throws(() => cleanChartChange({}), /No chart settings/);
    assert.deepEqual(jsonIn('Sure! {"change": {"up": "#fff"}, "say": "ok"} hope that helps'), { change: { up: '#fff' }, say: 'ok' });
    assert.equal(jsonIn('no json'), null);
    assert.match(editorPrompt(DEFAULT_CHART), /ONE JSON object/);
  });

  test('presets, versions, revert, restore, and the AI editor', async () => {
    const dir = tmp();
    let reply = '';
    const t = createTerminal({ dataDir: dir, db: null, signals: null, ask: async () => reply });
    assert.equal(t.chart().versions.length, 1);
    assert.equal(t.chart().settings.background, '#2f3033', 'gray background with black and white candles by default');
    assert.equal(t.chart().settings.up, '#ffffff');
    t.preset('black');
    assert.equal(t.chart().settings.background, '#000000');
    const blackUp = t.chart().settings.up;
    t.set({ up: '#ffffff' }, 'white up candles');
    assert.equal(t.chart().versions.length, 3);
    t.revert();
    assert.equal(t.chart().settings.up, blackUp);
    t.restore(1);
    assert.equal(t.chart().settings.background, DEFAULT_CHART.background);
    assert.throws(() => t.set({ fontSize: 40 }), /isn't a chart setting/);

    reply = 'Here you go: {"change": {"background": "#2f3033", "showGrid": false}, "say": "Gray background, grid hidden."}';
    let r = await t.edit('gray background and hide the grid');
    assert.equal(r.changed, true);
    assert.equal(r.settings.background, '#2f3033');
    assert.equal(r.settings.showGrid, false);
    reply = '{"change": {"html": "<script>"}, "say": "done"}';
    r = await t.edit('add a script tag');
    assert.equal(r.changed, false, 'anything but chart settings is refused');
    assert.match(r.say, /can't do that/);
    reply = 'I cannot help';
    r = await t.edit('make it pretty');
    assert.equal(r.changed, false);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'terminal', 'chart.json'), 'utf8'));
    assert.equal(saved.versions.at(-1).settings.background, '#2f3033', 'versions survive a restart');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Trade money on the chart', () => {
  test('dragging the target and stop shows the move and the money, cents included', () => {
    const long = { side: 'long', entry: 4715, qty: 1, point_value: 1 };
    assert.equal(usdSigned(moveAt(long, 4815)), '+$100.00', 'target dragged up $100');
    assert.equal(usdSigned(moveAt(long, 4665)), '−$50.00', 'stop dragged down $50');
    assert.equal(usdSigned(moveAt(long, 4715.37)), '+$0.37');
    const short = { side: 'short', entry: 4715, qty: 0.4, point_value: 100 };
    assert.equal(usdSigned(moveAt(short, 4690)), '+$25.00', 'a short gains when price falls');
    assert.deepEqual(moneyAt(short, 4690, 4), { per: 1000, total: 4000 }, '0.40 lots x 100 oz x $25, on 4 accounts');
    assert.equal(usdSigned(1234567.891), '+$1,234,567.89');
    assert.equal(usdSigned(0), '$0.00');
    const g = groupTrades([{ id: 'a', trade_id: 'T1' }, { id: 'b', trade_id: 'T1' }, { id: 'c', trade_id: 'T2' }]);
    assert.deepEqual(g.map((x) => [x.key, x.accounts]), [['T1', 2], ['T2', 1]]);
  });
});


describe('Account protection', () => {
  test('room before the daily loss limit and the max drawdown, and where price fails the account', () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const a = { start_balance: 100000, balance: 99000, max_loss: 10000, daily_loss: 5000, day_key: day, day_start: 100000 };
    const r = accountRoom(a);
    assert.equal(r.toFloor, 9000);
    assert.equal(r.toDaily, 4000, 'already down $1,000 today');
    assert.equal(r.room, 4000);
    assert.equal(r.rule, 'daily loss limit');
    assert.equal(accountRoom({ ...a, day_key: '2000-01-01' }).toDaily, 5000, 'a new day starts again');
    assert.equal(accountRoom({ balance: 500 }).room, Infinity, 'no limits, no floor');
    // Bought 1 lot gold at 4715 ($100 a point): $4,000 of room is 40 points down
    assert.equal(failPrice([{ side: 'long', qty: 1, point_value: 100, entry: 4715 }], 4000), 4675);
    assert.equal(failPrice([{ side: 'short', qty: 2, point_value: 100, entry: 4715 }], 4000), 4735);
  });

  test('profit lock, loss-streak cooldown and the consistency meter', () => {
    const now = Date.parse('2026-10-14T15:00:00Z');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(now));
    const a = { start_balance: 100000, balance: 101600, day_key: day, day_start: 100000 };
    const t = (pnl, at) => ({ pnl, closed_at: at });
    const closed = [t(900, '2026-10-12T15:00:00Z'), t(300, '2026-10-13T15:00:00Z'), t(-200, '2026-10-14T14:10:00Z'), t(-150, '2026-10-14T14:40:00Z'), t(-250, '2026-10-14T14:50:00Z')];
    let p = protectionFor({ lock: 1500 }, a, closed, now);
    assert.equal(p.lock.hit, true);
    assert.match(p.blocked, /daily profit lock: up \$1,600.00 today \(lock at \$1,500.00\)/);
    p = protectionFor({ streak: 3, cooldown: 30 }, { ...a, balance: 99000 }, closed, now);
    assert.equal(p.streak.losses, 3);
    assert.match(p.blocked, /3 losses in a row: cooldown until 15:20 UTC/);
    assert.equal(protectionFor({ streak: 3, cooldown: 5 }, a, closed, now).blocked, null, 'the cooldown is over');
    p = protectionFor({ consistency: 50 }, a, closed, now);
    assert.deepEqual(p.consistency, { best: 900, total: 600, pct: 150, cap: 50 });
  });

  test('size by dollar risk', () => {
    assert.equal(copyQty({ platform: 'MT5' }, { price: 4715, sl: 4705, risk_usd: 250 }, 100).qty, 0.25);
    assert.equal(copyQty({ platform: 'MT5', risk_usd: 500 }, { price: 4715, sl: 4705 }, 100).qty, 0.5, "the account's own risk when the order has none");
    assert.equal(copyQty({ platform: 'MT5', copy_qty: 2 }, { price: 4715, qty: 1 }, 100).qty, 2);
  });
  test("the model's prediction is checked against the open", () => {
    assert.deepEqual(cleanPrediction({ high: 4740.123, low: 4690, confidence: 140, why: 'x' }, 4715), { high: 4740.12, low: 4690, confidence: 100, why: 'x' });
    assert.equal(cleanPrediction({ high: 4700, low: 4690 }, 4715), null, 'high under the open');
    assert.equal(cleanPrediction({ high: 9000, low: 4000 }, 4715), null, 'too wide');
  });
});

describe('Terminal orders', () => {
  let srv, base, dir;
  before(async () => { dir = tmp(); srv = await startServer({ port: 0, dataDir: dir, quiet: true }); base = `http://127.0.0.1:${srv.port}`; });
  after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const db = (...a) => srv.backend.handle('entity', ...a);

  test('a buy reaches every account of the chosen group only, and closes from the page', async () => {
    const g1 = await db('CopyGroup', 'create', { name: 'FTMO x2', enabled: true });
    const g2 = await db('CopyGroup', 'create', { name: 'Other', enabled: true });
    for (const n of [1, 2]) await db('TradingAccount', 'create', { label: `FTMO ${n}`, platform: 'MT5', group_id: g1.id, status: 'active', copy_qty: 1 });
    await db('TradingAccount', 'create', { label: 'Elsewhere', platform: 'MT5', group_id: g2.id, status: 'active', copy_qty: 1 });

    assert.equal((await post('/api/terminal/order', { event: 'buy', price: 4182, sl: 4190, group_id: g1.id })).status, 400, 'stop on the wrong side');
    assert.equal((await post('/api/terminal/order', { event: 'buy', price: 4182 })).status, 400, 'needs a group');
    const r = await (await post('/api/terminal/order', { event: 'buy', symbol: 'XAUUSD', price: 4182, sl: 4175, tp: 4200, qty: 1, group_id: g1.id })).json();
    assert.equal(r.ok, true);
    let pos = (await (await fetch(`${base}/api/terminal/positions`)).json()).positions;
    assert.equal(pos.length, 2, 'both accounts of the chosen group, not the other group');
    assert.ok(pos.every((p) => p.group_id === g1.id && p.side === 'long' && p.sl === 4175 && p.tp === 4200 && p.closable));
    assert.equal((await (await fetch(`${base}/api/terminal/positions?group=${g2.id}`)).json()).positions.length, 0);

    // Dragging the target / stop on the chart sends set_tp / set_sl for that order
    await post('/api/terminal/order', { event: 'set_tp', tp: 4215.5, price: 4182, group_id: g1.id, trade_id: pos[0].trade_id });
    await post('/api/terminal/order', { event: 'set_sl', sl: 4170.25, price: 4182, group_id: g1.id, trade_id: pos[0].trade_id });
    pos = (await (await fetch(`${base}/api/terminal/positions`)).json()).positions;
    assert.ok(pos.every((p) => p.tp === 4215.5 && p.sl === 4170.25), 'moved on every account');

    await post('/api/terminal/order', { event: 'close', price: 4190, group_id: g1.id, trade_id: pos[0].trade_id });
    pos = (await (await fetch(`${base}/api/terminal/positions`)).json()).positions;
    assert.equal(pos.length, 0, 'close shuts the trade on every account');
    const sigs = await db('Signal', 'filter', {});
    assert.ok(sigs.some((s) => s.strategy === 'QuantBot Terminal' && s.event === 'buy'), 'logged on the Signals page too');
  });


  test('rule guard, risk sizing, pending orders, trailing stop, partial close, alerts and flatten all', async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const g = await db('CopyGroup', 'create', { name: 'Guarded', enabled: true });
    const tight = await db('TradingAccount', 'create', { label: 'Tight', platform: 'MT5', group_id: g.id, status: 'active', start_balance: 100000, balance: 99000, max_loss: 10000, daily_loss: 5000, day_key: day, day_start: 100000 });
    await db('TradingAccount', 'create', { label: 'Roomy', platform: 'MT5', group_id: g.id, status: 'active', start_balance: 100000, balance: 100000, max_loss: 10000, daily_loss: 5000 });
    const order = (b) => post('/api/terminal/order', { group_id: g.id, symbol: 'XAUUSD', ...b });

    let r = await order({ event: 'buy', price: 4715, qty: 1 });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /add a stop loss/);
    r = await order({ event: 'buy', price: 4715, sl: 4665, qty: 1 });
    assert.match((await r.json()).error, /Tight would risk \$5,000.00 with \$4,000.00 left before its daily loss limit/);
    const guard = await (await post('/api/terminal/guard', { group_id: g.id, ticket: { event: 'buy', symbol: 'XAUUSD', price: 4715, sl: 4705, risk_usd: 250 } })).json();
    const t = guard.accounts.find((a) => a.name === 'Tight');
    assert.deepEqual([t.room, t.ticket.qty, t.ticket.risk, t.ticket.ok, t.ticket.fail], [4000, 0.25, 250, true, 4555]);

    // Pending: a buy limit goes below the price and fires when the price comes down to it
    assert.equal((await order({ event: 'buy_limit', price: 4715, at: 4720, sl: 4700, risk_usd: 250 })).status, 400, 'a buy limit above the price');
    const p = await (await order({ event: 'buy_limit', price: 4715, at: 4710, sl: 4700, risk_usd: 250 })).json();
    assert.ok(p.pending);
    await order({ event: 'move_pending', id: p.pending, price: 4715, at: 4708 });
    let all = await (await fetch(`${base}/api/terminal/positions?group=${g.id}`)).json();
    assert.equal(all.pending[0].at, 4708);
    let tick = await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4709 })).json();
    assert.equal(tick.fired.length, 0, 'not there yet');
    tick = await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4707.5 })).json();
    assert.equal(tick.fired.length, 1);
    all = await (await fetch(`${base}/api/terminal/positions?group=${g.id}`)).json();
    assert.equal(all.pending.length, 0);
    assert.deepEqual(all.positions.map((x) => x.qty).sort(), [0.33, 0.33], '$250 over a 7.5 point stop at $100 a point');
    const id = all.positions[0].trade_id;

    // Trailing stop 5 points behind the price, only ever tightening
    await order({ event: 'trail', trade_id: id, distance: 5, price: 4707.5 });
    tick = await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4720 })).json();
    assert.deepEqual(tick.moved, [{ trade_id: id, sl: 4715 }]);
    tick = await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4716 })).json();
    assert.equal(tick.moved.length, 0, 'never loosens');

    // Close half
    await order({ event: 'close', price: 4720, trade_id: id, fraction: 0.5 });
    all = await (await fetch(`${base}/api/terminal/positions?group=${g.id}`)).json();
    assert.deepEqual(all.positions.map((x) => x.qty), [0.17, 0.17]);
    const closed = (await db('AccountTrade', 'filter', { account_id: tight.id, status: 'closed' }));
    assert.equal(closed[0].qty, 0.16);
    assert.equal(closed[0].pnl, 200, '12.5 points x 0.16 lots x $100');

    // Alerts fire once when crossed
    await post('/api/terminal/alert', { symbol: 'XAUUSD', price: 4730, now: 4720 });
    assert.equal((await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4725 })).json()).alerts.length, 0);
    assert.equal((await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4731 })).json()).alerts.length, 1);
    assert.equal((await (await post('/api/terminal/tick', { symbol: 'XAUUSD', price: 4732 })).json()).alerts.length, 0);

    // Flatten all: every Terminal trade closed and pending orders cancelled
    await order({ event: 'sell_stop', price: 4731, at: 4700, sl: 4710, risk_usd: 100 });
    const f = await (await post('/api/terminal/flatten', { price: 4731 })).json();
    assert.equal(f.cancelled, 1);
    all = await (await fetch(`${base}/api/terminal/positions`)).json();
    assert.equal(all.positions.length, 0);
    assert.equal(all.pending.length, 0);
  });

  test('chart endpoints', async () => {
    const c = await (await fetch(`${base}/api/terminal/chart`)).json();
    assert.ok(c.presets.some((p) => p.id === 'bw'));
    const after1 = await (await post('/api/terminal/chart/preset', { id: 'bw' })).json();
    assert.equal(after1.settings.up, '#ffffff');
    assert.equal((await post('/api/terminal/chart/set', { change: { up: 'red' } })).status, 400);
    const back = await (await post('/api/terminal/chart/revert', {})).json();
    assert.equal(back.settings.up, c.settings.up);
  });
});
