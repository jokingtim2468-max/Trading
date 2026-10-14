// Downloads Dukascopy candles once and keeps them in data/market/<Dukascopy code>/<source>/ (US100 and NQ share
// the Nasdaq-100 files):
//   minute: one file per UTC month (built from daily requests), hour: one file per UTC year (monthly requests),
//   day: one file per UTC year (one request). Bid candles give the prices, ask candles the spread.
// Times are stored in broker server time. Files for a period still in progress are refreshed after an hour.
import fs from 'node:fs';
import path from 'node:path';
import { INSTRUMENTS, instrument, timeframe, firstDate, MAX_RANGE_DAYS } from './instruments.js';
import { candlesUrl, fetchCandles } from './dukascopy.js';
import { toBroker } from './brokerTime.js';
import { resample } from './resample.js';

const DAY = 86400000;
const REFRESH_MS = 3600000;
const PARALLEL = 6;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseDay = (s) => {
  const t = Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Bad date ${s}`);
  return t;
};

// Chunk = one stored file: its key and the UTC span it covers
function chunksBetween(source, fromMs, toMs) {
  const out = [];
  const d = new Date(fromMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  while (true) {
    const start = source === 'minute' ? Date.UTC(y, m, 1) : Date.UTC(y, 0, 1);
    if (start > toMs) break;
    const end = source === 'minute' ? Date.UTC(y, m + 1, 1) : Date.UTC(y + 1, 0, 1);
    out.push({ key: source === 'minute' ? `${y}-${String(m + 1).padStart(2, '0')}` : String(y), start, end });
    if (source === 'minute') { m++; if (m === 12) { m = 0; y++; } } else y++;
  }
  return out;
}

// Request dates inside a chunk: every day (minute), every month (hour) or the year itself (day)
function requestDates(source, chunk, firstMs, now) {
  const dates = [];
  if (source === 'minute') for (let t = chunk.start; t < chunk.end; t += DAY) dates.push(t);
  else if (source === 'hour') for (let mo = 0; mo < 12; mo++) dates.push(Date.UTC(new Date(chunk.start).getUTCFullYear(), mo, 1));
  else dates.push(chunk.start);
  const step = source === 'minute' ? DAY : source === 'hour' ? 31 * DAY : 366 * DAY;
  return dates.filter((t) => t + step > firstMs && t <= now);
}

// File: Float64 header [bars, complete, fetchedAt], Float64 times, Int32 prices and spread in steps of UNIT (exact),
// Float32 volume. Each market turns the steps into its own points when it reads them.
const UNIT = 0.001;
const INT_COLS = ['open', 'high', 'low', 'close', 'spread'];
function writeChunk(file, bars, complete) {
  const n = bars.time.length;
  const head = new Float64Array([n, complete ? 1 : 0, Date.now()]);
  const parts = [Buffer.from(head.buffer), Buffer.from(Float64Array.from(bars.time).buffer)];
  for (const k of INT_COLS) parts.push(Buffer.from(Int32Array.from(bars[k]).buffer));
  parts.push(Buffer.from(Float32Array.from(bars.volume).buffer));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, Buffer.concat(parts));
  fs.renameSync(`${file}.tmp`, file);
}

function readChunk(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const [n, complete, fetchedAt] = new Float64Array(ab, 0, 3);
  const bars = { time: new Float64Array(ab, 24, n) };
  let off = 24 + n * 8;
  for (const k of INT_COLS) { bars[k] = new Int32Array(ab, off, n); off += n * 4; }
  bars.volume = new Float32Array(ab, off, n);
  return { bars, complete: complete === 1, fetchedAt };
}

function chunkState(file, now) {
  if (!fs.existsSync(file)) return 'missing';
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(24);
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);
  const [, complete, fetchedAt] = new Float64Array(head.buffer, head.byteOffset, 3);
  return complete === 1 || now - fetchedAt < REFRESH_MS ? 'ready' : 'stale';
}

// Dukascopy's integer price steps -> whole MT5 points, in integer maths (half a point rounds up, never drifts)
export function toPoints(units, mult, point) {
  const ratio = point / mult;
  return ratio >= 1 ? Math.round(units / Math.round(ratio)) : units * Math.round(mult / point);
}

// Bid candles in UNIT steps, ask minus bid close as the spread in UNIT steps, times moved to broker time
function combine(bid, ask) {
  const askAt = new Map(ask.map((c) => [c.time, c]));
  const bars = { time: [], open: [], high: [], low: [], close: [], volume: [], spread: [] };
  let spread = 0;
  for (const c of bid.sort((a, b) => a.time - b.time)) {
    const [o, h, l, cl] = c.units.map((u) => toPoints(u, c.mult, UNIT));
    const a = askAt.get(c.time);
    if (a) spread = Math.max(0, toPoints(a.units[3], a.mult, UNIT) - cl);
    bars.time.push(toBroker(c.time));
    bars.open.push(o); bars.high.push(h); bars.low.push(l); bars.close.push(cl);
    bars.volume.push(c.volume); bars.spread.push(spread);
  }
  return bars;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export function createMarketStore(dataDir, { log = () => {} } = {}) {
  const dir = path.join(dataDir, 'market');
  const inflight = new Map();
  const jobs = new Map();
  let jobSeq = 0;
  const fileOf = (code, source, key) => path.join(dir, code, source, `${key}.bin`);

  async function downloadChunk(inst, source, chunk, onRequest) {
    const now = Date.now();
    const firstMs = parseDay(source === 'day' ? inst.dayStart : source === 'hour' ? inst.hourStart : inst.minuteStart);
    const dates = requestDates(source, chunk, firstMs, now);
    const fetchSide = (side) => mapLimit(dates, PARALLEL, async (t) => {
      const candles = await fetchCandles(candlesUrl(inst.code, side, source, t, now));
      onRequest();
      return candles;
    });
    const bid = (await fetchSide('BID')).flat();
    const ask = (await fetchSide('ASK')).flat();
    writeChunk(fileOf(inst.code, source, chunk.key), combine(bid, ask), chunk.end <= now - DAY);
  }

  // Makes sure every file a range needs is on disk; onProgress(done, total) counts web requests
  async function ensure(inst, sources, fromUtc, toUtc, onProgress = () => {}) {
    const now = Date.now();
    const todo = [];
    for (const { source, from, to } of sources) {
      for (const chunk of chunksBetween(source, from, to)) {
        if (chunkState(fileOf(inst.code, source, chunk.key), now) !== 'ready') todo.push({ source, chunk });
      }
    }
    const firstOf = (s) => parseDay(s === 'day' ? inst.dayStart : s === 'hour' ? inst.hourStart : inst.minuteStart);
    const total = todo.reduce((a, { source, chunk }) => a + 2 * requestDates(source, chunk, firstOf(source), now).length, 0);
    let done = 0;
    onProgress(done, total);
    for (const { source, chunk } of todo) {
      const id = `${inst.code}/${source}/${chunk.key}`;
      if (!inflight.has(id)) {
        inflight.set(id, downloadChunk(inst, source, chunk, () => onProgress(++done, total)).finally(() => inflight.delete(id)));
        await inflight.get(id);
      } else {
        await inflight.get(id);
        done += 2 * requestDates(source, chunk, firstOf(source), now).length;
        onProgress(done, total);
      }
    }
  }

  // Which stored sources cover a request, in UTC (padded a day for the broker-time shift)
  function plan(symbol, tf, from, to) {
    const inst = instrument(symbol);
    const tfName = String(tf).toUpperCase();
    const t = timeframe(tfName);
    const first = parseDay(firstDate(inst, tfName));
    const fromMs = Math.max(parseDay(from), first);
    const toMs = Math.min(parseDay(to) + DAY - 1, Date.now());
    if (fromMs > toMs) throw new Error(`No ${inst.symbol} data in that range (${tfName} data starts ${ymd(first)}).`);
    const maxDays = MAX_RANGE_DAYS[tfName];
    if (maxDays && toMs - fromMs > maxDays * DAY) throw new Error(`${tfName} tests can cover at most ${maxDays} days. Pick a shorter range or a higher timeframe.`);
    const sources = [];
    if (t.source === 'minute') sources.push({ source: 'minute', from: fromMs - DAY, to: toMs });
    else {
      const hourFirst = parseDay(inst.hourStart);
      if (tfName === 'D1' && fromMs < hourFirst) sources.push({ source: 'day', from: fromMs - DAY, to: Math.min(toMs, hourFirst) });
      if (toMs >= hourFirst) sources.push({ source: 'hour', from: Math.max(fromMs, hourFirst) - DAY, to: toMs });
    }
    return { inst, tfName, t, fromMs, toMs, sources };
  }

  function read(inst, source, fromMs, toMs) {
    const out = { time: [], open: [], high: [], low: [], close: [], volume: [], spread: [] };
    for (const chunk of chunksBetween(source, fromMs - DAY, toMs + DAY)) {
      const file = fileOf(inst.code, source, chunk.key);
      if (!fs.existsSync(file)) continue;
      const { bars } = readChunk(file);
      // Steps -> this market's points -> prices with exact decimals (1923.64, not 1923.6399999999999), as MT5 shows
      const decimals = (String(inst.point).split('.')[1] || '').length;
      const round = (units) => Number((toPoints(units, UNIT, inst.point) * inst.point).toFixed(decimals));
      const spreadOf = (units) => (inst.spreadPoints != null ? inst.spreadPoints : toPoints(units, UNIT, inst.point));
      for (let i = 0; i < bars.time.length; i++) {
        const t = bars.time[i];
        if (t < fromMs || t > toMs) continue;
        out.time.push(t);
        out.open.push(round(bars.open[i])); out.high.push(round(bars.high[i])); out.low.push(round(bars.low[i])); out.close.push(round(bars.close[i]));
        out.volume.push(bars.volume[i]); out.spread.push(spreadOf(bars.spread[i]));
      }
    }
    return out;
  }

  return {
    // Bars for a symbol / timeframe / date range (YYYY-MM-DD, broker-time days), downloading what's missing
    async bars(symbol, tf, from, to, onProgress) {
      const p = plan(symbol, tf, from, to);
      await ensure(p.inst, p.sources, p.fromMs, p.toMs, onProgress);
      // Range in broker time, 00:00 of the first day to 23:59 of the last. Daily bars only fill the years before
      // hourly data starts, so each source reads its own part of the range.
      const lo = parseDay(from), hi = parseDay(to) + DAY - 1;
      const hourFirst = parseDay(p.inst.hourStart);
      const merged = { time: [], open: [], high: [], low: [], close: [], volume: [], spread: [] };
      for (const { source } of p.sources) {
        const part = source === 'day' ? read(p.inst, source, lo, Math.min(hi, hourFirst - 1))
          : source === 'hour' ? read(p.inst, source, Math.max(lo, hourFirst), hi) : read(p.inst, source, lo, hi);
        for (const k of Object.keys(merged)) for (const v of part[k]) merged[k].push(v);
      }
      return resample(merged, p.t.minutes);
    },

    // Starts (or joins) a background download for a range so the UI can show progress
    prepare(symbol, tf, from, to) {
      const p = plan(symbol, tf, from, to);
      const id = String(++jobSeq);
      const job = { id, state: 'running', done: 0, total: 0, error: null };
      jobs.set(id, job);
      ensure(p.inst, p.sources, p.fromMs, p.toMs, (done, total) => Object.assign(job, { done, total }))
        .then(() => { job.state = 'done'; })
        .catch((e) => { log(`market download ${symbol} ${tf} ${from}..${to}: ${e.stack || e}`); Object.assign(job, { state: 'error', error: e.message }); });
      return { ...job };
    },

    job(id) {
      const job = jobs.get(String(id));
      if (!job) throw new Error('Unknown download');
      return { ...job };
    },

    // What's downloaded so far, per symbol and source
    info() {
      return Object.values(INSTRUMENTS).map((inst) => {
        const stored = {};
        for (const source of ['minute', 'hour', 'day']) {
          const d = path.join(dir, inst.code, source);
          const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.bin')).sort() : [];
          const bytes = files.reduce((a, f) => a + fs.statSync(path.join(d, f)).size, 0);
          stored[source] = { files: files.length, first: files[0]?.slice(0, -4) || null, last: files.at(-1)?.slice(0, -4) || null, mb: Math.round(bytes / 1e5) / 10 };
        }
        return { ...inst, stored };
      });
    },
  };
}

