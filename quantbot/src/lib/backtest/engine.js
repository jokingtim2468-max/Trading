import { createTA } from './indicators';

const MAX_LOTS = 100;

// Bar-by-bar simulator: signals on bar close, fills at next bar open, SL checked before TP intrabar.
export function runBacktest({ bars, startIndex, simCode, balance, contractSize, point }) {
  const log = [];
  const add = (level, msg, t) => { if (log.length < 400) log.push({ level, msg, t }); };
  let onBar;
  try { onBar = new Function('ctx', simCode); } catch (e) {
    add('error', `Simulation code does not compile: ${e.message}`);
    return { trades: [], equity: [], log, errors: 1 };
  }

  const n = bars.time.length;
  let i = startIndex;
  const ctx = { ...bars, point, contractSize, state: {}, ta: createTA(bars, () => i) };
  const trades = [], equity = [];
  const warned = new Set();
  const warnOnce = (key, msg, t) => { if (!warned.has(key)) { warned.add(key); add('warn', msg, t); } };
  let cash = balance, pos = null, pending = null, errors = 0;

  const ask = (k, price) => price + bars.spread[k] * point;
  const exitAt = (k, price, reason) => {
    const dir = pos.side === 'long' ? 1 : -1;
    const pnl = (price - pos.entry) * dir * pos.lots * contractSize;
    cash += pnl;
    trades.push({ ...pos, exit: price, exitTime: bars.time[k], pnl, reason });
    add(pnl >= 0 ? 'info' : 'warn', `Closed ${pos.side} (${reason}) @ ${price.toFixed(2)}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`, bars.time[k]);
    pos = null;
  };
  const marketExit = (k, reason) => exitAt(k, pos.side === 'long' ? bars.open[k] : ask(k, bars.open[k]), reason);

  for (; i < n; i++) {
    const t = bars.time[i], o = bars.open[i], h = bars.high[i], l = bars.low[i], c = bars.close[i];

    if (pending) {
      if (pending.action === 'close' && pos) marketExit(i, 'signal');
      if (pending.action === 'buy' || pending.action === 'sell') {
        const side = pending.action === 'buy' ? 'long' : 'short';
        if (pos && pos.side !== side) marketExit(i, 'reverse');
        if (!pos) {
          const entry = side === 'long' ? ask(i, o) : o;
          pos = { side, entry, sl: pending.sl, tp: pending.tp, sl0: pending.sl, tp0: pending.tp, lots: pending.lots, entryTime: t, openIndex: i, mae: 0, mfe: 0 };
          add('info', `Opened ${side} ${pending.lots} lots @ ${entry.toFixed(2)} SL ${pending.sl?.toFixed(2) ?? 'none'} TP ${pending.tp?.toFixed(2) ?? 'none'}`, t);
        }
      }
      pending = null;
    }

    if (pos) {
      const long = pos.side === 'long';
      pos.mfe = Math.max(pos.mfe, long ? h - pos.entry : pos.entry - ask(i, l));
      pos.mae = Math.max(pos.mae, long ? pos.entry - l : ask(i, h) - pos.entry);
      if (long && pos.sl != null && l <= pos.sl) exitAt(i, Math.min(o, pos.sl), 'sl');
      else if (long && pos.tp != null && h >= pos.tp) exitAt(i, Math.max(o, pos.tp), 'tp');
      else if (!long && pos.sl != null && ask(i, h) >= pos.sl) exitAt(i, Math.max(ask(i, o), pos.sl), 'sl');
      else if (!long && pos.tp != null && ask(i, l) <= pos.tp) exitAt(i, Math.min(ask(i, o), pos.tp), 'tp');
    }

    const unreal = pos ? (pos.side === 'long' ? c - pos.entry : pos.entry - ask(i, c)) * pos.lots * contractSize : 0;
    const eq = cash + unreal;
    equity.push({ t, equity: eq, balance: cash });

    const d = new Date(t);
    Object.assign(ctx, {
      i, balance: cash, equity: eq, hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfWeek: d.getUTCDay(),
      position: pos ? { side: pos.side, entry: pos.entry, sl: pos.sl, tp: pos.tp, lots: pos.lots, barsOpen: i - pos.openIndex } : null,
    });

    let sig;
    try { sig = onBar(ctx); } catch (e) {
      errors++;
      if (errors <= 10) add('error', `Runtime error: ${e.message}`, t);
      if (errors >= 200) { add('error', 'Stopped: too many runtime errors.', t); break; }
      continue;
    }
    if (!sig || !sig.action) continue;

    if (sig.action === 'modify' && pos) {
      if (Number.isFinite(sig.sl)) pos.sl = sig.sl;
      if (Number.isFinite(sig.tp)) pos.tp = sig.tp;
    } else if (sig.action === 'close' && pos) {
      pending = { action: 'close' };
    } else if (sig.action === 'buy' || sig.action === 'sell') {
      const side = sig.action === 'buy' ? 'long' : 'short';
      if (pos && pos.side === side) continue;
      let lots = Number(sig.lots);
      if (!(lots > 0)) { lots = 0.1; warnOnce('lots', 'Order without a valid lot size: used 0.1 lots.', t); }
      if (lots > MAX_LOTS) { lots = MAX_LOTS; warnOnce('maxlots', `Lot size capped at ${MAX_LOTS}.`, t); }
      const sl = Number.isFinite(sig.sl) ? sig.sl : null;
      const tp = Number.isFinite(sig.tp) ? sig.tp : null;
      if (sl == null) warnOnce('nosl', 'A trade was opened without a stop loss.', t);
      if (sl != null && (side === 'long' ? sl >= c : sl <= c)) { warnOnce('badsl', `Rejected ${side} order: stop loss on the wrong side of price.`, t); continue; }
      pending = { action: sig.action, lots: Math.round(lots * 100) / 100, sl, tp };
    }
  }

  if (pos) marketExit(Math.min(i, n - 1), 'end');
  return { trades, equity, log, errors };
}