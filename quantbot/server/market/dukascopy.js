// Dukascopy's free historical candles (https://www.dukascopy.com). Each response is JSON with one base candle
// and delta-encoded columns, the same format the dukascopy-node library reads.
// QUANTBOT_DUKASCOPY_URL points requests at another server (the tests use a fake one).
const root = () => process.env.QUANTBOT_DUKASCOPY_URL || 'https://jetta.dukascopy.com/v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Completed periods have fixed URLs; the period still in progress is read with ?from=<start ms>
export function candlesUrl(code, side, period, date, now = Date.now()) {
  const d = new Date(date);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  const start = period === 'minute' ? Date.UTC(y, m - 1, day) : period === 'hour' ? Date.UTC(y, m - 1, 1) : Date.UTC(y, 0, 1);
  const end = period === 'minute' ? Date.UTC(y, m - 1, day + 1) : period === 'hour' ? Date.UTC(y, m, 1) : Date.UTC(y + 1, 0, 1);
  const base = `${root()}/candles/${period}/${code}/${side}`;
  if (end > now) return `${base}?from=${start}`;
  return period === 'minute' ? `${base}/${y}/${m}/${day}` : period === 'hour' ? `${base}/${y}/${m}` : `${base}/${y}`;
}

// -> [{ time (UTC ms), open, high, low, close, volume, units, mult }] for every real candle (gaps are skipped, not
// filled). units are the exact integer prices [open, high, low, close] in steps of mult.
export function decodeCandles(data) {
  if (!data || !Array.isArray(data.times)) throw new Error('Unexpected data from Dukascopy');
  const n = data.times.length;
  if (!n) return [];
  const mult = Number(data.multiplier);
  if (!(mult > 0) || !(data.shift > 0)) throw new Error('Unexpected data from Dukascopy');
  let t = data.timestamp;
  let o = Math.round(data.open / mult), h = Math.round(data.high / mult), l = Math.round(data.low / mult), c = Math.round(data.close / mult);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    t += data.times[i] * data.shift;
    o += data.opens[i];
    h += data.highs[i];
    l += data.lows[i];
    c += data.closes[i];
    out[i] = { time: t, open: o * mult, high: h * mult, low: l * mult, close: c * mult, volume: data.volumes[i], units: [o, h, l, c], mult };
  }
  return out;
}

// Busy answers (202 still preparing, 429 too many requests, 5xx) are retried with backoff; 404 means no data
export async function fetchCandles(url, { retries = 6, signal } = {}) {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await wait(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { signal: signal || AbortSignal.timeout(30000) });
      if (res.status === 404) return [];
      if (res.status === 200) {
        const text = await res.text();
        return text.trim() ? decodeCandles(JSON.parse(text)) : [];
      }
      lastError = `Dukascopy answered ${res.status}`;
      if (![202, 408, 429].includes(res.status) && res.status < 500) break;
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e.message;
    }
  }
  throw new Error(`Could not download market data (${lastError}). Check your internet connection and try again.`);
}
