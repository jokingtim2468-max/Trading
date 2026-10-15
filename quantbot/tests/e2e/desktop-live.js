// Real-data check of the desktop app: launches it (Electron), downloads XAUUSD, US100 and NQ from Dukascopy itself
// (through its bot check), then runs the Strategy Converter on all three markets the way a trader does, and the
// Strategy Tester on an ICT script. The AI is a
// local fake, so no API key or cost. Needs internet; GitHub runs it on Windows (quantbot-desktop-check.yml).
//   cd desktop && npm install && npm run stage, then from quantbot/: node tests/e2e/desktop-live.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { startFakeModels } from '../support/fakeModels.js';

const desktop = path.resolve('desktop');
const OUT = path.resolve('test-results/desktop-live');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const models = await startFakeModels({ delayMs: 50 });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-live-'));
// Behind an authenticating proxy (some CI sandboxes): route Chromium through it
const proxy = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const app = await electron.launch({
  executablePath: path.join(desktop, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: [desktop, ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...(proxy ? [`--proxy-server=${proxy.protocol}//${proxy.host}`, '--ignore-certificate-errors', '--proxy-bypass-list=127.0.0.1;localhost'] : [])],
  env: { ...process.env, QUANTBOT_DATA: data, QUANTBOT_PORT: '5306', QUANTBOT_ANTHROPIC_URL: models.url },
});
if (proxy) {
  await app.evaluate(({ app: a }, c) => a.on('login', (e, wc, d, auth, cb) => { e.preventDefault(); cb(c.u, c.p); }),
    { u: decodeURIComponent(proxy.username), p: decodeURIComponent(proxy.password) });
}
const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
// The app's log (logs/quantbot.log; Settings > Logs shows where)
let logPath = path.join(userData, 'logs', 'quantbot.log');
const logTail = () => { try { return fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n'); } catch { return '(no log)'; } };
let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };

let win;
for (let k = 0; k < 300 && !win; k++) { win = app.windows().find((w) => w.url().startsWith('http')); if (!win) await wait(200); }
await win.waitForLoadState();
logPath = (await win.evaluate(() => window.quantbotDesktop?.logsPath?.())) || logPath;
win.on('console', (m) => { if (m.type() === 'error') console.log(`    console: ${m.text().slice(0, 300)}`); });

// 1. Straight downloads: each market on a few timeframes and periods (recent, years back, daily from the 1990s)
const cases = [
  ['XAUUSD', 'M15', 7], ['US100', 'M15', 7], ['NQ', 'M15', 7],
  ['XAUUSD', 'M15', 3000], ['US100', 'H1', 1500], ['NQ', 'H4', 900], ['US100', 'D1', 11000],
];
const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
for (const [symbol, tf, ago] of cases) {
  const from = day(ago), to = day(Math.max(0, ago - 6 - (tf === 'D1' ? 2000 : 0)));
  const t0 = Date.now();
  const res = await win.evaluate(async ([s, t, f, e]) => {
    const r = await fetch(`/api/market/bars?symbol=${s}&tf=${t}&from=${f}&to=${e}`);
    if (!r.ok) return { error: (await r.text()).slice(0, 300) };
    const buf = new Float64Array(await r.arrayBuffer());
    const n = buf[0];
    return { n, close: buf[1 + 5 * n - 1] };
  }, [symbol, tf, from, to]);
  check(!res.error && res.n > 0 && res.close > 0, `${symbol} ${tf} ${from} to ${to}: ${res.error || `${res.n} bars, last close ${res.close}`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// 2. The Converter, as clicked by a trader: convert once, test on XAUUSD, US100 and NQ (unseen M15 week)
await win.evaluate(() => fetch('/api/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'function', args: ['apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-live-check-0000' }] }) }));
await win.goto(new URL('/strategy-converter', win.url()).href);
await win.getByPlaceholder('e.g. Gold EMA Scalper').fill('Live check');
await win.getByPlaceholder(/Paste your strategy here/).fill('Buy breakouts of the Asian range with a 1.5 ATR stop.');
await win.getByRole('button', { name: 'Convert & test' }).click();
const board = win.getByRole('region', { name: /Leaderboard/ });
const t0 = Date.now();
let result = null;
for (let k = 0; k < 1500 && !result; k++) {
  const err = win.locator('.bg-destructive\\/10');
  if (await err.count()) result = { error: await err.first().textContent() };
  else if ((await board.locator('tbody tr').count()) >= 3 && !(await win.getByRole('button', { name: 'Stop' }).count())) result = { rows: await board.locator('tbody tr').allTextContents() };
  else await wait(400);
}
await win.screenshot({ path: path.join(OUT, 'converter.png') });
check(!!result?.rows, `Converter on XAUUSD, US100 and NQ: ${result?.error || (result ? `${result.rows.length} markets ranked in ${Math.round((Date.now() - t0) / 1000)} s` : 'timed out')}`);

// 3. The Strategy Tester on a trader's ICT rules (NY killzone sweep + FVG, tests/support/ictSim.js) over real M15 data:
// a faithful translation of those rules must trade, and the log shows how often each condition fired
await win.goto(new URL('/', win.url()).href);
await win.getByRole('button', { name: 'New chat' }).click();
await win.getByPlaceholder('Reply to QuantBot...').fill('write my live ict strategy');
await win.getByPlaceholder('Reply to QuantBot...').press('Enter');
await win.locator('aside').getByText('Live ICT', { exact: true }).waitFor({ timeout: 60000 });
await win.goto(new URL('/strategy-tester', win.url()).href);
await win.getByRole('heading', { name: 'Strategy Tester' }).waitFor();
await win.getByRole('combobox').first().click();
await win.getByRole('option', { name: 'Live ICT' }).click();
await win.getByLabel('From date').fill(day(180));
await win.getByRole('button', { name: 'Run test' }).click();
const t1 = Date.now();
let ict = null;
for (let k = 0; k < 3000 && !ict; k++) {
  const err = win.getByTestId('tester-error');
  if (await err.count()) ict = { error: await err.first().textContent() };
  else if ((await win.getByRole('heading', { name: /^(XAUUSD|US100|NQ) M15$/ }).count()) >= 3 && await win.getByRole('button', { name: 'Run test' }).count()) ict = {};
  else await wait(400);
}
if (ict && !ict.error) {
  const logs = win.getByRole('tab', { name: /Log \(/ });
  for (let k = 0; k < await logs.count(); k++) await logs.nth(k).click();
  ict.backtests = await win.getByText(/Backtest: \d+ trades/).allTextContents();
  ict.counts = await win.getByText(/Condition counts over/).allTextContents();
  ict.trades = ict.backtests.map((t) => Number(t.match(/Backtest: (\d+) trades/)[1]));
}
await win.screenshot({ path: path.join(OUT, 'tester-ict.png'), fullPage: true });
(ict?.counts || []).forEach((c) => console.log(`    ${c.replace(/^.*?(Condition counts)/, '$1')}`));
check(!!ict && !ict.error && ict.trades.length === 3 && ict.trades.reduce((a, b) => a + b, 0) > 0,
  `Strategy Tester, ICT rules on real M15 data (last 180 days): ${ict?.error || (ict ? `trades XAUUSD/US100/NQ ${ict.trades.join(' / ')} in ${Math.round((Date.now() - t1) / 1000)} s` : 'timed out')}`);

console.log(`\nApp log (last lines):\n${logTail()}`);
try { fs.copyFileSync(logPath, path.join(OUT, 'quantbot.log')); } catch { /* no log */ }
await app.close().catch(() => {});
await models.close();
console.log(failed ? `\n${failed} check(s) failed.` : '\nLive check passed.');
process.exit(failed ? 1 : 0);
