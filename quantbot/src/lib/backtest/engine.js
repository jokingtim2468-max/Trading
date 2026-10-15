import { createTA } from './indicators';

const MAX_LOTS = 100;
const HOUR = 3600000;
// Built-in market data is on broker server time (UTC+2, UTC+3 in US summer), which is New York time + 7 hours
const NY_OFFSET = 7 * HOUR;
const PROGRESS_EVERY = 1000;
const PROGRESS_MS = 250;

// Bar-by-bar simulator: signals on bar close, fills at next bar open, SL checked before TP intrabar.
// onProgress(done, total) is called every PROGRESS_EVERY bars or PROGRESS_MS, whichever comes first, so a slow strategy
// can be measured while it runs and a stuck one is caught on the bar it is stuck on.
export function runBacktest({ bars, startIndex, simCode, balance, contractSize, point }, onProgress = null) {
  const log = [];
  const add = (level, msg, t) => { if (log.length < 400) log.push({ level, msg, t }); };
  const addFinal = (level, msg) => log.push({ level, msg });
  let onBar;
  try { onBar = new Function('ctx', simCode); } catch (e) {
    add('error', `Simulation code does not compile: ${e.message}`);
    return { trades: [], equity: [], log, errors: 1 };
  }

  const n = bars.time.length;
  let i = startIndex;
  // ctx.count('label') tallies how many bars pass each entry condition, so a run with no trades shows which one never fires
  const counts = new Map();
  const count = (label) => {
    const k = String(label).slice(0, 40);
    if (counts.has(k) || counts.size < 30) counts.set(k, (counts.get(k) || 0) + 1);
  };
  const ctx = { ...bars, point, contractSize, state: {}, ta: createTA(bars, () => i), count };
  const trades = [], equity = [];
  const warned = new Set();
  const warnOnce = (key, msg, t) => { if (!warned.has(key)) { warned.add(key); add('warn', msg, t); } };
  let cash = balance, pos = null, pending = null, errors = 0;
  // Why a run has no trades: orders asked for, orders rejected, bars that errored
  const why = { orders: 0, badsl: 0 };
  let reported = 0;

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
    if (onProgress && ((i - startIndex) % PROGRESS_EVERY === 0 || Date.now() - reported > PROGRESS_MS)) {
      reported = Date.now();
      onProgress(i - startIndex, n - startIndex);
    }
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

    const d = new Date(t), ny = new Date(t - NY_OFFSET);
    Object.assign(ctx, {
      i, balance: cash, equity: eq, hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfWeek: d.getUTCDay(),
      nyHour: ny.getUTCHours(), nyMinute: ny.getUTCMinutes(), nyDayOfWeek: ny.getUTCDay(),
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
      why.orders++;
      if (pos && pos.side === side) continue;
      let lots = Number(sig.lots);
      if (!(lots > 0)) { lots = 0.1; warnOnce('lots', 'Order without a valid lot size: used 0.1 lots.', t); }
      if (lots > MAX_LOTS) { lots = MAX_LOTS; warnOnce('maxlots', `Lot size capped at ${MAX_LOTS}.`, t); }
      const sl = Number.isFinite(sig.sl) ? sig.sl : null;
      const tp = Number.isFinite(sig.tp) ? sig.tp : null;
      if (sl == null) warnOnce('nosl', 'A trade was opened without a stop loss.', t);
      if (sl != null && (side === 'long' ? sl >= c : sl <= c)) { why.badsl++; warnOnce('badsl', `Rejected ${side} order: stop loss on the wrong side of price.`, t); continue; }
      pending = { action: sig.action, lots: Math.round(lots * 100) / 100, sl, tp };
    }
  }

  // A trade still open at the end closes at the last bar's close (like MT5's tester), so the final balance and
  // the final equity agree
  if (pos) {
    const k = Math.min(i, n - 1);
    exitAt(k, pos.side === 'long' ? bars.close[k] : ask(k, bars.close[k]), 'end');
    if (equity.length) equity[equity.length - 1] = { ...equity[equity.length - 1], equity: cash, balance: cash };
  }
  const funnel = [...counts].map(([k, v]) => `${k} ${v.toLocaleString('en-US')}`).join(', ');
  if (funnel) addFinal('info', `Condition counts over ${(n - startIndex).toLocaleString('en-US')} bars: ${funnel}`);
  if (!trades.length) addFinal('warn', noTradesReason(why, errors, n - startIndex));
  return { trades, equity, log, errors, counts: Object.fromEntries(counts), orders: why.orders };
}

// One line on why a run took no trades, for the log and the fix prompt
function noTradesReason(why, errors, bars) {
  if (errors) return `No trades: the test code threw ${errors} runtime error${errors === 1 ? '' : 's'} (see the errors above).`;
  if (why.orders && why.badsl === why.orders) return `No trades: all ${why.orders} orders had the stop loss on the wrong side of price and were rejected.`;
  if (why.orders) return `No trades: ${why.orders} orders were asked for but none filled (${why.badsl} had the stop loss on the wrong side of price).`;
  return `No trades: the entry conditions never triggered in ${bars} bars. Check the session hours (bar times are broker server time, New York + 7h; use ctx.nyHour for New York sessions) and the filters.`;
}