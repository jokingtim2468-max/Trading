// Night-session mean reversion: fade a sweep of the early-Asia range, and Bollinger-band stretches back to the middle
import { loadEngine, loadMt5, slice, rStats } from './research-lib.mjs';
import fs from 'node:fs';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const src = fs.readFileSync(new URL('./research-xau.mjs', import.meta.url), 'utf8');
const fade = new Function(`${src.slice(src.indexOf('const fade ='), src.indexOf('const rbo ='))}; return fade;`)();
const H = (h, mm = 0) => h * 60 + mm;
// Close beyond a 2.5-sd Bollinger band (20) inside the window -> fade toward the middle band; stop k x ATR beyond the close
const bb = ({ ws, we, sd = 2.5, k = 1.5, tpMid = true, tp = 1, minRisk = 1 }) => `
const s = ctx.state, i = ctx.i, m = ctx.nyHour * 60 + ctx.nyMinute;
const p = ctx.position;
if (p) {
  if (p.barsOpen >= 24) return { action: 'close' };
  ${tpMid ? "const mid = ctx.ta.sma(ctx.close, 20); if ((p.side === 'long' && ctx.close[i] >= mid) || (p.side === 'short' && ctx.close[i] <= mid)) return { action: 'close' };" : ''}
  return null;
}
const wd = ctx.nyDayOfWeek >= 0 && ctx.nyDayOfWeek <= 4; // Sun-Thu evenings
if (!wd || m < ${ws} || m >= ${we}) return null;
const day = Math.floor((ctx.time[i] - 7 * 3600000) / 86400000);
if (s.day === day) return null; // one trade a night
const c = ctx.close[i], mid = ctx.ta.sma(ctx.close, 20), dev = ctx.ta.stdev(ctx.close, 20), atr = ctx.ta.atr(14);
if (!(dev > 0) || !(atr > 0)) return null;
const up = c > mid + ${sd} * dev, dn = c < mid - ${sd} * dev;
if (!up && !dn) return null;
const risk = ${k} * atr;
if (risk < ${minRisk}) return null;
s.day = day;
const lots = Math.max(0.01, Math.floor(ctx.balance * 0.01 / (risk * ctx.contractSize) * 100) / 100);
return up ? { action: 'sell', lots, sl: c + risk, tp: c - ${tp} * risk * ${tpMid ? 3 : 1} } : { action: 'buy', lots, sl: c - risk, tp: c + ${tp} * risk * ${tpMid ? 3 : 1} };`;
const configs = {
  'fade early-Asia (18-19) sweep 19-22, 1R': fade({ rs: H(18), re: H(19), ws: H(19), we: H(22), tp: 1, flat: 1439 }),
  'fade early-Asia (18-19) sweep 19-22, 2R': fade({ rs: H(18), re: H(19), ws: H(19), we: H(22), tp: 2, flat: 1439 }),
  'fade Asia (18-20) sweep 20-23, 1R': fade({ rs: H(18), re: H(20), ws: H(20), we: H(23), tp: 1, flat: 1439 }),
  'BB 2.5sd 19-23 -> middle band, stop 1.5ATR': bb({ ws: H(19), we: H(23) }),
  'BB 3sd 19-23 -> middle band, stop 1.5ATR': bb({ ws: H(19), we: H(23), sd: 3 }),
  'BB 2.5sd 19-23 -> middle band, stop 2.5ATR': bb({ ws: H(19), we: H(23), k: 2.5 }),
};
for (const [name, code] of Object.entries(configs)) {
  const out = [['2010-01-01', '2020-01-01'], ['2020-01-01', '2023-01-01'], ['2023-01-01', '2026-10-16']].map(([a, b]) => {
    const { bars, start } = slice(all, a, b);
    const r = E.runBacktest({ bars, startIndex: start, simCode: code, balance: 1e6, contractSize: 100, point: 0.01 });
    const st = rStats(r.trades, 100);
    return `${a.slice(2, 4)}-${String(b.slice(2, 4) - 1).padStart(2, '0')} n=${st.n} avgR=${st.avgR.toFixed(3)} PF=${st.pf.toFixed(2)}${r.errors ? ` ERR ${r.errors}` : ''}`;
  });
  console.log(name.padEnd(44), out.join(' | '));
}
await E.vite.close();
