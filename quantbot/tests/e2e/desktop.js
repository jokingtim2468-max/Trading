// Desktop app run: launches the Electron app (desktop/) the way the Start menu does, records the loading window's
// progress, checks the main window opens on the chat page with the bundled fonts, then closes it.
//   cd desktop && npm install && npm run stage, then from quantbot/: npm run test:desktop  (Linux: under xvfb-run)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const desktop = path.resolve('desktop');
const OUT = path.resolve('test-results/desktop');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-desktop-'));

const t0 = Date.now();
const app = await electron.launch({
  executablePath: path.join(desktop, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: [desktop, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, QUANTBOT_DATA: data, QUANTBOT_PORT: '5297' },
});

// The loading window: record its percentages until it goes away
const splash = await app.firstWindow();
const seen = [];
let shot = false;
for (let k = 0; k < 600; k++) {
  const s = await splash.evaluate(() => ({
    percent: window.shownPercent?.(), label: document.getElementById('label')?.textContent,
    error: document.getElementById('error')?.textContent, font: getComputedStyle(document.querySelector('.wordmark')).fontFamily,
    fontsOk: document.fonts.check('600 16px "Source Serif 4"'),
  })).catch(() => null);
  if (!s) break;
  expect(!s.error, `loading window error: ${s.error}`);
  if (!seen.length || seen.at(-1).percent !== s.percent || seen.at(-1).label !== s.label) seen.push(s);
  if (!shot && s.percent > 20) { await splash.screenshot({ path: path.join(OUT, '01-loading.png') }); shot = true; }
  await wait(30);
}
const pct = seen.map((s) => s.percent);
expect(pct.every((p, k) => k === 0 || p >= pct[k - 1]), `progress went backwards: ${pct}`);
expect(pct.at(-1) === 100, `loading ended at ${pct.at(-1)}%`);
expect(seen.some((s) => s.fontsOk), 'loading window fonts did not load');
console.log(`  ✓ loading window ${pct[0]}% → 100% in ${seen.length} steps (${[...new Set(seen.map((s) => s.label))].join(' / ')})`);

const win = app.windows().find((w) => !w.url().startsWith('file:')) || await app.waitForEvent('window');
await win.getByPlaceholder('Reply to QuantBot...').waitFor({ timeout: 30000 });
const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible(), opacity: w.getOpacity() })));
expect(title.length === 1 && title[0].visible && title[0].opacity === 1, `windows: ${JSON.stringify(title)}`);
expect(await win.evaluate(() => document.fonts.check('16px Inter')), 'app fonts did not load');
await win.screenshot({ path: path.join(OUT, '02-app.png') });
console.log(`  ✓ main window open on the chat page after ${((Date.now() - t0) / 1000).toFixed(1)} s, loading window gone`);

await win.getByRole('link', { name: 'Settings' }).click().catch(() => win.goto(`${new URL(win.url()).origin}/settings`));
await win.getByRole('heading', { name: 'API Keys' }).waitFor();
expect(fs.existsSync(path.join(data, 'secret.key')), 'data was not written to QUANTBOT_DATA');
console.log('  ✓ data saved in the app data folder');

await app.close();
console.log(`\nDesktop test passed. Screenshots: ${OUT}`);
