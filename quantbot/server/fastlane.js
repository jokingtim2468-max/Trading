// Fast lane to MT5: the QuantBot Copier EA keeps one TCP connection open to this PC (127.0.0.1, the app's port + 1)
// instead of asking every second over HTTP. Over it the EA streams its chart's live ticks, and QuantBot pushes each
// order the moment the app has checked it (no polling), then gets the fill back. Plain text lines:
//   EA -> app  H|<key>|<account id>              hello (the key and account from the Copier address)
//              T|<symbol>|<bid>|<ask>|<time ms>  a tick (MT5 server time)
//              A|<id>|<ok>|<ticket>|<price>|<msg> an order done (same as the HTTP ack line)
//   app -> EA  O|<id>|<action>|<symbol>|<side>|<lots>|<sl>|<tp>|<tag>|<ticket>   an order (same as the poll line)
// The HTTP poll stays as the fallback when the connection is down.
import net from 'node:net';
import { orderLine } from './mt5.js';

const now = () => process.hrtime.bigint();
const us = (from) => Number(now() - from) / 1000;

// Broker symbols ("XAUUSD.r", "GOLD", "USTEC") to the Terminal's
export function canonSymbol(s) {
  const u = String(s || '').toUpperCase();
  if (/XAU|GOLD/.test(u)) return 'XAUUSD';
  if (/US100|NAS100|USTEC|NDX|NQ/.test(u)) return 'US100';
  return u.replace(/[^A-Z0-9]/g, '');
}

export function createFastLane({ db, mt5, key, log = () => {}, onTick = () => {} }) {
  const run = async (...a) => db.run(...a);
  const socks = new Map(); // account id -> socket
  const sentAt = new Map(); // order id -> hrtime when pushed
  const ticks = new Map(); // symbol -> { bid, ask, time, at }
  const listeners = new Set();
  const emit = (type, data) => { for (const fn of listeners) { try { fn(type, data); } catch { /* closed stream */ } } };

  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    sock.setEncoding('utf8');
    let buf = '', account = null;
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
      if (buf.length > 65536) sock.destroy();
    });
    const drop = () => { if (account && socks.get(account) === sock) { socks.delete(account); log(`fast lane: ${account} disconnected`); emit('lane', { account, up: false }); } };
    sock.on('close', drop);
    sock.on('error', drop);

    function handle(line) {
      const f = line.split('|');
      if (f[0] === 'H') {
        if (f[1] !== key() || !f[2]) { sock.end('E|bad key\n'); return; }
        account = f[2];
        socks.get(account)?.destroy();
        socks.set(account, sock);
        sock.write('W|ok\n');
        log(`fast lane: ${account} connected`);
        emit('lane', { account, up: true });
        run('TradingAccount', 'update', account, { mt5_seen_at: new Date().toISOString(), fast_lane: true }).catch(() => {});
        // Orders that were waiting go out now
        run('Mt5Order', 'filter', { account_id: account, status: 'pending' }, 'created_date').then((list) => list.forEach((o) => push(o))).catch(() => {});
        return;
      }
      if (!account) return;
      if (f[0] === 'T') {
        const bid = Number(f[2]), ask = Number(f[3]);
        if (!(bid > 0 && ask > 0)) return;
        const t = { symbol: canonSymbol(f[1]), bid, ask, time: Number(f[4]) || Date.now(), at: Date.now() };
        ticks.set(t.symbol, t);
        emit('tick', t);
        onTick(t);
        return;
      }
      if (f[0] === 'A') {
        const id = f[1], t0 = sentAt.get(id);
        sentAt.delete(id);
        const ms = t0 ? Math.round(us(t0) / 10) / 100 : null;
        mt5.ack(account, f.slice(1).join('|')).then(() => {
          if (ms != null) run('Mt5Order', 'update', id, { fill_ms: ms }).catch(() => {});
          emit('fill', { account, order: id, ok: f[2] === '1', price: Number(f[4]) || null, ms, message: f.slice(5).join('|') });
        }).catch((e) => log(`fast lane ack: ${e.message}`));
      }
    }
  });

  // Push one order straight to its account's EA; -> microseconds from t0 (the app starting its checks) to the
  // order leaving for MT5, or null when the account has no fast lane (the HTTP poll picks it up)
  async function push(order, t0 = null) {
    const sock = socks.get(order.account_id);
    if (!sock || sock.destroyed) return null;
    let ticket = order.ticket;
    if (!ticket && order.action !== 'open' && order.trade_id) { try { ticket = (await run('AccountTrade', 'get', order.trade_id)).mt5_ticket || ''; } catch { /* trade removed */ } }
    sock.write(`O|${orderLine(order, ticket)}\n`);
    const took = t0 ? Math.round(us(t0)) : null;
    sentAt.set(order.id, now());
    run('Mt5Order', 'update', order.id, { status: 'sent', sent_at: new Date().toISOString(), tries: (order.tries || 0) + 1, via: 'fast lane', ...(took != null ? { push_us: took } : {}) }).catch(() => {});
    return took;
  }

  return {
    listen: (port) => new Promise((resolve) => {
      server.once('error', (e) => { log(`fast lane: port ${port} not available (${e.code}), MT5 falls back to polling`); resolve(null); });
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    }),
    close: () => new Promise((r) => { for (const s of socks.values()) s.destroy(); server.close(() => r()); }),
    push,
    connected: () => [...socks.keys()],
    tick: (symbol) => ticks.get(symbol) || null,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit,
    port: () => server.address()?.port ?? null,
  };
}
