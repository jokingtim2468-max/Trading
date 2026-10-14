// Groups bars into larger ones on broker-time boundaries (H4 at 00/04/08..., D1 at 00:00 server time).
// The spread of a bar is the spread at its open, where the tester fills orders.
// -> Float64Array columns, ready to send to the UI
export function resample(bars, minutes) {
  const n = bars.time.length;
  const size = minutes * 60000;
  const out = { time: [], open: [], high: [], low: [], close: [], volume: [], spread: [] };
  let bucket = null, k = -1;
  for (let i = 0; i < n; i++) {
    const b = Math.floor(bars.time[i] / size);
    if (b !== bucket) {
      bucket = b;
      k++;
      out.time.push(b * size);
      out.open.push(bars.open[i]);
      out.high.push(bars.high[i]);
      out.low.push(bars.low[i]);
      out.close.push(bars.close[i]);
      out.volume.push(bars.volume[i]);
      out.spread.push(bars.spread[i]);
    } else {
      if (bars.high[i] > out.high[k]) out.high[k] = bars.high[i];
      if (bars.low[i] < out.low[k]) out.low[k] = bars.low[i];
      out.close[k] = bars.close[i];
      out.volume[k] += bars.volume[i];
    }
  }
  return Object.fromEntries(Object.entries(out).map(([key, v]) => [key, Float64Array.from(v)]));
}

// One binary body: [bars, then each column] as Float64, in this order
export const COLUMNS = ['time', 'open', 'high', 'low', 'close', 'volume', 'spread'];

export function encodeBars(bars) {
  const n = bars.time.length;
  const buf = new Float64Array(1 + COLUMNS.length * n);
  buf[0] = n;
  COLUMNS.forEach((c, j) => buf.set(bars[c], 1 + j * n));
  return Buffer.from(buf.buffer);
}
