// Real-data check of the Strategy Tester with a basic Pine script: launches the desktop app, puts the script in a
// chat, and runs the tester on XAUUSD, US100 and NQ M15 over real Dukascopy data. The script's translation comes from
// tests/support/basicPine.js through a local fake model (no API key). Prints each market's results and saves
// screenshots in test-results/tester-pine.
//   cd desktop && npm run stage, then from quantbot/: node tests/e2e/tester-pine-live.js [days back, default 180]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { startFakeModels } from '../support/fakeModels.js';

const DAYS = Number(process.argv[2]) || 180;
const desktop = path.resolve('desktop');
const OUT = path.resolve('test-results/tester-pine');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
const models = await startFakeModels({ delayMs: 50 });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-pine-'));
const proxy = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const app = await electron.launch({
  executablePath: path.join(desktop, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: [desktop, ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...(proxy ? [`--proxy-server=${proxy.protocol}//${proxy.host}`, '--ignore-certificate-errors', '--proxy-bypass-list=127.0.0.1;localhost'] : [])],
  env: { ...process.env, QUANTBOT_DATA: data, QUANTBOT_PORT: '5307', QUANTBOT_ANTHROPIC_URL: models.url },
});
if (proxy) {
  await app.evaluate(({ app: a }, c) => a.on('login', (e, wc, d, auth, cb) => { e.preventDefault(); cb(c.u, c.p); }),
    { u: decodeURIComponent(proxy.username), p: decodeURIComponent(proxy.password) });
}
let win;
for (let k = 0; k < 300 && !win; k++) { win = app.windows().find((w) => w.url().startsWith('http')); if (!win) await wait(200); }
await win.waitForLoadState();
await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
let failed = false;
try {
  await win.evaluate(() => fetch('/api/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'function', args: ['apiKeys', { action: 'save', provider: 'anthropic', api_key: 'sk-ant-pine-check-0000' }] }) }));
  // 1. A chat whose reply is the basic Pine script
  await win.goto(new URL('/', win.url()).href);
  await win.getByRole('button', { name: 'New chat' }).click();
  await win.getByPlaceholder('Reply to QuantBot...').fill('write a basic pine strategy');
  await win.getByPlaceholder('Reply to QuantBot...').press('Enter');
  await win.locator('aside').getByText('Basic EMA Cross', { exact: true }).waitFor({ timeout: 60000 });
  // 2. The Strategy Tester on all three markets, M15
  await win.goto(new URL('/strategy-tester', win.url()).href);
  await win.getByRole('heading', { name: 'Strategy Tester' }).waitFor();
  await win.getByRole('combobox').first().click();
  await win.getByRole('option', { name: 'Basic EMA Cross' }).click();
  await win.getByLabel('From date').fill(day(DAYS));
  const t0 = Date.now();
  await win.getByRole('button', { name: 'Run test' }).click();
  let last = '';
  for (let k = 0; k < 4000; k++) {
    if (await win.getByTestId('tester-error').count()) throw new Error(await win.getByTestId('tester-error').textContent());
    if ((await win.getByRole('heading', { name: /^(XAUUSD|US100|NQ) M15$/ }).count()) >= 3 && await win.getByRole('button', { name: 'Run test' }).count()) break;
    const phase = await win.locator('.text-muted-foreground', { hasText: /downloading|simulating|reading|saving/i }).first().textContent().catch(() => '');
    if (phase && phase !== last && k % 10 === 0) { console.log(`    ${phase.trim()}`); last = phase; }
    await wait(400);
  }
  console.log(`  Tester finished in ${Math.round((Date.now() - t0) / 1000)} s (${day(DAYS)} to ${day(0)}, M15)`);
  const logs = win.getByRole('tab', { name: /Log \(/ });
  for (let k = 0; k < await logs.count(); k++) await logs.nth(k).click();
  for (const line of await win.getByText(/Backtest: \d+ trades|Condition counts over|No trades:/).allTextContents()) console.log(`    ${line.replace(/^\S+\s+\S+\s+/, '').trim()}`);
  await win.screenshot({ path: path.join(OUT, 'tester-results.png'), fullPage: true });
  const board = win.getByRole('region', { name: /Leaderboard/ });
  await board.scrollIntoViewIfNeeded();
  console.log('  Leaderboard:');
  for (const row of await board.locator('tbody tr').allTextContents()) console.log(`    ${row}`);
  await board.screenshot({ path: path.join(OUT, 'leaderboard.png') });
  for (const h of ['XAUUSD M15', 'US100 M15', 'NQ M15']) {
    const section = win.locator(`[id^="result-"]`).filter({ has: win.getByRole('heading', { name: h }) });
    await section.screenshot({ path: path.join(OUT, `${h.split(' ')[0]}.png`) });
  }
} catch (e) {
  failed = true;
  console.log(`  ✗ ${e.message}`);
  await win.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
}
await app.close().catch(() => {});
await models.close();
process.exit(failed ? 1 : 0);
