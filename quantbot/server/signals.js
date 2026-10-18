// QuantBot's webhook: TradingView alerts (through the desktop app's public link) and MT5 EAs on this PC post
// signals to /hook/<key>. Each one is checked, saved as a Signal and written to the app log.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SIGNAL_EVENTS, CLOSE_REASONS } from './lib/signals.js';

const MAX_PER_MINUTE = 60;
const KEEP = 5000;
const SOURCES = new Set(['tradingview', 'mt5', 'test', 'other']);

const text = (v, n) => (v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n));
const num = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// A message -> a Signal record, or throws with what's wrong
export function readSignal(body, { userAgent = '', local = true } = {}) {
  let m;
  try { m = JSON.parse(body); } catch { throw new Error('The message must be JSON, e.g. {"event":"buy","symbol":"MNQ1!","price":21450.25,...}'); }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('The message must be a JSON object');
  const event = text(m.event, 20).toLowerCase();
  if (!SIGNAL_EVENTS.includes(event)) throw new Error(`Unknown event "${event}". Use one of: ${SIGNAL_EVENTS.join(', ')}`);
  const symbol = text(m.symbol, 30);
  if (!symbol) throw new Error('symbol is missing');
  const rec = {
    event, symbol,
    tf: text(m.tf, 10),
    price: num(m.price), sl: num(m.sl), tp: num(m.tp), qty: num(m.qty),
    reason: text(m.reason, 20).toLowerCase(),
    strategy: text(m.strategy, 60) || 'Unnamed strategy',
    trade_id: text(m.trade_id ?? m.id, 60),
    bar_time: num(m.time),
    ...(num(m.risk_usd) > 0 ? { risk_usd: num(m.risk_usd) } : {}),
    ...(num(m.fraction) > 0 && num(m.fraction) < 1 ? { fraction: num(m.fraction) } : {}),
    raw: String(body).slice(0, 2000),
  };
  if (['buy', 'sell', 'buy_limit', 'sell_limit', 'close'].includes(event) && rec.price == null) throw new Error(`${event} needs a price`);
  if (event === 'set_sl' && rec.sl == null) throw new Error('set_sl needs sl');
  if (event === 'set_tp' && rec.tp == null) throw new Error('set_tp needs tp');
  if (rec.qty != null && rec.qty < 0) throw new Error('qty must be positive');
  if (event === 'close' && rec.reason && !CLOSE_REASONS.includes(rec.reason)) rec.reason = 'signal';
  const src = text(m.source, 20).toLowerCase();
  rec.source = SOURCES.has(src) ? src : /metatrader/i.test(userAgent) ? 'mt5' : !local ? 'tradingview' : 'other';
  return rec;
}

// One line for the log file
export const signalLine = (s) => [
  `signal ${s.event.toUpperCase()} ${s.symbol}`,
  s.qty != null && `x${s.qty}`,
  s.price != null && `@ ${s.price}`,
  s.sl != null && `SL ${s.sl}`,
  s.tp != null && `TP ${s.tp}`,
  s.reason && `(${s.reason})`,
  `[${s.strategy}${s.trade_id ? ` ${s.trade_id}` : ''}, ${s.source}]`,
].filter(Boolean).join(' ');

export function createSignals({ dataDir, db, log = () => {}, copier = null }) {
  const file = path.join(dataDir, 'webhook.json');
  let key;
  try { key = JSON.parse(fs.readFileSync(file, 'utf8')).key; } catch { /* first run */ }
  const newKey = () => {
    key = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(file, JSON.stringify({ key }));
    return key;
  };
  if (!/^[0-9a-f]{32}$/.test(key || '')) newKey();
  let window = { start: 0, count: 0 };

  return {
    key: () => key,
    rotate: newKey,
    // True when the path's key is this PC's key (constant-time compare)
    matches(candidate) {
      const a = Buffer.from(String(candidate)), b = Buffer.from(key);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    // meta.scriptId: the script named in the webhook path (/hook/<key>/s/<scriptId>)
    async receive(body, meta = {}) {
      const now = Date.now();
      if (now - window.start > 60000) window = { start: now, count: 0 };
      if (++window.count > MAX_PER_MINUTE) throw Object.assign(new Error('Too many signals this minute'), { status: 429 });
      const rec = readSignal(body, meta);
      const saved = await db.run('Signal', 'create', { ...rec, ...(meta.scriptId ? { script_id: meta.scriptId } : {}) });
      log(signalLine(saved));
      if (copier) {
        try {
          const r = await copier.onSignal(saved, meta.scriptId, { groupId: meta.groupId, t0: meta.t0 });
          Object.defineProperty(saved, 'copied', { value: r.accounts, enumerable: false });
          Object.defineProperty(saved, 'pushed', { value: r.pushed || [], enumerable: false });
          if (r.script) log(`copy: ${saved.event} from ${r.script} -> ${r.accounts} account trade${r.accounts === 1 ? '' : 's'}`);
        } catch (e) { log(`copy failed: ${e.stack || e.message}`); }
      }
      const total = await db.run('Signal', 'count', {});
      if (total > KEEP + 500) {
        const old = await db.run('Signal', 'filter', {}, 'created_date', total - KEEP);
        await db.run('Signal', 'deleteMany', { id: { $in: old.map((s) => s.id) } });
      }
      return saved;
    },
  };
}
