import { client } from '@/api/client';
import { BUILTIN_DATASETS, loadBuiltinText } from '@/lib/backtest/builtinData';

const cache = {};

export async function loadDatasets() {
  const page = await client.entities.MarketData.filter({}, { sort: 'symbol', limit: 50 });
  return [...BUILTIN_DATASETS, ...page.items];
}

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

export async function loadBars(dataset) {
  if (!cache[dataset.id] && dataset.builtin) cache[dataset.id] = parseCandles(await loadBuiltinText(dataset));
  if (!cache[dataset.id]) {
    const res = await fetch(client.files.url(dataset.file_uri));
    if (!res.ok) throw new Error(`Could not read the ${dataset.symbol} data file (${res.status})`);
    cache[dataset.id] = parseCandles(await res.text());
  }
  return cache[dataset.id];
}

export function sliceBars(bars, from, to) {
  const out = {};
  for (const k of Object.keys(bars)) out[k] = bars[k].slice(from, to + 1);
  return out;
}