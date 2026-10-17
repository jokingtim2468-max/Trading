// Money on a trade at a price: the price move from the entry (long: up is profit, short: down is profit) times the
// size and the instrument's dollar value per point, per account and across every account that copied it.
export function moveAt(trade, price) {
  const d = (Number(price) - Number(trade.entry)) * (trade.side === 'short' ? -1 : 1);
  return Math.round(d * 100) / 100;
}

export function moneyAt(trade, price, accounts = 1) {
  const per = moveAt(trade, price) * (Number(trade.qty) || 0) * (Number(trade.point_value) || 1);
  return { per: Math.round(per * 100) / 100, total: Math.round(per * accounts * 100) / 100 };
}

// "+$1,234.56" / "−$50.00": always the sign and cents
export function usdSigned(n) {
  const v = Math.round(Number(n) * 100) / 100;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}$${s}`;
}

// Open trades grouped by the order they came from (one line per order, however many accounts copied it)
export function groupTrades(positions) {
  const by = new Map();
  for (const t of positions) {
    const k = t.trade_id || t.id;
    if (!by.has(k)) by.set(k, { ...t, key: k, accounts: 0, trades: [] });
    const g = by.get(k);
    g.accounts++;
    g.trades.push(t);
  }
  return [...by.values()];
}
