// Multi-broker MT5 accounts: mass add, encrypted passwords, and the auto-login daemon (with a fake MetaTrader5)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

// Runs a command without blocking this process (the QuantBot server under test answers it)
const runAsync = (cmd, args, opts) => new Promise((resolve) => {
  const p = spawn(cmd, args, opts);
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => p.kill(), 120000);
  p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
});
import { parseBulk, validateAccount, sanitizeResult } from '../../server/mt5daemon.js';
import { startServer } from '../../server/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-daemon-'));

describe('MT5 account rules', () => {
  test('bulk lines, validation and what the pages see', () => {
    const { rows, errors } = parseBulk('broker,account,password,server,capital,terminal\nFTMO, 5100901, pa,ss, FTMO-Server, 100000\n\n# note\nFundedNext;7001;pw;FundedNext-Server;50000;C:\\MT5\\FN1\\terminal64.exe\nFOREX.com\t123456\nbad');
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].broker_name, rows[0].account_number, rows[0].password, rows[0].server], ['FTMO', '5100901', 'pa', 'ss'], 'commas split fields');
    assert.equal(rows[1].terminal_path, 'C:\\MT5\\FN1\\terminal64.exe');
    assert.equal(errors.length, 2);
    assert.match(validateAccount({ broker_name: 'X', account_number: '12a', server: 'S' }), /digits/);
    assert.match(validateAccount({ broker_name: 'X', account_number: '1234', server: 'S', terminal_path: 'C:\\MT5' }), /terminal64\.exe/);
    assert.equal(validateAccount({ broker_name: 'X', account_number: '1234', server: 'S' }), null);
    assert.deepEqual(sanitizeResult({ items: [{ id: 'a', password_enc: 'x' }] }), { items: [{ id: 'a', has_password: true }] });
  });
});

describe('MT5 daemon', () => {
  let app, base, dir;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const inv = async (...args) => (await (await post('/api/invoke', { kind: 'entity', args })).json()).result;
  before(async () => {
    dir = tmp();
    app = await startServer({ port: 0, dataDir: dir, userName: 'D', newsFetch: async () => new Response('[]') });
    base = `http://127.0.0.1:${app.port}`;
  });
  after(() => app.close());

  test('mass add stores passwords encrypted, never shows them, and updates instead of duplicating', async () => {
    const bulk = [
      'FTMO,5100901,Secret-One!,FTMO-Server,100000,C:\\MT5\\FTMO1\\terminal64.exe',
      'FundedNext,7001,Secret-Two!,FundedNext-Server,50000,C:\\MT5\\FN1\\terminal64.exe',
      'FOREX.com,123456,Secret-Three!,FOREX.com-Live,10000,C:\\MT5\\FTMO1\\terminal64.exe',
      'Broken,12x,pw,S',
    ].join('\n');
    const { results } = await (await post('/api/mt5/accounts', { bulk })).json();
    assert.deepEqual(results.map((r) => r.action), ['added', 'added', 'added', 'error']);
    const accs = await inv('TradingAccount', 'filter', { platform: 'MT5' });
    assert.equal(accs.length, 3);
    assert.ok(accs.every((a) => a.has_password && !('password_enc' in a)), 'pages never get the password');
    assert.deepEqual(accs.map((a) => a.firm).sort(), ['FOREX.com', 'FTMO', 'FundedNext']);
    assert.equal(accs.find((a) => a.login === '5100901').capital, 100000);
    const onDisk = fs.readdirSync(path.join(dir, 'entities')).map((f) => fs.readFileSync(path.join(dir, 'entities', f), 'utf8')).join('');
    assert.ok(!onDisk.includes('Secret-One!'), 'password stored in plain text');
    const again = await (await post('/api/mt5/accounts', { accounts: [{ broker_name: 'FTMO', account_number: 5100901, password: 'Secret-New!', server: 'ftmo-server', capital: 200000 }] })).json();
    assert.equal(again.results[0].action, 'updated');
    assert.equal((await inv('TradingAccount', 'filter', { platform: 'MT5' })).length, 3);
    // A password can't be written through the generic API
    await inv('TradingAccount', 'update', accs[0].id, { password_enc: 'junk', label: 'Renamed' });
    const { token } = await (await fetch(`${base}/api/mt5/daemon`)).json();
    const daemonView = (await (await fetch(`${base}/daemon/accounts`, { headers: { 'x-quantbot-daemon': token } })).json()).accounts;
    assert.ok(daemonView.every((a) => a.password.startsWith('Secret-')), 'the daemon gets readable passwords');
    assert.equal(daemonView.find((a) => a.account_number === 5100901).password, 'Secret-New!');
  });

  test('the daemon endpoints need the token and answer only on this PC', async () => {
    assert.equal((await fetch(`${base}/daemon/accounts`)).status, 404);
    assert.equal((await fetch(`${base}/daemon/accounts`, { headers: { 'x-quantbot-daemon': 'f'.repeat(40) } })).status, 404);
    const { token } = await (await fetch(`${base}/api/mt5/daemon`)).json();
    assert.equal((await fetch(`${base}/daemon/accounts`, { headers: { 'x-quantbot-daemon': token, origin: 'https://evil.example' } })).status, 404);
    const script = await (await fetch(`${base}/api/mt5/daemon/script`)).text();
    assert.match(script, /class Supervisor/);
  });

  test('mt5_manager.py logs each account in from its own process and reports back; shared terminals and bad logins are reported', async (t) => {
    if (spawnSync('python3', ['--version']).status !== 0) { t.skip('no python3'); return; }
    const { token } = await (await fetch(`${base}/api/mt5/daemon`)).json();
    const calls = path.join(tmp(), 'calls.jsonl');
    fs.writeFileSync(calls, '');
    await post('/api/mt5/accounts', { accounts: [{ broker_name: 'Pepperstone', account_number: 8888, password: 'Bad-Pass', server: 'Pepperstone-Demo', terminal_path: 'C:\\MT5\\PEP\\terminal64.exe' }] });
    const res = await runAsync('python3', ['mt5/mt5_manager.py', '--url', base, '--token', token, '--once', '--log', ''], {
      env: { ...process.env, PYTHONPATH: path.resolve('tests/support/fake_mt5'), FAKE_MT5_CALLS: calls, FAKE_MT5_FAIL: '8888', FAKE_MT5_NO_ALGO: '7001' },
    });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const made = fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const logins = made.map((c) => c.login).sort((a, b) => a - b);
    assert.deepEqual(logins, [7001, 8888, 5100901], 'one login per account; the account sharing a terminal is refused');
    assert.equal(new Set(made.map((c) => c.pid)).size, 3, 'each account has its own process');
    assert.equal(made.find((c) => c.login === 5100901).path, 'C:\\MT5\\FTMO1\\terminal64.exe');
    assert.ok(made.every((c) => c.portable === true));
    assert.match(res.stdout, /Algo Trading is off in this terminal/);
    const accs = await inv('TradingAccount', 'filter', { platform: 'MT5' });
    const by = (n) => accs.find((a) => a.login === String(n));
    assert.equal(by(5100901).daemon_state, 'connected');
    assert.equal(by(5100901).broker_balance, 100901);
    assert.equal(by(7001).algo_trading, false);
    assert.equal(by(8888).daemon_state, 'error');
    assert.match(by(8888).daemon_error, /login failed: -6 Terminal: Authorization failed/);
    assert.equal(by(123456).daemon_state, 'error');
    assert.match(by(123456).daemon_error, /uses the same terminal as Renamed: give each account its own MT5 folder/);
    const status = await (await fetch(`${base}/api/mt5/daemon`)).json();
    assert.deepEqual([status.accounts, status.connected], [4, 2]);
  });
});
