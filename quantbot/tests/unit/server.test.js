// Local backend: database, key encryption, files, AI functions (with a fake model API) and the HTTP server
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../server/db.js';
import { createCipher } from '../../server/crypto.js';
import { createBackend, entityDefaults } from '../../server/backend.js';
import { startServer } from '../../server/index.js';
process.env.QUANTBOT_NO_AUTOSTART = '1'; // never install or launch Ollama/Docker from the tests

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-test-'));
const ENTITIES = path.resolve('server/entities');

function backendIn(dir) {
  const c = createCipher(dir);
  return createBackend({ dataDir: dir, encrypt: c.encrypt, decrypt: c.decrypt, userName: 'Tester', defaults: entityDefaults(ENTITIES) });
}

describe('database', () => {
  test('create, read, update, delete and query', () => {
    const db = createDb(tmp(), 'local', entityDefaults(ENTITIES));
    const a = db.run('ChatSession', 'create', { title: 'A', last_message_at: '2026-01-02' });
    const b = db.run('ChatSession', 'create', { title: 'B', group: 'Pine', last_message_at: '2026-01-03' });
    assert.equal(a.group, 'General', 'schema default applied');
    assert.equal(a.created_by_id, 'local');
    assert.match(a.id, /^[0-9a-f]{24}$/);

    const paged = db.run('ChatSession', 'filter', {}, { sort: '-last_message_at', limit: 1 });
    assert.deepEqual(paged.items.map((r) => r.title), ['B']);
    assert.equal(paged.has_more, true);
    const next = db.run('ChatSession', 'filter', {}, { sort: '-last_message_at', limit: 1, cursor: paged.next_cursor });
    assert.deepEqual(next.items.map((r) => r.title), ['A']);
    assert.equal(next.has_more, false);

    assert.deepEqual(db.run('ChatSession', 'filter', { group: 'Pine' }, 'title', 10).map((r) => r.title), ['B'], 'positional form returns an array');
    assert.deepEqual(db.run('ChatSession', 'filter', { title: { $in: ['A', 'Z'] } }, {}).items.map((r) => r.title), ['A']);
    assert.deepEqual(db.run('ChatSession', 'filter', {}, { fields: ['title'] }).items[0], { id: a.id, title: 'A' });
    assert.deepEqual(db.run('ChatSession', 'filter', {}, { distinct: 'group' }).items.sort(), ['General', 'Pine']);
    assert.equal(db.run('ChatSession', 'count', { $or: [{ title: 'A' }, { group: 'Pine' }] }), 2);

    assert.equal(db.run('ChatSession', 'update', a.id, { title: 'A2', id: 'hijack' }).id, a.id, 'id cannot be changed');
    assert.equal(db.run('ChatSession', 'get', a.id).title, 'A2');
    db.run('ChatSession', 'bulkUpdate', [{ id: a.id, group: 'MT5' }, { id: b.id, group: 'MT5' }]);
    assert.equal(db.run('ChatSession', 'count', { group: 'MT5' }), 2);
    assert.equal(db.run('ChatSession', 'updateMany', { group: 'MT5' }, { $set: { group: 'X' } }).updated, 2);
    db.run('ChatSession', 'delete', b.id);
    assert.throws(() => db.run('ChatSession', 'get', b.id), /not found/);
    assert.throws(() => db.run('Bad/Name', 'list'), /Unknown entity/);
    assert.throws(() => db.run('ChatSession', 'drop'), /Unsupported operation/);
  });

  test('bulk create, deleteMany and aggregate', () => {
    const db = createDb(tmp(), 'local');
    db.run('Trade', 'bulkCreate', [{ bot: 'x', pnl: 10, day: 'd1' }, { bot: 'x', pnl: -4, day: 'd1' }, { bot: 'y', pnl: 7, day: 'd2' }]);
    const agg = db.run('Trade', 'aggregate', { groupBy: 'day', sum: 'pnl', sort: 'day' });
    assert.deepEqual(agg.rows.map((r) => [r.day, r.count, r.sum_pnl]), [['d1', 2, 6], ['d2', 1, 7]]);
    assert.equal(db.run('Trade', 'deleteMany', { bot: 'x' }).deleted, 2);
    assert.equal(db.run('Trade', 'count', {}), 1);
  });

  test('saves to disk and reloads', () => {
    const dir = tmp();
    const db = createDb(dir, 'local');
    db.run('MarketData', 'create', { symbol: 'XAUUSD' });
    db.flush();
    const again = createDb(dir, 'local');
    assert.equal(again.run('MarketData', 'list', {}).items[0].symbol, 'XAUUSD');
  });
});

describe('API key storage', () => {
  test('AES-GCM round trip, random IV, tamper detection', () => {
    const c = createCipher(tmp());
    const a = c.encrypt('sk-ant-secret');
    assert.notEqual(a, c.encrypt('sk-ant-secret'));
    assert.equal(c.decrypt(a), 'sk-ant-secret');
    const [iv, tag, data] = a.split('.');
    assert.throws(() => c.decrypt([iv, tag, Buffer.from('tampered').toString('base64') + data].join('.')));
  });

  test('keys are validated, encrypted at rest and only shown as last 4', () => {
    const dir = tmp();
    const be = backendIn(dir);
    assert.throws(() => be.handle('function', 'apiKeys', { action: 'save', provider: 'anthropic', api_key: 'nope' }), /valid Anthropic/);
    const status = be.handle('function', 'apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-abcdef1234' });
    assert.deepEqual(status.anthropic, { linked: true, last4: '1234' });
    assert.deepEqual(status.google, { linked: false });
    assert.ok(!fs.readFileSync(path.join(dir, 'keys.json'), 'utf8').includes('sk-ant-abcdef1234'), 'plain key never written');
    // Windows has no Unix permission bits (the file sits in the user's own AppData there)
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'secret.key')).mode & 0o077, 0, 'secret file is owner-only');
    assert.deepEqual(be.handle('function', 'apiKeys', { action: 'remove', provider: 'anthropic' }).anthropic, { linked: false });
  });
});

describe('files', () => {
  test('upload stores under a safe name and reads back', () => {
    const dir = tmp();
    const be = backendIn(dir);
    const { file_uri } = be.handle('file', '../../evil name.csv', Buffer.from('a,b'));
    assert.match(file_uri, /^local-file:\/\/[0-9a-f]{8}-evil_name\.csv$/);
    const stored = file_uri.split('/').pop();
    assert.equal(fs.readFileSync(be.filePath(stored), 'utf8'), 'a,b');
    assert.ok(be.filePath('../../etc/passwd').startsWith(path.join(dir, 'files')), 'no path traversal');
  });
});

// A fake Ollama: reply(body) -> the model's text for that request
async function fakeOllama(be, reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
      const b = JSON.parse(body);
      seen.push(b);
      res.end(JSON.stringify({ message: { role: 'assistant', content: reply(b) } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  await be.handle('function', 'localModel', { action: 'save', url: `${url}/`, model: 'qwen2.5-coder:7b' });
  return { url, seen, close: () => new Promise((r) => server.close(r)) };
}
const lastUser = (b) => b.messages.filter((m) => m.role === 'user').at(-1).content;

describe('AI functions', () => {
  test('local only: a new chat first sends the system prompt, the model answers OK, then the chat replies', async () => {
    const be = backendIn(tmp());
    const s = be.handle('entity', 'ChatSession', 'create', { title: 'New chat', group: 'MT5' });
    be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'Build a gold scalper' });
    await assert.rejects(be.handle('function', 'quantChat', { session_id: s.id, style: 'Concise', model: 'claude-opus-5-5' }), /Set up your local model/);
    const o = await fakeOllama(be, (b) => (/reply with exactly: OK/.test(lastUser(b)) ? 'OK' : 'Here it is\n```mql5\n// Script: Gold Scalper\nvoid OnTick(){}\n```'));
    try {
      const h = await be.handle('function', 'chatHandshake', { session_id: s.id, style: 'Concise' });
      assert.deepEqual(h, { status: 'ok', reply: 'OK' });
      assert.match(lastUser(o.seen[0]), /THE TRADER'S SYSTEM PROMPT[\s\S]*The trader's name is Tester/);
      const { message } = await be.handle('function', 'quantChat', { session_id: s.id, style: 'Concise', model: 'claude-opus-5-5' });
      assert.equal(o.seen.length, 2, 'the handshake is not repeated');
      const chat = o.seen[1];
      assert.equal(chat.model, 'qwen2.5-coder:7b', 'a Claude pick still runs on the local model');
      assert.equal(chat.messages[0].role, 'system');
      assert.match(chat.messages[1].content, /(reply with exactly|Confirm you have read it with): OK/, 'the handshake opens the conversation');
      assert.equal(chat.messages[2].content, 'OK');
      assert.equal(lastUser(chat), 'Build a gold scalper');
      assert.equal(message.role, 'assistant');
      const visible = be.handle('entity', 'ChatMessage', 'filter', { session_id: s.id }, { limit: 50 }).items.filter((m) => !m.hidden);
      assert.equal(visible.length, 2, 'the handshake messages are hidden');
      assert.equal(be.handle('entity', 'ChatSession', 'get', s.id).title, 'Gold Scalper');
    } finally { await o.close(); }
  });

  test("a reply other than OK is reported, and quantChat runs the handshake itself when it wasn't sent", async () => {
    const be = backendIn(tmp());
    const o = await fakeOllama(be, (b) => (/reply with exactly: OK/.test(lastUser(b)) ? 'I do not have a system prompt.' : 'hello'));
    try {
      const s = be.handle('entity', 'ChatSession', 'create', { title: 'x' });
      be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'hi' });
      const { message } = await be.handle('function', 'quantChat', { session_id: s.id, model: 'local' });
      assert.equal(message.content, 'hello');
      const after = be.handle('entity', 'ChatSession', 'get', s.id);
      assert.equal(after.prompt_status, 'failed');
      assert.match(after.prompt_reply, /do not have a system prompt/);
      assert.equal(o.seen[1].options.num_ctx, 32768);
    } finally { await o.close(); }
    await assert.rejects(be.handle('function', 'localModel', { action: 'test', url: 'http://127.0.0.1:1' }), /Ollama isn't running/);
  });

  test('replies run in the background: the page can leave, quick messages get answered, errors are reported', async () => {
    const be = backendIn(tmp());
    const o = await fakeOllama(be, (b) => (/reply with exactly: OK/.test(lastUser(b)) ? 'OK' : `answer to: ${lastUser(b)}`));
    try {
      const s = be.handle('entity', 'ChatSession', 'create', { title: 'x' });
      be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'one' });
      assert.deepEqual(be.handle('function', 'chatSend', { session_id: s.id, model: 'local' }), { replying: true });
      be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'two' });
      assert.deepEqual(be.handle('function', 'chatSend', { session_id: s.id, model: 'local' }), { replying: true }, 'a second send joins the running reply');
      for (let k = 0; k < 100 && be.handle('function', 'chatStatus', { session_id: s.id }).replying; k++) await new Promise((r) => setTimeout(r, 20));
      const st = be.handle('function', 'chatStatus', { session_id: s.id });
      assert.equal(st.replying, false); assert.equal(st.prompt_status, 'ok');
      const msgs = be.handle('entity', 'ChatMessage', 'filter', { session_id: s.id }, { sort: 'created_date', limit: 50 }).items.filter((m) => !m.hidden);
      assert.equal(msgs.at(-1).role, 'assistant');
      assert.match(msgs.at(-1).content, /two/, 'the newest message is answered (quick messages together)');
    } finally { await o.close(); }
    const s2 = be.handle('entity', 'ChatSession', 'create', { title: 'y' });
    be.handle('entity', 'ChatMessage', 'create', { session_id: s2.id, role: 'user', content: 'hi' });
    be.handle('function', 'chatSend', { session_id: s2.id, model: 'local' });
    let st2;
    for (let k = 0; k < 200; k++) { st2 = be.handle('function', 'chatStatus', { session_id: s2.id }); if (!st2.replying) break; await new Promise((r) => setTimeout(r, 25)); }
    assert.match(st2.error, /Local model|Ollama|fetch|ECONNREFUSED/i, `error reported: ${st2.error}`);
  });

  test("a script's chat runs on the local model, reads the script's folder and saves the new code", async () => {
    const dir = tmp();
    const be = backendIn(dir);
    const { createScriptFolders } = await import('../../server/scriptFolders.js');
    const folders = createScriptFolders({ root: path.join(dir, 'scripts'), db: { run: (...a) => be.handle('entity', ...a) } });
    be.setFolders(folders);
    const script = be.handle('entity', 'Script', 'create', { name: 'Gold Breakout', language: 'Pine', code: '//@version=5\nstrategy("old")' });
    const s = be.handle('entity', 'ChatSession', 'create', { title: 'Gold Breakout', group: 'Pine', script_id: script.id });
    be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'Tighten the stop' });
    const o = await fakeOllama(be, () => 'Done\n```pine\n//@version=5\nstrategy("new")\n```');
    try {
      await be.handle('function', 'quantChat', { session_id: s.id, style: 'Concise', model: 'local' });
      const sys = o.seen[0].messages[0].content;
      assert.match(sys, /LINKED SCRIPT: this chat writes and changes the copy trading script "Gold Breakout"/);
      assert.match(sys, /strategy\("old"\)/);
      assert.match(sys, /Files here/);
      assert.equal(be.handle('entity', 'Script', 'get', script.id).code, '//@version=5\nstrategy("new")');
    } finally { await o.close(); }
  });

  test('converter and tester parse the model JSON', async () => {
    const be = backendIn(tmp());
    await assert.rejects(be.handle('function', 'strategyTester', { strategy: '', target: 'MT5' }), /Paste a strategy/);
    let next = '';
    const o = await fakeOllama(be, () => next);
    try {
      next = '```json\n{"code":"//ea","sim_code":"return null;","summary":"s","results":[{"rule":"r","status":"pass","detail":"d"}]}\n```';
      const conv = await be.handle('function', 'strategyTester', { strategy: 'buy dips', rules: '', target: 'MT5', model: 'local' });
      assert.deepEqual(conv, { code: '//ea', sim_code: 'return null;', summary: 's', results: [{ rule: 'r', status: 'pass', detail: 'd' }] });
      next = '{"sim_code":"return null;\n","summary":"ok","rules":["one"]}';
      const t = await be.handle('function', 'scriptTester', { code: '//@version=5', language: 'Pine', model: 'builtin' });
      assert.equal(t.sim_code, 'return null;\n', 'raw line breaks inside strings are repaired');
      assert.deepEqual(t.settings, { balance: 10000 });
      next = '{"summary":"no sim"}';
      await assert.rejects(be.handle('function', 'scriptTester', { code: 'x', language: 'MT5' }), /could not translate/);
    } finally { await o.close(); }
  });

  test('profile updates keep built-in fields', () => {
    const be = backendIn(tmp());
    const me = be.handle('user', 'update', { default_claude_model: 'claude-haiku-4-5', id: 'x', role: 'user' });
    assert.equal(me.default_claude_model, 'claude-haiku-4-5');
    assert.equal(me.id, 'local');
    assert.equal(me.role, 'admin');
    assert.equal(me.full_name, 'Tester');
  });
});

describe('HTTP server', () => {
  let app, base;
  before(async () => {
    app = await startServer({ port: 0, dataDir: tmp(), userName: 'Http' });
    base = `http://localhost:${app.port}`;
  });
  after(() => app.close());

  const invoke = (kind, args, headers = {}) => fetch(`${base}/api/invoke`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ kind, args }),
  });

  test('serves the UI and the API', async () => {
    const page = await (await fetch(`${base}/strategy-tester`)).text();
    assert.match(page, /<div id="root">/);
    const me = await (await invoke('user', ['me'])).json();
    assert.equal(me.result.full_name, 'Http');
    const bad = await invoke('function', ['nope', {}]);
    assert.equal(bad.status, 500);
    assert.match((await bad.json()).error, /Unknown function/);
  });

  test('upload and download a file', async () => {
    const up = await fetch(`${base}/api/files?name=XAUUSD_M15.csv`, { method: 'POST', headers: { 'x-quantbot-upload': '1' }, body: 'time,open\n1,2' });
    const { file_uri } = await up.json();
    const down = await fetch(`${base}/api/files/${encodeURIComponent(file_uri.split('/').pop())}`);
    assert.equal(await down.text(), 'time,open\n1,2');
    assert.equal((await fetch(`${base}/api/files/missing.csv`)).status, 404);
  });

  test('rejects requests other websites could forge', async () => {
    assert.equal((await invoke('user', ['me'], { origin: 'https://evil.example' })).status, 403);
    // fetch won't forge Host, so send this one by hand (DNS rebinding: an outside name pointing at 127.0.0.1)
    const rebound = await new Promise((resolve, reject) => {
      const req = http.request({ port: app.port, path: '/api/invoke', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, resolve);
      req.on('error', reject);
      req.end(JSON.stringify({ kind: 'user', args: ['me'] }));
    });
    assert.equal(rebound.statusCode, 403);
    const plain = await fetch(`${base}/api/invoke`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"kind":"user","args":["me"]}' });
    assert.equal(plain.status, 415);
    assert.equal((await fetch(`${base}/api/files?name=a`, { method: 'POST', body: 'x' })).status, 400);
    assert.equal((await invoke('file', ['a.csv', [1, 2]])).status, 400);
  });
});

describe('API keys from an older version', () => {
  test('an unreadable saved key counts as not linked and gives a clear message', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-oldkey-'));
    // A keys.json the current secret can't decrypt (another format / another PC)
    fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ anthropic: { ciphertext: 'not-our-format', last4: '1234' } }));
    const cipher = createCipher(dir);
    const be = createBackend({ dataDir: dir, encrypt: cipher.encrypt, decrypt: cipher.decrypt, userName: 'T' });
    assert.deepEqual(be.handle('function', 'apiKeys', { action: 'status' }).anthropic, { linked: false, unreadable: true });
    be.handle('function', 'apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-new-key-5678' });
    assert.deepEqual(be.handle('function', 'apiKeys', { action: 'status' }).anthropic, { linked: true, last4: '5678' });
  });
});

describe('signals webhook', () => {
  let app, base, key;
  before(async () => {
    app = await startServer({ port: 0, dataDir: tmp(), userName: 'Signals' });
    base = `http://localhost:${app.port}`;
    key = (await (await fetch(`${base}/api/signals/config`)).json()).key;
  });
  after(() => app.close());
  const hook = (body, k = key, headers = {}) => fetch(`${base}/hook/${k}`, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body });
  const list = async () => (await (await fetch(`${base}/api/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'entity', args: ['Signal', 'filter', {}, 'created_date'] }) })).json()).result;

  test('a TradingView or MT5 message is checked, saved and tracked', async () => {
    assert.match(key, /^[0-9a-f]{32}$/);
    const msg = { qb: 1, event: 'buy', symbol: 'MNQ1!', tf: '5', price: '21450.25', sl: 21430, tp: 21490.5, qty: 3, trade_id: 'DOL-1', strategy: 'QuantBot DOL', source: 'tradingview', time: 1729000000000 };
    const res = await hook(JSON.stringify(msg));
    assert.equal(res.status, 200);
    await hook(JSON.stringify({ event: 'set_sl', symbol: 'MNQ1!', sl: 21450.25, trade_id: 'DOL-1', strategy: 'QuantBot DOL' }), key, { 'user-agent': 'MetaTrader 5 Terminal/5.0' });
    await hook(JSON.stringify({ event: 'close', symbol: 'MNQ1!', price: 21490.5, reason: 'tp', trade_id: 'DOL-1', strategy: 'QuantBot DOL' }));
    const rows = await list();
    assert.deepEqual(rows.map((r) => r.event), ['buy', 'set_sl', 'close']);
    assert.equal(rows[0].price, 21450.25); // numbers sent as strings are read as numbers
    assert.equal(rows[0].source, 'tradingview');
    assert.equal(rows[1].source, 'mt5');
    assert.equal(rows[2].reason, 'tp');
  });

  test('wrong key, wrong method and bad messages are refused', async () => {
    assert.equal((await hook('{"event":"buy"}', 'a'.repeat(32))).status, 404);
    assert.equal((await fetch(`${base}/hook/${key}`)).status, 404);
    assert.match((await (await hook('buy now')).json()).error, /must be JSON/);
    assert.match((await (await hook('{"event":"moon","symbol":"X"}')).json()).error, /Unknown event "moon"/);
    assert.match((await (await hook('{"event":"buy","symbol":"X"}')).json()).error, /buy needs a price/);
    assert.match((await (await hook('{"event":"set_tp","symbol":"X"}')).json()).error, /set_tp needs tp/);
  });

  test('the public link reaches the webhook but not the rest of the API; a new key stops the old address', async () => {
    const viaTunnel = (p, body) => new Promise((resolve, reject) => {
      const req = http.request({ port: app.port, path: p, method: 'POST', headers: { host: 'abc.trycloudflare.com', 'cf-connecting-ip': '1.2.3.4', 'content-type': 'application/json' } }, resolve);
      req.on('error', reject);
      req.end(body);
    });
    assert.equal((await viaTunnel(`/hook/${key}`, '{"event":"cancel","symbol":"MNQ1!","strategy":"S"}')).statusCode, 200);
    assert.equal((await list()).at(-1).source, 'tradingview'); // no source field, came through the tunnel
    assert.equal((await viaTunnel('/api/invoke', '{"kind":"user","args":["me"]}')).statusCode, 403);
    assert.equal((await viaTunnel('/api/signals/config', '')).statusCode, 403);
    await fetch(`${base}/api/signals/rotate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await hook('{"event":"cancel","symbol":"X"}')).status, 404);
  });
});
