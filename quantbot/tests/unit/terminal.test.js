// Terminal page: chart settings (presets, versions, revert), the AI chart editor's checks, and orders reaching a
// copy group's accounts through the copier
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanChartChange, DEFAULT_CHART } from '../../server/lib/chartTheme.js';
import { createTerminal, jsonIn, editorPrompt } from '../../server/terminal.js';
import { startServer } from '../../server/index.js';

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
    t.preset('black');
    assert.equal(t.chart().settings.background, '#000000');
    t.set({ up: '#ffffff' }, 'white up candles');
    assert.equal(t.chart().versions.length, 3);
    t.revert();
    assert.equal(t.chart().settings.up, DEFAULT_CHART.up);
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

    await post('/api/terminal/order', { event: 'close', price: 4190, group_id: g1.id, trade_id: pos[0].trade_id });
    pos = (await (await fetch(`${base}/api/terminal/positions`)).json()).positions;
    assert.equal(pos.length, 0, 'close shuts the trade on every account');
    const sigs = await db('Signal', 'filter', {});
    assert.ok(sigs.some((s) => s.strategy === 'QuantBot Terminal' && s.event === 'buy'), 'logged on the Signals page too');
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
