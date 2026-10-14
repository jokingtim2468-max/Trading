const r2 = (v) => Math.round(v * 100) / 100;
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

// Quant profile of the trader's own candles, sent to the AI so stops, targets and session filters fit the real market
export function marketStats(bars) {
  const n = bars.time.length;
  if (n < 30) return null;
  const tr = [], spreads = [], days = {};
  const hours = Array.from({ length: 24 }, () => [0, 0]);
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(bars.high[i], bars.close[i - 1]) - Math.min(bars.low[i], bars.close[i - 1]));
    if (bars.spread?.[i]) spreads.push(bars.spread[i]);
    const d = new Date(bars.time[i]);
    const h = hours[d.getUTCHours()];
    h[0] += bars.high[i] - bars.low[i];
    h[1]++;
    const key = d.toISOString().slice(0, 10);
    const day = days[key] || (days[key] = [bars.high[i], bars.low[i]]);
    day[0] = Math.max(day[0], bars.high[i]);
    day[1] = Math.min(day[1], bars.low[i]);
  }
  const sorted = [...tr].sort((a, b) => a - b);
  const q = (p) => r2(sorted[Math.floor(p * (sorted.length - 1))]);
  return {
    bars: n,
    from: new Date(bars.time[0]).toISOString().slice(0, 10),
    to: new Date(bars.time[n - 1]).toISOString().slice(0, 10),
    barTrueRange: { median: q(0.5), p80: q(0.8), p95: q(0.95) },
    medianDailyRange: r2(median(Object.values(days).map(([hi, lo]) => hi - lo))),
    medianSpreadPoints: spreads.length ? median(spreads) : null,
    avgBarRangeByServerHour: hours.map(([sum, c]) => (c ? r2(sum / c) : null)),
    periodReturnPct: r2(((bars.close[n - 1] - bars.close[0]) / bars.close[0]) * 100),
  };
}