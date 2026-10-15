// Desktop app run: launches the Electron app (desktop/) the way the Start menu does, records the loading window's
// progress, checks the main window opens on the chat page with the bundled fonts, then closes it.
//   cd desktop && npm install && npm run stage, then from quantbot/: npm run test:desktop  (Linux: under xvfb-run)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
// As on a PC with Windows' "Animation effects" off, the browser engine reports reduced motion
await splash.emulateMedia({ reducedMotion: 'reduce' });
const anim = await splash.evaluate(() => ({ media: matchMedia('(prefers-reduced-motion: reduce)').matches, name: getComputedStyle(document.getElementById('card')).animationName }));
expect(anim.media, 'test setup: reduced motion was not emulated');
expect(anim.name === 'grow', `loading window does not grow in (animation: ${anim.name})`);
console.log('  ✓ with Windows reduced motion on, the loading window still grows in');
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
let title = [];
for (let k = 0; k < 100; k++) {
  title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible(), opacity: w.getOpacity(), width: w.getBounds().width })));
  if (title.length === 1 && title[0].opacity === 1) break;
  await wait(50);
}
expect(title.length === 1 && title[0].visible && title[0].opacity === 1, `windows: ${JSON.stringify(title)}`);
// Opening plays as a zoom of the page (no window resizing), and the class is gone afterwards
const opened = await (app.windows().find((w) => !w.url().startsWith('file:'))).evaluate(() => new Promise((resolve) => {
  const done = () => resolve(document.documentElement.dataset.opened === 'zoom' && !document.documentElement.classList.contains('app-opening') && getComputedStyle(document.getElementById('root')).transform === 'none');
  setTimeout(done, 600);
}));
expect(opened, 'opening zoom did not finish cleanly');
console.log('  ✓ window opened at full size with the page zooming in, no resize steps');
expect(await win.evaluate(() => document.fonts.check('16px Inter')), 'app fonts did not load');
await win.screenshot({ path: path.join(OUT, '02-app.png') });
console.log(`  ✓ main window open on the chat page after ${((Date.now() - t0) / 1000).toFixed(1)} s, loading window gone`);

// QuantBot's own title bar: no Windows frame, our buttons
const frame = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible());
expect(!frame, 'menu bar visible');
if (process.platform === 'win32') {
  await win.getByRole('button', { name: 'Maximize' }).click();
  await win.getByRole('button', { name: 'Restore' }).waitFor();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), 'Maximize did not maximize');
  await win.getByRole('button', { name: 'Restore' }).click();
  await win.getByRole('button', { name: 'Maximize' }).waitFor();
} else {
  // Xvfb has no window manager to maximize with: check the buttons reach the window instead
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    globalThis.calls = [];
    w.maximize = () => globalThis.calls.push('maximize');
    w.minimize = () => globalThis.calls.push('minimize');
  });
  await win.getByRole('button', { name: 'Maximize' }).click();
  await win.getByRole('button', { name: 'Minimize' }).click();
  await wait(200);
  const calls = await app.evaluate(() => globalThis.calls);
  expect(calls.join() === 'maximize,minimize', `window buttons sent: ${calls}`);
}
const barTop = await win.evaluate(() => {
  const bar = document.querySelector('.app-drag');
  return { h: bar.getBoundingClientRect().height, region: getComputedStyle(bar).webkitAppRegion, page: document.querySelector('#root > *:not(.app-drag)')?.getBoundingClientRect().top ?? null };
});
expect(barTop.h === 34 && barTop.region === 'drag', `title bar ${JSON.stringify(barTop)}`);
await win.screenshot({ path: path.join(OUT, '03-title-bar.png'), clip: { x: 0, y: 0, width: 1440, height: 120 } });
console.log('  ✓ custom title bar: drag area, minimize and maximize reach the window');

await win.getByRole('link', { name: 'Settings' }).click().catch(() => win.goto(`${new URL(win.url()).origin}/settings`));
await win.getByRole('heading', { name: 'API Keys' }).waitFor();
await win.emulateMedia({ reducedMotion: 'reduce' });
// Pop-ups still grow from the click with reduced motion on
await win.getByRole('heading', { name: 'Motion' }).scrollIntoViewIfNeeded();
expect(!(await win.evaluate(() => document.documentElement.classList.contains('motion-reduced'))), 'app started in reduced motion');
// A pop-up opened now still animates: open the model picker and read its animation
await win.getByRole('combobox').first().click();
const popName = await win.getByRole('listbox').evaluate((el) => getComputedStyle(el.closest('[data-state]') || el).animationName);
expect(popName && popName !== 'none', `pop-up has no animation (${popName})`);
await win.keyboard.press('Escape');
await win.getByRole('radio', { name: /Reduced/ }).click();
expect(await win.evaluate(() => document.documentElement.classList.contains('motion-reduced')), 'Reduced did not apply');
const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
await wait(300);
expect(JSON.parse(fs.readFileSync(path.join(userData, 'prefs.json'), 'utf8')).motion === 'reduced', 'Reduced was not saved for the loading window');
await win.getByRole('radio', { name: /Full animations/ }).click();
await wait(300);
expect(JSON.parse(fs.readFileSync(path.join(userData, 'prefs.json'), 'utf8')).motion === 'full', 'Full was not saved');
console.log('  ✓ Settings > Motion switches between full and reduced');
expect(fs.existsSync(path.join(data, 'secret.key')), 'data was not written to QUANTBOT_DATA');
console.log('  ✓ data saved in the app data folder');
// Settings > Logs: the log file is in a "logs" folder and already has the startup in it
await win.getByRole('heading', { name: 'Logs' }).scrollIntoViewIfNeeded();
const logPath = (await win.getByTestId('log-path').textContent()).trim();
expect(path.basename(logPath) === 'quantbot.log' && path.basename(path.dirname(logPath)) === 'logs', `log at ${logPath}`);
expect(/QuantBot \S+ on http/.test(fs.readFileSync(logPath, 'utf8')), 'startup was not logged');
await win.getByRole('button', { name: 'Open logs folder' }).waitFor();
await win.screenshot({ path: path.join(OUT, 'settings-logs.png') });
console.log(`  ✓ Settings > Logs shows ${logPath} and an Open logs folder button`);

// A chat to find again after restarts
const invoke = (page, kind, args) => page.evaluate(([k, a]) => fetch('/api/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: k, args: a }) }).then((r) => r.json()), [kind, args]);
const chat = (await invoke(win, 'entity', ['ChatSession', 'create', { title: 'Saved chat one', group: 'MT5', last_message_at: new Date().toISOString() }])).result;
await invoke(win, 'entity', ['ChatMessage', 'create', { session_id: chat.id, role: 'user', content: 'remember me' }]);

// Close from the title bar: the whole app process must end, server included
const proc = app.process();
const port = 5297;
await win.getByRole('button', { name: 'Close' }).click();
let exited = false;
for (let k = 0; k < 100 && !exited; k++) { await wait(100); exited = proc.exitCode !== null || proc.signalCode !== null; }
expect(exited, 'QuantBot is still running after its window was closed');
const stillServing = await fetch(`http://127.0.0.1:${port}/api/app/ping`).then(() => true, () => false);
expect(!stillServing, 'the local server is still answering after close');
console.log(`  ✓ Close ends QuantBot completely (exit code ${proc.exitCode})`);
// Chats are on disk the moment they're made: reopen after closing, then after a forced kill (Task Manager, power cut)
const launch = () => electron.launch({
  executablePath: path.join(desktop, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: [desktop, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, QUANTBOT_DATA: data, QUANTBOT_PORT: '5297' },
});
const mainWindow = async (a) => {
  for (let k = 0; k < 300; k++) {
    const w = a.windows().find((x) => x.url().startsWith('http'));
    if (w) { await w.waitForLoadState(); return w; }
    await wait(100);
  }
  throw new Error('main window did not open');
};
// An update replaces the install folder: the copy kept in the app data folder comes back on the next start
const kept = path.join(userData, 'quantbot.log');
fs.writeFileSync(kept, `${fs.readFileSync(logPath, 'utf8')}kept through the update\n`);
fs.rmSync(logPath);
let again = await launch();
let w2 = await mainWindow(again);
expect(fs.readFileSync(logPath, 'utf8').includes('kept through the update') && !fs.existsSync(kept), 'the log was not brought back after the update');
console.log('  ✓ the log survives an update');
await w2.locator('aside').getByText('Saved chat one').waitFor({ timeout: 15000 });
const chat2 = (await invoke(w2, 'entity', ['ChatSession', 'create', { title: 'Saved chat two', group: 'MT5', last_message_at: new Date().toISOString() }])).result;
await invoke(w2, 'entity', ['ChatMessage', 'create', { session_id: chat2.id, role: 'user', content: 'written right before a crash' }]);
// Like Task Manager's End task: the whole process tree at once (on Windows, killing only the main process leaves
// Electron's helper processes behind for a moment, and a relaunch meanwhile hands over to them and quits)
const victim = again.process();
if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(victim.pid)], { stdio: 'ignore' });
else victim.kill('SIGKILL');
for (let k = 0; k < 50 && victim.exitCode === null && victim.signalCode === null; k++) await wait(100);
await wait(1000);
again = await launch();
w2 = await mainWindow(again);
await w2.locator('aside').getByText('Saved chat two').waitFor({ timeout: 15000 });
await w2.locator('aside').getByText('Saved chat one').waitFor();
await w2.locator('aside').getByText('Saved chat two').click();
await w2.getByText('written right before a crash').waitFor();
console.log('  ✓ chats are still there after closing and after a forced kill');
await w2.getByRole('button', { name: 'Close' }).click();
await wait(1000);

console.log(`\nDesktop test passed. Screenshots: ${OUT}`);
