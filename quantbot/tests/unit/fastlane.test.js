// The MT5 fast lane: a fake Copier EA on a socket gets orders pushed the moment the app has checked them, streams
// ticks that fill pending orders, and acks fills. The app's own time (checks to order sent) must stay under 1 ms.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startServer } from '../../server/index.js';
import { canonSymbol } from '../../server/fastlane.js';

let srv, base, dir;
before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-lane-')); srv = await startServer({ port: 0, dataDir: dir, quiet: true }); base = `http://127.0.0.1:${srv.port}`; });
after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const db = (...a) => srv.backend.handle('entity', ...a);

// A fake EA: lines in, a promise for the next line starting with a prefix
function fakeEa(port, key, account) {
  const sock = net.connect(port, '127.0.0.1');
  sock.setEncoding('utf8');
  let buf = '';
  const waiting = [];
  const lines = [];
  sock.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const w = waiting.findIndex((x) => line.startsWith(x.prefix));
      if (w >= 0) waiting.splice(w, 1)[0].resolve(line); else lines.push(line);
    }
  });
  const next = (prefix) => {
    const i = lines.findIndex((l) => l.startsWith(prefix));
    if (i >= 0) return Promise.resolve(lines.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { waiting.push({ prefix, resolve }); setTimeout(() => reject(new Error(`no ${prefix} line from the app`)), 3000).unref(); });
  };
  sock.write(`H|${key}|${account}\n`);
  const drain = () => lines.splice(0).filter((l) => l.startsWith('O|'));
  return { sock, next, drain, send: (l) => sock.write(`${l}\n`) };
}

test('broker symbols map to the Terminal ones', () => {
  assert.equal(canonSymbol('XAUUSD.r'), 'XAUUSD');
  assert.equal(canonSymbol('GOLD'), 'XAUUSD');
  assert.equal(canonSymbol('USTEC'), 'US100');
});

test('orders reach MT5 under 1 ms after the checks start, ticks fill pending orders, fills come back with times', async () => {
  const g = await db('CopyGroup', 'create', { name: 'Lane', enabled: true, blackout: { news: false } });
  const a = await db('TradingAccount', 'create', { label: 'FTMO lane', platform: 'MT5', mt5_on: true, group_id: g.id, status: 'active', start_balance: 100000, balance: 100000, max_loss: 10000, daily_loss: 5000 });
  const key = srv.signals.key();
  const ea = fakeEa(srv.lane.port(), key, a.id);
  assert.equal(await ea.next('W|'), 'W|ok');
  // Warm up once, then measure
  await post('/api/terminal/order', { event: 'buy', group_id: g.id, symbol: 'XAUUSD', price: 4715, sl: 4705, qty: 1 });
  let o = (await ea.next('O|')).split('|');
  ea.send(`A|${o[1]}|1|9001|4715.10|`);
  await post('/api/terminal/order', { event: 'close', group_id: g.id, symbol: 'XAUUSD', price: 4716 });
  o = (await ea.next('O|')).split('|');
  ea.send(`A|${o[1]}|1|9001|4716|`);

  const times = [];
  // 10 warm-up orders (the first orders after start run cold, before the JIT compiles the order path), then 20
  for (let i = 0; i < 30; i++) {
    const r = await post('/api/terminal/order', { event: i % 2 ? 'sell' : 'buy', group_id: g.id, symbol: 'XAUUSD', price: 4715, sl: i % 2 ? 4725 : 4705, qty: 1 });
    if (i >= 10) times.push(r.push_us);
    const lines = [await ea.next('O|')];
    if (i) lines.push(await ea.next('O|')); // the reverse also closes the previous trade
    for (const l of lines) { const f = l.split('|'); ea.send(`A|${f[1]}|1|${9100 + i}|4715|`); }
  }
  times.sort((x, y) => x - y);
  const median = times[10];
  console.log(`checks -> order sent to MT5: median ${median} µs, worst ${times.at(-1)} µs`);
  assert.ok(times.every((t) => typeof t === 'number'), 'every order went by the fast lane');
  assert.ok(median < 1000, `median ${median} µs is under 1 ms`);

  // The EA's ticks fill a pending buy limit at the ask, with no browser involved
  await post('/api/terminal/flatten', { price: 4715 });
  await new Promise((r) => setTimeout(r, 150));
  for (const l of ea.drain()) ea.send(`A|${l.split('|')[1]}|1|0|4715|`);
  const p = await post('/api/terminal/order', { event: 'buy_limit', group_id: g.id, symbol: 'XAUUSD', price: 4715, at: 4710, sl: 4700, qty: 1 });
  assert.ok(p.pending);
  ea.send('T|XAUUSD.r|4711.00|4711.30|1792300000000');
  ea.send('T|XAUUSD.r|4709.70|4709.95|1792300000500');
  const filled = (await ea.next('O|')).split('|');
  assert.deepEqual([filled[2], filled[4]], ['open', 'long']);
  ea.send(`A|${filled[1]}|1|9555|4709.95|`);
  await new Promise((r) => setTimeout(r, 50));
  const order = await db('Mt5Order', 'get', filled[1]);
  assert.equal(order.status, 'done');
  assert.equal(order.via, 'fast lane');
  assert.ok(order.fill_ms >= 0);
  const q = await (await fetch(`${base}/api/terminal/quote?symbol=XAUUSD`)).json();
  assert.equal(q.source, 'mt5');
  assert.equal(q.ask, 4709.95);
  ea.sock.destroy();
});
