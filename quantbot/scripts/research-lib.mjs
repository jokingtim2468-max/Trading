// Research helpers: load an MT5 M5 export and run sim_code through QuantBot's own engine (src/lib/backtest/engine.js)
import fs from 'node:fs';
import { createServer } from 'vite';

export async function loadEngine() {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  const engine = await vite.ssrLoadModule('/src/lib/backtest/engine.js');
  const metrics = await vite.ssrLoadModule('/src/lib/backtest/metrics.js');
  const mc = await vite.ssrLoadModule('/src/lib/backtest/monteCarlo.js');
  return { vite, ...engine, ...metrics, ...mc };
}

// MT5 export (<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>) -> bars; times are broker time stored as UTC
export function loadMt5(file, { minSpread = 0 } = {}) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const n = lines.length;
  const b = { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n), spread: new Float64Array(n) };
  let k = 0;
  for (let i = 1; i < n; i++) {
    const c = lines[i].trimEnd().split('\t');
    if (c.length < 7) continue;
    b.time[k] = Date.parse(`${c[0].replace(/\./g, '-')}T${c[1]}Z`);
    b.open[k] = +c[2]; b.high[k] = +c[3]; b.low[k] = +c[4]; b.close[k] = +c[5]; b.volume[k] = +c[6];
    b.spread[k] = Math.max(minSpread, +(c[8] || 0));
    k++;
  }
  for (const key of Object.keys(b)) b[key] = b[key].slice(0, k);
  return b;
}

export function slice(b, from, to) {
  const lo = Date.parse(from), hi = Date.parse(to);
  let s = 0; while (s < b.time.length && b.time[s] < lo) s++;
  let e = s; while (e < b.time.length && b.time[e] < hi) e++;
  const out = {};
  for (const key of Object.keys(b)) out[key] = b[key].subarray(Math.max(0, s - 600), e);
  return { bars: out, start: Math.min(600, s) };
}

// R-multiple stats (independent of position sizing)
export function rStats(trades, contractSize) {
  const rs = trades.map((t) => t.pnl / (Math.abs(t.entry - t.sl0) * t.lots * contractSize));
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r <= 0);
  const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); streak = r <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const byYear = {};
  trades.forEach((t, k) => { const y = new Date(t.exitTime).getUTCFullYear(); byYear[y] = (byYear[y] || 0) + rs[k]; });
  return { n: rs.length, win: rs.length ? (wins.length / rs.length) * 100 : 0, avgR: rs.length ? eq / rs.length : 0, totalR: eq, pf: gl ? gw / gl : Infinity, maxDDR: dd, maxStreak, byYear, rs };
}
