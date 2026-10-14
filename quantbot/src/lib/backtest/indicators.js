// Full-series indicators, computed once per (name, source, length) and read by index.
function sma(src, len) {
  const out = new Float64Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

function ema(src, len) {
  const out = new Float64Array(src.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    if (i === len - 1) { let s = 0; for (let j = 0; j < len; j++) s += src[j]; prev = s / len; }
    else if (i >= len) prev = src[i] * k + prev * (1 - k);
    out[i] = i >= len - 1 ? prev : NaN;
  }
  return out;
}

function wilder(values, len) {
  const out = new Float64Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === len - 1) { let s = 0; for (let j = 0; j < len; j++) s += values[j]; prev = s / len; }
    else if (i >= len) prev = (prev * (len - 1) + values[i]) / len;
    if (i >= len - 1) out[i] = prev;
  }
  return out;
}

function rsi(src, len) {
  const gains = new Float64Array(src.length), losses = new Float64Array(src.length);
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    gains[i] = Math.max(d, 0); losses[i] = Math.max(-d, 0);
  }
  const g = wilder(gains, len), l = wilder(losses, len);
  return g.map((v, i) => (l[i] === 0 ? 100 : 100 - 100 / (1 + v / l[i])));
}

function rolling(src, len, fn) {
  const out = new Float64Array(src.length).fill(NaN);
  for (let i = len - 1; i < src.length; i++) out[i] = fn(src.subarray(i - len + 1, i + 1));
  return out;
}

const stdevOf = (w) => { const m = w.reduce((a, b) => a + b, 0) / w.length; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length); };

export function createTA(bars, getIndex) {
  const names = new Map([[bars.close, 'close'], [bars.open, 'open'], [bars.high, 'high'], [bars.low, 'low'], [bars.volume, 'volume']]);
  const cache = new Map();
  const series = (key, build) => { if (!cache.has(key)) cache.set(key, build()); return cache.get(key); };
  const at = (arr, offset = 0) => { const j = getIndex() - offset; return j >= 0 ? arr[j] : NaN; };
  const keyed = (name, fn) => (src, len, offset) => {
    const s = names.get(src);
    if (!s) throw new Error(`ta.${name}: source must be ctx.close/open/high/low/volume`);
    return at(series(`${name}:${s}:${len}`, () => fn(src, Math.max(1, Math.floor(len)))), offset);
  };
  const tr = () => series('tr', () => bars.close.map((_, i) => (i === 0 ? bars.high[0] - bars.low[0]
    : Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - bars.close[i - 1]), Math.abs(bars.low[i] - bars.close[i - 1])))));
  return {
    sma: keyed('sma', sma),
    ema: keyed('ema', ema),
    rsi: keyed('rsi', rsi),
    highest: keyed('highest', (s, n) => rolling(s, n, (w) => Math.max(...w))),
    lowest: keyed('lowest', (s, n) => rolling(s, n, (w) => Math.min(...w))),
    stdev: keyed('stdev', (s, n) => rolling(s, n, stdevOf)),
    atr: (len, offset) => at(series(`atr:${len}`, () => wilder(tr(), Math.max(1, Math.floor(len)))), offset),
  };
}