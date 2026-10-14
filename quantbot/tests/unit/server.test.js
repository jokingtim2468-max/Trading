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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-test-'));
const ENTITIES = path.resolve('server/entities');

function backendIn(dir) {
  const c = createCipher(dir);
  return createBackend({ dataDir: dir, encrypt: c.encrypt, decrypt: c.decrypt, userName: 'Tester', defaults: entityDefaults(ENTITIES) });
}

// Replaces fetch for one call so AI functions run without a real model
function fakeModel(reply, check) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    globalThis.fetch = real;
    check?.(String(url), JSON.parse(init.body), init.headers);
    if (String(url).includes('generativelanguage')) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }));
    }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: reply }] }));
  };
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
    assert.equal(fs.statSync(path.join(dir, 'secret.key')).mode & 0o077, 0, 'secret file is owner-only');
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

describe('AI functions', () => {
  test('chat needs a key, then replies and names the chat after the script', async () => {
    const be = backendIn(tmp());
    const s = be.handle('entity', 'ChatSession', 'create', { title: 'New chat', group: 'MT5' });
    be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'Build a gold scalper' });
    await assert.rejects(be.handle('function', 'quantChat', { session_id: s.id, style: 'Concise', model: 'builtin' }), /Add a Claude or Gemini API key/);

    be.handle('function', 'apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-test0001' });
    let sent;
    fakeModel('Here it is\n```mql5\n// Script: Gold Scalper\nvoid OnTick(){}\n```', (url, body, headers) => { sent = { url, body, headers }; });
    const { message } = await be.handle('function', 'quantChat', { session_id: s.id, style: 'Concise', model: 'builtin' });
    assert.match(sent.url, /api\.anthropic\.com\/v1\/messages$/);
    assert.equal(sent.headers['x-api-key'], 'sk-ant-test0001');
    assert.equal(sent.body.model, 'claude-opus-5-5', 'Auto uses the default Claude model');
    assert.equal(sent.body.fallbacks, 'default', 'Opus 5.5 opts into server-side fallback');
    assert.equal(sent.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.match(sent.body.system, /The trader's name is Tester/);
    assert.equal(message.role, 'assistant');
    assert.equal(be.handle('entity', 'ChatSession', 'get', s.id).title, 'Gold Scalper');
  });

  test('a refusal becomes a clear error', async () => {
    const be = backendIn(tmp());
    be.handle('function', 'apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-test0001' });
    const real = globalThis.fetch;
    globalThis.fetch = async () => { globalThis.fetch = real; return new Response(JSON.stringify({ content: [], stop_reason: 'refusal', stop_details: { explanation: 'policy' } })); };
    await assert.rejects(be.handle('function', 'scriptTester', { code: 'x', language: 'MT5', model: 'claude-haiku-5-5' }), /declined this request: policy/);
  });

  test('local model through Ollama', async () => {
    const be = backendIn(tmp());
    await assert.rejects(be.handle('function', 'quantChat', { session_id: 'x', model: 'local' }), /not found|Set up your local model/);
    await assert.rejects(be.handle('function', 'localModel', { action: 'save', url: 'ftp://x', model: 'm' }), /http/);
    const ollama = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
        const b = JSON.parse(body);
        res.end(JSON.stringify({ message: { role: 'assistant', content: `${b.model} ctx ${b.options.num_ctx} sys ${b.messages[0].role}` } }));
      });
    });
    await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${ollama.address().port}`;
    try {
      assert.deepEqual(await be.handle('function', 'localModel', { action: 'test', url }), { models: ['qwen2.5-coder:7b'] });
      await be.handle('function', 'localModel', { action: 'save', url: `${url}/`, model: 'qwen2.5-coder:7b' });
      const s = be.handle('entity', 'ChatSession', 'create', { title: 'x' });
      be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'hi' });
      const { message } = await be.handle('function', 'quantChat', { session_id: s.id, model: 'builtin' });
      assert.equal(message.content, 'qwen2.5-coder:7b ctx 32768 sys system', 'Auto falls back to the local model when no key is linked');
    } finally {
      await new Promise((r) => ollama.close(r));
    }
    await assert.rejects(be.handle('function', 'localModel', { action: 'test', url }), /Ollama is not running/);
  });

  test('Gemini key is used when chosen', async () => {
    const be = backendIn(tmp());
    be.handle('function', 'apiKeys', { action: 'save', provider: 'google', api_key: 'AIzaTestKey9' });
    const s = be.handle('entity', 'ChatSession', 'create', { title: 'x' });
    be.handle('entity', 'ChatMessage', 'create', { session_id: s.id, role: 'user', content: 'hi' });
    let url;
    fakeModel('hello', (u) => { url = u; });
    const { message } = await be.handle('function', 'quantChat', { session_id: s.id, model: 'gemini-3.8-flash' });
    assert.match(url, /generativelanguage.*gemini-3\.8-flash:generateContent/);
    assert.equal(message.content, 'hello');
  });

  test('converter and tester parse the model JSON', async () => {
    const be = backendIn(tmp());
    be.handle('function', 'apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-test0001' });
    await assert.rejects(be.handle('function', 'strategyTester', { strategy: '', target: 'MT5' }), /Paste a strategy/);

    fakeModel('```json\n{"code":"//ea","sim_code":"return null;","summary":"s","results":[{"rule":"r","status":"pass","detail":"d"}]}\n```');
    const conv = await be.handle('function', 'strategyTester', { strategy: 'buy dips', rules: '', target: 'MT5', model: 'claude-sonnet-4-5' });
    assert.deepEqual(conv, { code: '//ea', sim_code: 'return null;', summary: 's', results: [{ rule: 'r', status: 'pass', detail: 'd' }] });

    fakeModel('{"sim_code":"return null;\n","summary":"ok","rules":["one"]}');
    const t = await be.handle('function', 'scriptTester', { code: '//@version=5', language: 'Pine', model: 'builtin' });
    assert.equal(t.sim_code, 'return null;\n', 'raw line breaks inside strings are repaired');
    assert.deepEqual(t.settings, { balance: 10000 });

    fakeModel('{"summary":"no sim"}');
    await assert.rejects(be.handle('function', 'scriptTester', { code: 'x', language: 'MT5' }), /could not translate/);
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
