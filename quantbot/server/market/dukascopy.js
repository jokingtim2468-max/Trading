// Dukascopy's free historical candles (https://www.dukascopy.com). Each response is JSON with one base candle
// and delta-encoded columns, the same format the dukascopy-node library reads.
// QUANTBOT_DUKASCOPY_URL points requests at another server (the tests use a fake one).
const root = () => process.env.QUANTBOT_DUKASCOPY_URL || 'https://jetta.dukascopy.com/v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Dukascopy's candle API sits behind Amazon's bot check (AWS WAF): a plain request gets an empty 202 with
// x-amzn-waf-action: challenge until a real browser has run the check and holds its cookie. The desktop app plugs in
// Chromium's network stack (fetcher) and a hidden window that runs the check (solver); see desktop/main.mjs.
let fetcher = (url, init) => fetch(url, init);
let solver = null;
let solving = null;
let solved = false;
let note = () => {};
export function useBrowser({ fetch: browserFetch, solve, log }) {
  fetcher = browserFetch;
  solver = solve;
  if (log) note = log;
}
// Dukascopy rate-limits hard (429): requests go out one at a time, at least 250 ms apart (no gap for the tests' fake)
const gapMs = () => (process.env.QUANTBOT_DUKASCOPY_URL ? 0 : 250);
let queue = Promise.resolve();
let lastStart = 0;
function paced(fn) {
  const run = queue.then(async () => {
    if (solving) await solving.catch(() => {});
    const waitFor = lastStart + gapMs() - Date.now();
    if (waitFor > 0) await wait(waitFor);
    lastStart = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

// One check at a time: downloads wait for it, so no request goes out without the check's cookie (Dukascopy blocks
// an address after a few requests without it, the check page included)
const solveChallenge = (url) => {
  solving = solving || solver(url).then((ok) => {
    if (ok === false) throw new Error("Dukascopy's bot check did not clear. Wait a minute and try again.");
    solved = true;
  }).finally(() => { solving = null; });
  return solving;
};

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
  let checks = 0;
  // Pass the bot check before the first request rather than after a failed one
  if (solver && !solved) await solveChallenge(url);
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await wait(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    try {
      const res = await paced(() => fetcher(url, { signal: signal || AbortSignal.timeout(30000) }));
      if (res.status === 202 && res.headers.get('x-amzn-waf-action') === 'challenge') {
        if (!solver) throw new Error('Dukascopy now only answers browsers. Download market data from the QuantBot desktop app.');
        if (checks++ >= 3) throw new Error("Dukascopy's bot check did not clear. Try again in a minute.");
        await solveChallenge(url);
        attempt--; // run the check, then ask again straight away
        continue;
      }
      if (res.status === 404) return [];
      if (res.status === 200) {
        const text = await res.text();
        return text.trim() ? decodeCandles(JSON.parse(text)) : [];
      }
      lastError = `Dukascopy answered ${res.status}`;
      note(`market data: ${res.status} for ${url.replace(/^.*\/candles\//, '')}`);
      // Too many requests: wait as long as asked (or 5 s, doubling) before the next try
      if (res.status === 429) {
        const after = Number(res.headers.get('retry-after')) * 1000;
        await wait(Math.min(60000, after > 0 ? after : 5000 * 2 ** attempt));
      }
      if (![202, 408, 429].includes(res.status) && res.status < 500) break;
    } catch (e) {
      if (signal?.aborted || /^Dukascopy/.test(e.message)) throw e;
      lastError = e.message;
    }
  }
  throw new Error(`Could not download market data (${lastError}). Check your internet connection and try again.`);
}
