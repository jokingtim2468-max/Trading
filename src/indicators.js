// Technical-analysis functions mirroring Pine Script's ta.* namespace.
// All take/return arrays aligned to the input, with NaN where undefined.

export function sma(src, len) {
  const out = new Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function ema(src, len) {
  const out = new Array(src.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(src[i])) continue;
    if (Number.isNaN(prev)) {
      if (i >= len - 1) prev = avg(src.slice(i - len + 1, i + 1));
    } else prev = src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rma(src, len) {
  const out = new Array(src.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(prev)) {
      if (i >= len - 1) prev = avg(src.slice(i - len + 1, i + 1));
    } else prev = (prev * (len - 1) + src[i]) / len;
    out[i] = prev;
  }
  return out;
}

export function wma(src, len) {
  const out = new Array(src.length).fill(NaN);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = 0; j < len; j++) s += src[i - j] * (len - j);
    out[i] = s / denom;
  }
  return out;
}

export function stdev(src, len) {
  const m = sma(src, len);
  return src.map((_, i) => {
    if (i < len - 1) return NaN;
    let s = 0;
    for (let j = 0; j < len; j++) s += (src[i - j] - m[i]) ** 2;
    return Math.sqrt(s / len);
  });
}

export function rsi(src, len) {
  const up = [0], dn = [0];
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    up.push(Math.max(d, 0));
    dn.push(Math.max(-d, 0));
  }
  const ru = rma(up.slice(1), len), rd = rma(dn.slice(1), len);
  return [NaN, ...ru.map((u, i) => (rd[i] === 0 ? 100 : 100 - 100 / (1 + u / rd[i])))];
}

export function macd(src, fast = 12, slow = 26, signal = 9) {
  const f = ema(src, fast), s = ema(src, slow);
  const line = f.map((v, i) => v - s[i]);
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const sig = new Array(src.length).fill(NaN);
  if (firstValid >= 0) ema(line.slice(firstValid), signal).forEach((v, i) => (sig[firstValid + i] = v));
  return { line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

export function bb(src, len = 20, mult = 2) {
  const basis = sma(src, len), dev = stdev(src, len);
  return { basis, upper: basis.map((b, i) => b + mult * dev[i]), lower: basis.map((b, i) => b - mult * dev[i]) };
}

export function tr(high, low, close) {
  return high.map((h, i) => (i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
}

export function atr(high, low, close, len = 14) {
  return rma(tr(high, low, close), len);
}

export function stoch(close, high, low, len) {
  return close.map((c, i) => {
    if (i < len - 1) return NaN;
    const hh = Math.max(...high.slice(i - len + 1, i + 1));
    const ll = Math.min(...low.slice(i - len + 1, i + 1));
    return hh === ll ? 50 : (100 * (c - ll)) / (hh - ll);
  });
}

export function vwap(high, low, close, volume) {
  let pv = 0, v = 0;
  return close.map((c, i) => {
    pv += ((high[i] + low[i] + c) / 3) * volume[i];
    v += volume[i];
    return v ? pv / v : NaN;
  });
}

export function highest(src, len) {
  return src.map((_, i) => (i < len - 1 ? NaN : Math.max(...src.slice(i - len + 1, i + 1))));
}
export function lowest(src, len) {
  return src.map((_, i) => (i < len - 1 ? NaN : Math.min(...src.slice(i - len + 1, i + 1))));
}

function avg(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

// Built-in indicator catalogue for the Indicators dialog.
export const BUILTINS = {
  'Moving Average (SMA)': { pane: 'main', params: { length: 20 }, calc: (b, p) => [{ name: `SMA ${p.length}`, data: sma(b.close, p.length), color: '#2962FF' }] },
  'Exponential Moving Average (EMA)': { pane: 'main', params: { length: 50 }, calc: (b, p) => [{ name: `EMA ${p.length}`, data: ema(b.close, p.length), color: '#FF6D00' }] },
  'Weighted Moving Average (WMA)': { pane: 'main', params: { length: 20 }, calc: (b, p) => [{ name: `WMA ${p.length}`, data: wma(b.close, p.length), color: '#AB47BC' }] },
  'Bollinger Bands': { pane: 'main', params: { length: 20, mult: 2 }, calc: (b, p) => { const r = bb(b.close, p.length, p.mult); return [ { name: 'Basis', data: r.basis, color: '#FF6D00' }, { name: 'Upper', data: r.upper, color: '#2962FF' }, { name: 'Lower', data: r.lower, color: '#2962FF' } ]; } },
  'VWAP': { pane: 'main', params: {}, calc: (b) => [{ name: 'VWAP', data: vwap(b.high, b.low, b.close, b.volume), color: '#00BCD4' }] },
  'Relative Strength Index (RSI)': { pane: 'sub', params: { length: 14 }, levels: [70, 30], calc: (b, p) => [{ name: `RSI ${p.length}`, data: rsi(b.close, p.length), color: '#7E57C2' }] },
  'MACD': { pane: 'sub', params: { fast: 12, slow: 26, signal: 9 }, calc: (b, p) => { const m = macd(b.close, p.fast, p.slow, p.signal); return [ { name: 'Histogram', data: m.hist, color: '#26A69A', type: 'histogram' }, { name: 'MACD', data: m.line, color: '#2962FF' }, { name: 'Signal', data: m.signal, color: '#FF6D00' } ]; } },
  'Average True Range (ATR)': { pane: 'sub', params: { length: 14 }, calc: (b, p) => [{ name: `ATR ${p.length}`, data: atr(b.high, b.low, b.close, p.length), color: '#B71C1C' }] },
  'Stochastic': { pane: 'sub', params: { k: 14, smooth: 3, d: 3 }, levels: [80, 20], calc: (b, p) => { const k = sma(stoch(b.close, b.high, b.low, p.k), p.smooth); return [ { name: '%K', data: k, color: '#2962FF' }, { name: '%D', data: sma(k.map((v) => (Number.isNaN(v) ? 0 : v)), p.d).map((v, i) => (Number.isNaN(k[i]) ? NaN : v)), color: '#FF6D00' } ]; } },
};
