// Bridge to MT5 terminals: the QuantBot Copier EA (mt5/QuantBotCopier.mq5) running on an account's MT5 terminal
// (this PC or the same VPS) asks every second for that account's orders and reports each fill back.
// Plain text so the EA needs no JSON parser:
//   poll -> one order per line: id|action|symbol|side|lots|sl|tp|tag|ticket   (action open / modify / close / close_part)
//   ack  <- one line per order:  id|ok|ticket|price|message                  (ok 1 or 0)
const RESEND_MS = 60000;
const MAX_TRIES = 5;
const num = (v) => (v == null || v === '' ? 0 : Number(v));

export const orderTag = (tradeId) => `QB${String(tradeId || '').slice(0, 24)}`;
export const orderLine = (o, ticket) => [o.id, o.action, o.symbol, o.side, o.lots, num(o.sl), num(o.tp), orderTag(o.trade_id), ticket || 0].join('|');

export function createMt5Bridge({ db, note = async () => {} }) {
  const run = async (...a) => db.run(...a);
  const seen = new Map();

  async function account(id) {
    try { return await run('TradingAccount', 'get', id); } catch { return null; }
  }

  async function poll(accountId, now = Date.now()) {
    const a = await account(accountId);
    if (!a || a.platform !== 'MT5') throw Object.assign(new Error('Not an MT5 account'), { status: 404 });
    if (now - (seen.get(a.id) || 0) > 20000) { seen.set(a.id, now); await run('TradingAccount', 'update', a.id, { mt5_seen_at: new Date(now).toISOString() }); }
    if (!a.mt5_on) return '';
    const orders = (await run('Mt5Order', 'filter', { account_id: a.id }, 'created_date'))
      .filter((o) => o.status === 'pending' || (o.status === 'sent' && now - Date.parse(o.sent_at) > RESEND_MS && (o.tries || 0) < MAX_TRIES));
    const lines = [];
    for (const o of orders) {
      // A modify / close needs the ticket of the open fill when there is one
      let ticket = o.ticket;
      if (!ticket && o.action !== 'open' && o.trade_id) { try { ticket = (await run('AccountTrade', 'get', o.trade_id)).mt5_ticket || ''; } catch { /* trade removed */ } }
      await run('Mt5Order', 'update', o.id, { status: 'sent', sent_at: new Date(now).toISOString(), tries: (o.tries || 0) + 1 });
      lines.push(orderLine(o, ticket));
    }
    return lines.join('\n');
  }

  async function ack(accountId, body) {
    const a = await account(accountId);
    if (!a) throw Object.assign(new Error('No such account'), { status: 404 });
    let done = 0;
    for (const line of String(body || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [id, ok, ticket, price, ...msg] = line.split('|');
      let o;
      try { o = await run('Mt5Order', 'get', id); } catch { continue; }
      if (o.account_id !== a.id) continue;
      const message = msg.join('|');
      const refs = { account_id: a.id, trade_id: o.trade_id };
      const name = a.display_name || a.label;
      if (ok === '1') {
        await run('Mt5Order', 'update', o.id, { status: 'done', ticket: ticket || o.ticket || '', fill_price: num(price) || null, done_at: new Date().toISOString(), error: '' });
        let signal = null;
        if (o.trade_id) {
          try {
            const t = await run('AccountTrade', 'get', o.trade_id);
            signal = o.action === 'close' ? t.exit : t.entry;
            if (o.action === 'open') await run('AccountTrade', 'update', t.id, { mt5_ticket: ticket || '', mt5_fill: num(price) || null, forwarded: `MT5 filled #${ticket}` });
          } catch { /* trade removed */ }
        }
        const slip = signal != null && num(price) ? Math.round((num(price) - signal) * 100) / 100 : null;
        await note('order', `${name}: MT5 ${o.action} ${o.action === 'open' ? `${o.side === 'long' ? 'buy' : 'sell'} ${o.lots} lots ` : ''}${o.symbol} done${ticket ? ` (#${ticket})` : ''}${num(price) ? ` at ${num(price)}` : ''}${slip != null ? `, ${slip >= 0 ? '+' : ''}${slip} from the signal price` : ''}${message ? `: ${message}` : ''}`, refs, { order: o.id, ticket, price: num(price), slip });
      } else {
        await run('Mt5Order', 'update', o.id, { status: 'failed', error: message || 'failed', done_at: new Date().toISOString() });
        await note('order', `${name}: MT5 ${o.action} ${o.symbol} failed: ${message || 'no reason given'}`, refs, { order: o.id, error: message }, 'error');
      }
      done++;
    }
    return done;
  }

  return { poll, ack };
}
