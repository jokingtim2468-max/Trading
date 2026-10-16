// Night-session candidates (New York evening / Asia open), same engine, costs and 2-hour cap
import { loadEngine, loadMt5, slice, rStats } from './research-lib.mjs';
import fs from 'node:fs';
const E = await loadEngine();
const all = loadMt5(process.argv[2], { minSpread: 15 });
const src = fs.readFileSync(new URL('./research-xau.mjs', import.meta.url), 'utf8');
const rbo = new Function(`${src.slice(src.indexOf('const rbo ='), src.indexOf('const H ='))}; return rbo;`)();
const H = (h, mm = 0) => h * 60 + mm;
const N = 1439; // never force-flat at night (the 2-hour cap still applies)
const configs = {
  'Asia-open range 18-19 -> 19-22, mid, 1.5R, $2': { rs: H(18), re: H(19), ws: H(19), we: H(22), tp: 1.5, minRisk: 2, flat: N },
  'Asia-open range 18-19 -> 19-22, far, 1R, $2': { rs: H(18), re: H(19), ws: H(19), we: H(22), tp: 1, stop: 'far', minRisk: 2, flat: N },
  'Asia range 18-20 -> 20-23, mid, 1.5R, $2': { rs: H(18), re: H(20), ws: H(20), we: H(23), tp: 1.5, minRisk: 2, flat: N },
  'Asia range 18-20 -> 20-23, far, 1R, $2': { rs: H(18), re: H(20), ws: H(20), we: H(23), tp: 1, stop: 'far', minRisk: 2, flat: N },
  'NY afternoon 12-16 -> 18-22, mid, 1.5R, $4': { rs: H(12), re: H(16), ws: H(18), we: H(22), tp: 1.5, minRisk: 4, flat: N },
  'NY session 08-16 -> 18-23, mid, 1.5R, $4': { rs: H(8), re: H(16), ws: H(18), we: H(23), tp: 1.5, minRisk: 4, flat: N },
  'NY session 08-16 -> 18-23, atr1.5, 2R': { rs: H(8), re: H(16), ws: H(18), we: H(23), tp: 2, stop: 'atr', flat: N },
};
for (const [name, cfg] of Object.entries(configs)) {
  const code = rbo(cfg);
  const out = [['2010-01-01', '2020-01-01'], ['2020-01-01', '2023-01-01'], ['2023-01-01', '2026-10-16']].map(([a, b]) => {
    const { bars, start } = slice(all, a, b);
    const st = rStats(E.runBacktest({ bars, startIndex: start, simCode: code, balance: 1e6, contractSize: 100, point: 0.01 }).trades, 100);
    return `${a.slice(2, 4)}-${String(b.slice(2, 4) - 1).padStart(2, '0')} n=${st.n} avgR=${st.avgR.toFixed(3)} PF=${st.pf.toFixed(2)}`;
  });
  console.log(name.padEnd(46), out.join(' | '));
}
await E.vite.close();
