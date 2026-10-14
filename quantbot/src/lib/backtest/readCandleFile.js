import { parseCandles } from '@/lib/backtest/data';

// XAUUSD_M15_2024.csv -> XAUUSD / M15
function guess(name) {
  const m = name.toUpperCase().match(/^([A-Z0-9.]+?)[_\- ]+(M\d+|H\d+|D1|W1|MN1)\b/);
  return m ? { symbol: m[1], timeframe: m[2] } : { symbol: name.replace(/\.[^.]+$/, '').toUpperCase(), timeframe: '' };
}

export async function readCandleFile(file) {
  const text = await file.text();
  const bars = parseCandles(text);
  const n = bars.time.length;
  const ok = n > 0 && !Number.isNaN(bars.time[0]) && !Number.isNaN(bars.time[n - 1]);
  const info = ok ? {
    source: text.slice(0, 200).includes('<DATE>') ? 'MT5' : 'TradingView', bars: n,
    start: new Date(bars.time[0]).toISOString(), end: new Date(bars.time[n - 1]).toISOString(),
  } : null;
  return { file, info, ...guess(file.name) };
}