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
    else if (i >= len && Number.isFinite(src[i])) prev = Number.isFinite(prev) ? src[i] * k + prev * (1 - k) : src[i];
    out[i] = i >= len - 1 ? prev : NaN;
  }
  return out;
}

function wilder(values, len) {
  const out = new Float64Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === len - 1) { let s = 0; for (let j = 0; j < len; j++) s += values[j]; prev = s / len; }
    else if (i >= len && Number.isFinite(values[i])) prev = Number.isFinite(prev) ? (prev * (len - 1) + values[i]) / len : values[i];
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

// Rolling max / min in one pass (monotonic queue), so long lookbacks cost the same as short ones
function extreme(src, len, better) {
  const out = new Float64Array(src.length).fill(NaN);
  const q = new Int32Array(src.length);
  let head = 0, tail = 0;
  for (let i = 0; i < src.length; i++) {
    while (tail > head && !better(src[q[tail - 1]], src[i])) tail--;
    q[tail++] = i;
    while (q[head] <= i - len) head++;
    if (i >= len - 1) out[i] = src[q[head]];
  }
  return out;
}

// Population standard deviation from running sums
function stdev(src, len) {
  const out = new Float64Array(src.length).fill(NaN);
  let sum = 0, sq = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i]; sq += src[i] * src[i];
    if (i >= len) { sum -= src[i - len]; sq -= src[i - len] * src[i - len]; }
    if (i >= len - 1) { const m = sum / len; out[i] = Math.sqrt(Math.max(0, sq / len - m * m)); }
  }
  return out;
}

// Pine's ta.pivothigh / ta.pivotlow: the pivot's price on the bar where it is confirmed (`right` bars after it), else NaN.
// Equal highs (lows) count once, on the first of them: beaten strictly on the left, at least matched on the right.
function pivot(src, left, right, isHigh) {
  const out = new Float64Array(src.length).fill(NaN);
  const beats = isHigh ? (a, b) => a > b : (a, b) => a < b;
  for (let i = left + right; i < src.length; i++) {
    const p = i - right, v = src[p];
    let ok = true;
    for (let j = p - left; ok && j < p; j++) if (!beats(v, src[j])) ok = false;
    for (let j = p + 1; ok && j <= p + right; j++) if (beats(src[j], v)) ok = false;
    if (ok) out[i] = v;
  }
  return out;
}

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
  const pivots = (name, src, left, right, offset, isHigh) => {
    const s = names.get(src);
    if (!s) throw new Error(`ta.${name}: source must be ctx.close/open/high/low/volume`);
    const l = Math.max(1, Math.floor(left)), r = Math.max(0, Math.floor(right ?? left));
    return at(series(`${name}:${s}:${l}:${r}`, () => pivot(src, l, r, isHigh)), offset);
  };
  const tr = () => series('tr', () => bars.close.map((_, i) => (i === 0 ? bars.high[0] - bars.low[0]
    : Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - bars.close[i - 1]), Math.abs(bars.low[i] - bars.close[i - 1])))));
  return {
    sma: keyed('sma', sma),
    ema: keyed('ema', ema),
    rsi: keyed('rsi', rsi),
    highest: keyed('highest', (s, n) => extreme(s, n, (a, b) => a > b)),
    lowest: keyed('lowest', (s, n) => extreme(s, n, (a, b) => a < b)),
    stdev: keyed('stdev', stdev),
    pivothigh: (src, left, right, offset) => pivots('pivothigh', src, left, right, offset, true),
    pivotlow: (src, left, right, offset) => pivots('pivotlow', src, left, right, offset, false),
    atr: (len, offset) => at(series(`atr:${len}`, () => wilder(tr(), Math.max(1, Math.floor(len)))), offset),
  };
}