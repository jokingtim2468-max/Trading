export function computeMetrics(trades, equity, startBalance, contractSize) {
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0), losses = pnls.filter((p) => p <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = -losses.reduce((a, b) => a + b, 0);
  const net = grossWin - grossLoss;

  let peak = startBalance, maxDD = 0, maxDDPct = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.max(maxDD, peak - p.equity);
    maxDDPct = Math.max(maxDDPct, ((peak - p.equity) / peak) * 100);
  }

  const daily = new Map();
  for (const p of equity) daily.set(Math.floor(p.t / 86400000), p.equity);
  const closes = [startBalance, ...daily.values()];
  const rets = closes.slice(1).map((v, k) => v / closes[k] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));

  let streak = 0, maxLossStreak = 0;
  for (const p of pnls) { streak = p <= 0 ? streak + 1 : 0; maxLossStreak = Math.max(maxLossStreak, streak); }

  const rs = trades.filter((t) => t.sl0 != null).map((t) => t.pnl / (Math.abs(t.entry - t.sl0) * t.lots * contractSize || 1));
  const longs = trades.filter((t) => t.side === 'long'), shorts = trades.filter((t) => t.side === 'short');
  const rate = (arr) => (arr.length ? (arr.filter((t) => t.pnl > 0).length / arr.length) * 100 : 0);

  return {
    net, returnPct: (net / startBalance) * 100, finalBalance: startBalance + net,
    trades: trades.length, winRate: rate(trades),
    profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
    avgWin: wins.length ? grossWin / wins.length : 0, avgLoss: losses.length ? -grossLoss / losses.length : 0,
    expectancy: trades.length ? net / trades.length : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    maxDD, maxDDPct, sharpe: sd ? (mean / sd) * Math.sqrt(252) : 0,
    largestWin: wins.length ? Math.max(...wins) : 0, largestLoss: losses.length ? Math.min(...losses) : 0,
    maxLossStreak, longs: longs.length, shorts: shorts.length, longWinRate: rate(longs), shortWinRate: rate(shorts),
    slHits: trades.filter((t) => t.reason === 'sl').length, tpHits: trades.filter((t) => t.reason === 'tp').length,
    avgHoldMins: trades.length ? trades.reduce((a, t) => a + (t.exitTime - t.entryTime), 0) / trades.length / 60000 : 0,
  };
}

// Keep charts light: at most `max` evenly spaced points
export function downsample(arr, max = 800) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, k) => arr[Math.floor(k * step)]).concat(arr[arr.length - 1]);
}