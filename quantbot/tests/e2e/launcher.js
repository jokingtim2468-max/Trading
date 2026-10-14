// Desktop launcher run: installs QuantBot from a local copy of the GitHub repo the way the Windows installer does,
// opens it through the launcher, records the loading screen's progress bar, publishes an update, installs it with
// "Restart & update", and checks the launcher quits after the window closes. Screenshots: test-results/launcher/.
//   npm run test:launcher   (takes a few minutes: it runs npm ci and builds the UI, like a real install)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const appRepo = path.resolve('..');
const OUT = path.resolve('test-results/launcher');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-launcher-'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const branch = git(appRepo, 'rev-parse', '--abbrev-ref', 'HEAD');
const PORT = 5291;
const base = `http://localhost:${PORT}`;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let shot = 0;

console.log(`Launcher test in ${tmp}`);
// A launcher left from an earlier run stops by itself once its window is gone; wait for it
for (let k = 0; k < 90 && await fetch(`${base}/api/app/ping`).then(() => true, () => false); k++) await wait(1000);
// "GitHub": a bare copy of this repo. "The PC": a clone of it, like %LOCALAPPDATA%\QuantBot
const origin = path.join(tmp, 'origin.git');
git(tmp, 'clone', '-q', '--bare', appRepo, origin);
const install = path.join(tmp, 'QuantBot');
git(tmp, 'clone', '-q', '--branch', branch, origin, install);
const app = path.join(install, 'quantbot');

console.log('  installer step: node launcher/launch.js --prepare');
const t0 = Date.now();
const prep = execFileSync(process.execPath, ['launcher/launch.js', '--prepare'], { cwd: app, encoding: 'utf8', env: { ...process.env, QUANTBOT_PORT: String(PORT) } });
const bars = prep.split('\r').map((l) => Number(l.match(/\]\s+(\d+)%/)?.[1])).filter((n) => Number.isFinite(n));
expect(bars.length > 10 && bars.at(-1) === 100, `prepare progress ${bars.slice(-5)}`);
expect(bars.every((p, k) => k === 0 || p >= bars[k - 1]), 'prepare progress went backwards');
console.log(`  ✓ prepared in ${Math.round((Date.now() - t0) / 1000)} s, ${bars.length} progress updates, 0% → 100%, never backwards`);

const env = { ...process.env, QUANTBOT_PORT: String(PORT), QUANTBOT_IDLE_MS: '20000' };
const startLauncher = () => {
  const child = spawn(process.execPath, ['launcher/launch.js', '--no-open'], { cwd: app, env, stdio: 'ignore' });
  return child;
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// Records the loading screen's percentage and label until the app itself has loaded
async function watchLoading(name) {
  const seen = [];
  for (let k = 0; k < 2400; k++) {
    const s = await page.evaluate(() => {
      const p = document.getElementById('percent');
      return p ? { percent: Number(p.firstChild.nodeValue), label: document.getElementById('label').textContent, font: getComputedStyle(document.querySelector('.wordmark')).fontFamily } : { app: true };
    }).catch(() => null);
    if (s?.app) break;
    if (s && (!seen.length || seen.at(-1).percent !== s.percent || seen.at(-1).label !== s.label)) seen.push(s);
    if (s && seen.length === 3) await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}-loading.png`) });
    await wait(50);
  }
  return seen;
}

let launcher = startLauncher();
await wait(400);
await page.goto(base);
const first = await watchLoading('open');
await page.getByPlaceholder('Reply to QuantBot...').waitFor({ timeout: 60000 });
const pct = first.map((s) => s.percent);
expect(first.length >= 3, `loading screen seen ${first.length} times`);
expect(pct.every((p, k) => k === 0 || p >= pct[k - 1]), `progress went backwards: ${pct.join(',')}`);
expect(pct.at(-1) === 100, `ended at ${pct.at(-1)}%`);
expect(first[0].font.includes('Source Serif 4'), `wordmark font ${first[0].font}`);
const fontsOk = await page.evaluate(() => document.fonts.check('600 16px "Source Serif 4"') && document.fonts.check('16px Inter'));
expect(fontsOk, 'bundled fonts not loaded in the app');
console.log(`  ✓ opened: loading screen ${pct[0]}% → 100% (${[...new Set(first.map((s) => s.label))].join(' / ')}), bundled fonts loaded`);
await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-app.png`) });

// Publish an update: a change to the home greeting, pushed to "GitHub" from another clone
const dev = path.join(tmp, 'dev');
git(tmp, 'clone', '-q', '--branch', branch, origin, dev);
const greet = path.join(dev, 'quantbot', 'src', 'components', 'quant', 'HomeGreeting.jsx');
fs.writeFileSync(greet, fs.readFileSync(greet, 'utf8').replace("return 'Good evening';", "return 'Good evening';\n}\n\nexport const UPDATED = 'Updated build';\nfunction unused() {").replace('{greeting()}, {name}', '{greeting()}, {name} · Updated build'));
git(dev, '-c', 'user.name=QuantBot test', '-c', 'user.email=test@example.com', 'commit', '-qam', 'Test update');
git(dev, 'push', '-q', 'origin', branch);

await page.goto(`${base}/settings`);
const updates = page.locator('section', { has: page.getByRole('heading', { name: 'Updates' }) });
await updates.getByRole('button', { name: 'Check now' }).click();
await updates.getByText('1 update ready to install.').waitFor({ timeout: 30000 });
await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-update-ready.png`) });
console.log('  ✓ Settings → Updates found the new version on GitHub');

const oldPid = launcher.pid;
await updates.getByRole('button', { name: 'Restart & update' }).click();
await page.waitForURL(`${base}/`, { timeout: 60000 });
const second = await watchLoading('update');
await page.getByText(/· Updated build/).waitFor({ timeout: 300000 });
const pct2 = second.map((s) => s.percent);
const labels = [...new Set(second.map((s) => s.label))];
expect(pct2.every((p, k) => k === 0 || p >= pct2[k - 1]), `update progress went backwards: ${pct2.join(',')}`);
// (from a local "GitHub" the check and download take milliseconds, so only the rebuild is long enough to watch)
expect(labels.some((l) => /Building QuantBot/.test(l)), `labels: ${labels.join(' / ')}`);
expect(git(install, 'rev-parse', 'HEAD') === git(origin, 'rev-parse', branch), 'install is not on the published version');
expect(pct2.filter((p) => p > 0 && p < 100).length >= 5, `too few in-between values: ${pct2.join(',')}`);
let oldAlive = true;
try { process.kill(oldPid, 0); } catch { oldAlive = false; }
expect(!oldAlive, 'the old launcher is still running');
console.log(`  ✓ Restart & update: ${pct2.length} progress steps ${pct2[0]}% → 100% (${labels.join(' / ')}), new version running`);
await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-updated-app.png`) });

// Close the window: the launcher stops by itself once the heartbeats stop
const pidLine = fs.readFileSync(path.join(app, 'data', 'launcher.log'), 'utf8');
await page.close();
const tClose = Date.now();
let stopped = false;
for (let k = 0; k < 120 && !stopped; k++) {
  await wait(1000);
  stopped = await fetch(`${base}/api/app/ping`).then(() => false, () => true);
}
expect(stopped, 'launcher still running 2 minutes after the window closed');
console.log(`  ✓ window closed → QuantBot stopped after ${Math.round((Date.now() - tClose) / 1000)} s`);
expect(/window closed, quitting/.test(fs.readFileSync(path.join(app, 'data', 'launcher.log'), 'utf8')), 'no quit line in the log');
expect(!pageErrors.length, `page errors: ${pageErrors.join(' | ')}`);
expect(pidLine.includes('launcher started'), 'no start line in the log');

await browser.close();
try { launcher.kill(); } catch { /* already gone */ }
console.log(`\nLauncher test passed. Screenshots: ${OUT}`);
