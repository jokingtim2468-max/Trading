// Live and replay helpers for the Terminal: folding the latest minute candles into the chart's bars, and the
// practice trades of replay mode (stops and targets hit inside a bar, the stop first when both are)
export function mergeCandles(bars, candles, tfMs) {
  if (!bars || !candles?.length) return bars;
  const out = Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map((c) => [c, Array.from(bars[c])]));
  let changed = false;
  for (const c of candles) {
    const b = Math.floor(c.time / tfMs) * tfMs, L = out.time.length - 1;
    if (L >= 0 && b < out.time[L]) continue;
    if (L >= 0 && b === out.time[L]) {
      out.high[L] = Math.max(out.high[L], c.high); out.low[L] = Math.min(out.low[L], c.low); out.close[L] = c.close;
    } else {
      out.time.push(b); out.open.push(c.open); out.high.push(c.high); out.low.push(c.low); out.close.push(c.close);
    }
    changed = true;
  }
  return changed ? out : bars;
}

export const sliceBars = (bars, n) => (bars ? Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map((c) => [c, bars[c].slice(0, n)])) : bars);

const pnlOf = (t, price) => Math.round((price - t.entry) * (t.side === 'long' ? 1 : -1) * t.qty * t.point_value * 100) / 100;

// One replay bar for the open practice trades -> { open, closed } (closed ones get exit, pnl and reason)
export function stepPractice(open, bar) {
  const still = [], closed = [];
  for (const t0 of open) {
    let t = t0;
    const dir = t.side === 'long' ? 1 : -1;
    const worst = dir > 0 ? bar.low : bar.high, best = dir > 0 ? bar.high : bar.low;
    if (t.sl != null && (worst - t.sl) * dir <= 0) { closed.push({ ...t, exit: t.sl, pnl: pnlOf(t, t.sl), reason: 'stop' }); continue; }
    if (t.tp != null && (best - t.tp) * dir >= 0) { closed.push({ ...t, exit: t.tp, pnl: pnlOf(t, t.tp), reason: 'target' }); continue; }
    if (t.trail) {
      const sl = Math.round((bar.close - dir * t.trail) * 100) / 100;
      if (t.sl == null || (sl - t.sl) * dir > 0) t = { ...t, sl };
    }
    still.push(t);
  }
  return { open: still, closed };
}

export const closePractice = (t, price, reason = 'manual') => ({ ...t, exit: price, pnl: pnlOf(t, price), reason });
