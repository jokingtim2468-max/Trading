// Signals sent by scripts (TradingView alerts, MT5 EAs) to QuantBot's webhook: labels, and the positions they describe

export const EVENT_LABELS = {
  buy: 'BUY', sell: 'SELL', buy_limit: 'BUY LIMIT', sell_limit: 'SELL LIMIT', cancel: 'CANCEL',
  set_sl: 'SET SL', set_tp: 'SET TP', close: 'CLOSE',
};
export const EVENT_TONES = {
  buy: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  sell: 'text-red-400 bg-red-500/10 border-red-500/30',
  buy_limit: 'text-emerald-300 bg-emerald-500/5 border-emerald-500/20',
  sell_limit: 'text-red-300 bg-red-500/5 border-red-500/20',
  cancel: 'text-muted-foreground bg-muted border-border',
  set_sl: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  set_tp: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  close: 'text-foreground bg-accent border-border',
};
export const FILTERS = [
  { id: 'all', label: 'All', events: null },
  { id: 'entries', label: 'Entries', events: ['buy', 'sell', 'buy_limit', 'sell_limit', 'cancel'] },
  { id: 'stops', label: 'SL / TP moves', events: ['set_sl', 'set_tp'] },
  { id: 'closes', label: 'Closes', events: ['close'] },
];

export const price = (v) => (v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 5 }));

// One line a trader reads in a notification
export function signalText(s) {
  const bits = [EVENT_LABELS[s.event] || s.event, s.qty != null && `${s.qty}`, s.symbol];
  if (s.price != null) bits.push(`@ ${price(s.price)}`);
  if (s.event !== 'set_tp' && s.sl != null) bits.push(`SL ${price(s.sl)}`);
  if (s.event !== 'set_sl' && s.tp != null) bits.push(`TP ${price(s.tp)}`);
  if (s.reason) bits.push(`(${s.reason})`);
  return bits.filter(Boolean).join(' ');
}

// Open positions and pending orders, per strategy and symbol, from signals in the order they arrived
export function positionsFrom(signals) {
  const book = new Map();
  const sorted = [...signals].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)));
  for (const s of sorted) {
    const key = `${s.strategy}|${s.symbol}`;
    const cur = book.get(key);
    const at = s.created_date;
    if (s.event === 'buy' || s.event === 'sell') {
      book.set(key, { key, strategy: s.strategy, symbol: s.symbol, side: s.event === 'buy' ? 'long' : 'short', status: 'open', entry: s.price, sl: s.sl, tp: s.tp, qty: s.qty, trade_id: s.trade_id, since: at, last: at });
    } else if (s.event === 'buy_limit' || s.event === 'sell_limit') {
      if (cur?.status === 'open') continue;
      book.set(key, { key, strategy: s.strategy, symbol: s.symbol, side: s.event === 'buy_limit' ? 'long' : 'short', status: 'pending', entry: s.price, sl: s.sl, tp: s.tp, qty: s.qty, trade_id: s.trade_id, since: at, last: at });
    } else if (cur && (!s.trade_id || !cur.trade_id || s.trade_id === cur.trade_id)) {
      if (s.event === 'set_sl') book.set(key, { ...cur, sl: s.sl, last: at });
      else if (s.event === 'set_tp') book.set(key, { ...cur, tp: s.tp, last: at });
      else if (s.event === 'cancel' && cur.status === 'pending') book.delete(key);
      else if (s.event === 'close' && cur.status === 'open') book.delete(key);
    }
  }
  return [...book.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
}
