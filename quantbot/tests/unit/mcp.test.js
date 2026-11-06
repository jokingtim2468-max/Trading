import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcp, cleanServer, toolName } from '../../server/lib/mcp.js';
import { createSkills, parseSkill } from '../../server/lib/skills.js';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'support', 'fakeMcp.mjs');

test('mcp: a stdio server is started, its tools listed and called', async () => {
  const servers = [cleanServer({ name: 'Calc', transport: 'stdio', command: process.execPath, args: [fake] })];
  const mcp = createMcp({ servers: () => servers });
  try {
    const tools = await mcp.tools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'mcp_calc_add');
    assert.match(tools[0].description, /^\[calc\] Add two numbers/);
    assert.equal(await mcp.run('mcp_calc_add', { a: 2, b: 3 }), '5');
    assert.equal(await mcp.run('mcp_calc_add', '{"a":1,"b":1}'), '2');
    assert.match(await mcp.run('mcp_calc_nope', {}), /Unknown MCP tool/);
    assert.deepEqual(mcp.status()[0], { name: 'calc', connected: true, tools: 1, error: null });
    const t = await mcp.test({ name: 'x', command: process.execPath, args: [fake] });
    assert.equal(t.tools[0].name, 'add');
  } finally { mcp.close(); }
});

test('mcp: a server that cannot start is reported, not thrown', async () => {
  const mcp = createMcp({ servers: () => [cleanServer({ name: 'bad', command: 'definitely-not-a-command-xyz' })] });
  try {
    assert.deepEqual(await mcp.tools(), []);
    assert.equal(mcp.status()[0].connected, false);
    assert.ok(mcp.status()[0].error);
  } finally { mcp.close(); }
});

test('mcp: settings are cleaned and tool names are safe', () => {
  assert.throws(() => cleanServer({ name: '' }), /name/);
  assert.throws(() => cleanServer({ name: 'a', transport: 'http', url: 'ftp://x' }), /URL/);
  assert.deepEqual(cleanServer({ name: 'My Files!', command: 'npx', args: '-y @mcp/fs C:/data' }).args, ['-y', '@mcp/fs', 'C:/data']);
  assert.equal(cleanServer({ name: 'My Files!', command: 'npx' }).name, 'my-files-');
  assert.equal(toolName('web', 'search.v2'), 'mcp_web_search_v2');
  assert.ok(toolName('x'.repeat(40), 'y'.repeat(40)).length <= 64);
});

test('mcp: http servers (JSON and event-stream answers)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const msg = JSON.parse(init.body); calls.push(msg.method);
    const headers = new Map([['mcp-session-id', 's1'], ['content-type', msg.method === 'tools/call' ? 'text/event-stream' : 'application/json']]);
    const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18' } : msg.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } : { content: [{ type: 'text', text: 'hi' }] };
    const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    return { ok: true, status: 200, headers: { get: (k) => headers.get(k) || null }, text: async () => (msg.method === 'tools/call' ? `event: message\ndata: ${body}\n\n` : body) };
  };
  const mcp = createMcp({ servers: () => [cleanServer({ name: 'web', transport: 'http', url: 'http://localhost:1/mcp' })], fetchImpl });
  assert.equal((await mcp.tools())[0].name, 'mcp_web_echo');
  assert.equal(await mcp.run('mcp_web_echo', {}), 'hi');
  assert.deepEqual(calls.slice(0, 3), ['initialize', 'notifications/initialized', 'tools/list']);
  mcp.close();
});

test('skills: built-in skills load, yours override and can be removed', () => {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-skills-'));
  const builtin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'skills');
  const s = createSkills({ builtinDir: builtin, userDir: user });
  const names = s.list().map((x) => x.name);
  for (const n of ['backtest-rules', 'mt5-data', 'prop-firm-rules', 'pine-v6', 'research-findings']) assert.ok(names.includes(n), n);
  for (const x of s.list()) assert.ok(x.description.length > 20, `${x.name} has a description`);
  assert.match(s.index(), /^- backtest-rules: /m);
  assert.match(s.load('backtest-rules'), /NEXT bar's OPEN/);
  assert.match(s.load('nope'), /No skill named/);
  s.save({ name: 'Backtest Rules', description: 'My own version', body: 'custom' });
  assert.equal(s.get('backtest-rules').source, 'yours');
  assert.equal(s.load('backtest-rules'), 'custom');
  s.remove('backtest-rules');
  assert.equal(s.get('backtest-rules').source, 'built-in');
  assert.throws(() => s.remove('pine-v6'), /Only your own/);
  assert.throws(() => s.save({ name: 'x', description: '' }), /description/);
  assert.deepEqual(parseSkill('no header', 'f'), { name: 'f', description: '', body: 'no header' });
});
