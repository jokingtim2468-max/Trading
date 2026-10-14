import { client } from '@/api/client';

const cache = new Map();
const DAY = 86400000;
let marketInfo = null;

export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
export const TF_MINUTES = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
export const MAX_RANGE_DAYS = { M1: 370 };
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

// Built-in markets (downloaded from Dukascopy by the local server) and the trader's own uploaded files
export async function loadMarketInfo() {
  if (!marketInfo) marketInfo = (await fetch('/api/market/info')).json();
  return marketInfo;
}

// The markets the testers offer: only QuantBot's built-in XAUUSD, US100 and NQ (files uploaded by older versions
// stay on disk but are no longer listed)
export async function loadDatasets() {
  const info = await loadMarketInfo();
  return info.markets.map((m) => ({
    id: `market-${m.symbol}`, market: true, symbol: m.symbol, name: m.name, source: 'Dukascopy',
    contract_size: m.contract_size, point: m.point, minuteStart: m.minuteStart, hourStart: m.hourStart, dayStart: m.dayStart,
  }));
}

// First day a dataset has bars for at a timeframe (uploaded files have one fixed timeframe)
export function firstDate(ds, tf) {
  if (!ds.market) return String(ds.start || '').slice(0, 10);
  if (tf === 'D1') return ds.dayStart;
  return TF_MINUTES[tf] >= 60 ? ds.hourStart : ds.minuteStart;
}

export const lastDate = (ds) => (ds.market ? today() : String(ds.end || '').slice(0, 10));

// The dataset as one test sees it: built-in markets take the chosen timeframe
export const asTested = (ds, tf) => (ds.market ? { ...ds, timeframe: tf } : ds);

// Parses MT5 exports (<DATE>\t<TIME>\t<OPEN>...) and TradingView CSV (time,open,high,low,close,Volume)
export function parseCandles(text) {
  const lines = text.trim().split(/\r?\n/);
  const mt5 = lines[0].includes('<DATE>');
  const rows = lines.slice(1);
  const n = rows.length;
  const bars = { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n), spread: new Float64Array(n) };
  rows.forEach((line, k) => {
    const c = line.split(mt5 ? '\t' : ',');
    if (mt5) {
      bars.time[k] = Date.parse(`${c[0].replace(/\./g, '-')}T${c[1]}Z`);
      [bars.open[k], bars.high[k], bars.low[k], bars.close[k], bars.volume[k]] = [c[2], c[3], c[4], c[5], c[6]].map(Number);
      bars.spread[k] = Number(c[8]) || 0;
    } else {
      bars.time[k] = /^\d+$/.test(c[0]) ? Number(c[0]) * 1000 : Date.parse(c[0]);
      [bars.open[k], bars.high[k], bars.low[k], bars.close[k]] = [c[1], c[2], c[3], c[4]].map(Number);
      bars.volume[k] = Number(c[5]) || 0;
    }
  });
  return bars;
}

const COLUMNS = ['time', 'open', 'high', 'low', 'close', 'volume', 'spread'];

export function decodeBars(buffer) {
  const all = new Float64Array(buffer);
  const n = all[0];
  return Object.fromEntries(COLUMNS.map((c, j) => [c, all.slice(1 + j * n, 1 + (j + 1) * n)]));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function marketBars(ds, tf, from, to, onProgress) {
  const res = await fetch('/api/market/prepare', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: ds.symbol, tf, from, to }),
  });
  let job = await res.json();
  if (!res.ok) throw new Error(job.error);
  while (job.state === 'running') {
    onProgress?.(job.done, job.total);
    await wait(400);
    job = await (await fetch(`/api/market/jobs/${job.id}`)).json();
  }
  if (job.state === 'error') throw new Error(job.error);
  onProgress?.(job.total, job.total);
  const q = new URLSearchParams({ symbol: ds.symbol, tf, from, to });
  const bars = await fetch(`/api/market/bars?${q}`);
  if (!bars.ok) throw new Error((await bars.json()).error);
  return decodeBars(await bars.arrayBuffer());
}

// Bars for a dataset; built-in markets download what's missing first (onProgress(done, total) counts files)
export async function loadBars(ds, { tf, from, to, onProgress } = {}) {
  if (ds.market) {
    const key = `${ds.id}|${tf}|${from}|${to}`;
    if (!cache.has(key)) cache.set(key, marketBars(ds, tf, from, to, onProgress).catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key);
  }
  if (!cache.has(ds.id)) {
    const res = await fetch(client.files.url(ds.file_uri));
    if (!res.ok) throw new Error(`Could not read the ${ds.symbol} data file (${res.status})`);
    cache.set(ds.id, parseCandles(await res.text()));
  }
  const bars = cache.get(ds.id);
  if (!from && !to) return bars;
  const lo = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity, hi = to ? Date.parse(`${to}T23:59:59Z`) : Infinity;
  const k0 = bars.time.findIndex((t) => t >= lo);
  if (k0 < 0) return sliceBars(bars, 0, -1);
  let k1 = k0;
  while (k1 + 1 < bars.time.length && bars.time[k1 + 1] <= hi) k1++;
  return sliceBars(bars, k0, bars.time[k0] > hi ? k0 - 1 : k1);
}

export function sliceBars(bars, from, to) {
  const out = {};
  for (const k of Object.keys(bars)) out[k] = bars[k].slice(from, to + 1);
  return out;
}

// Calendar days needed before a window so indicators are warmed up (weekends included)
export const warmupDays = (tf, bars) => Math.ceil(((bars * TF_MINUTES[tf]) / 1440) * 1.6) + 3;

// Bars before a test window that warm the indicators up. Shared by the Strategy Tester and Converter so the same
// script on the same dates gives the same result in both.
export const WARMUP_BARS = 500;

// Bars for a test from `from` to `to` (YYYY-MM-DD) plus up to WARMUP_BARS before `from`.
// -> { bars, start } where bars.time[start] is the first bar on or after `from` and the last bar is the last on `to`
export async function loadTestBars(ds, { tf, from, to, onProgress }) {
  const lo = Date.parse(`${from}T00:00:00Z`), hi = Date.parse(`${to}T23:59:59.999Z`);
  let all;
  if (ds.market) {
    const first = Date.parse(`${firstDate(ds, tf)}T00:00:00Z`);
    const pad = new Date(Math.max(lo - warmupDays(tf, WARMUP_BARS) * DAY, first)).toISOString().slice(0, 10);
    all = await loadBars(ds, { tf, from: pad, to, onProgress });
  } else {
    all = await loadBars(ds);
  }
  const k0 = all.time.findIndex((t) => t >= lo);
  let k1 = -1;
  for (let i = all.time.length - 1; i >= 0; i--) if (all.time[i] <= hi) { k1 = i; break; }
  if (k0 < 0 || k1 < k0) throw new Error(`No ${ds.symbol} ${ds.timeframe} bars between ${from} and ${to}.`);
  const s = Math.max(0, k0 - WARMUP_BARS);
  return { bars: sliceBars(all, s, k1), start: k0 - s };
}
