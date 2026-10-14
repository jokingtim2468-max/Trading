// QuantBot launcher. The desktop shortcut runs it (installer/QuantBot.vbs, no console window):
//   1. shows the loading screen straight away, in its own app window
//   2. updates QuantBot from GitHub with real progress (launcher/updater.js)
//   3. starts QuantBot in the same window
//   4. quits a few minutes after the window is closed
// Flags: --no-open (no window), --restart (used by "Restart & update"), --prepare (installer: update and build in
// the console, then exit).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { update, createProgress, versionInfo, checkForUpdates } from './updater.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const dataDir = process.env.QUANTBOT_DATA ? path.resolve(process.env.QUANTBOT_DATA) : path.join(appDir, 'data');
const PORT = Number(process.env.QUANTBOT_PORT) || 5173;
const URL_ = `http://localhost:${PORT}`;
const IDLE_MS = Number(process.env.QUANTBOT_IDLE_MS) || 3 * 60000;
const WIN = process.platform === 'win32';
const flags = new Set(process.argv.slice(2));
const OPEN = !flags.has('--no-open') && !flags.has('--restart');

fs.mkdirSync(dataDir, { recursive: true });
const statePath = path.join(dataDir, 'launcher-state.json');
const logFile = path.join(dataDir, 'launcher.log');
const log = (msg) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`); } catch { /* log is best effort */ } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Right after the installer adds Git or Node, a shortcut can still start with the old PATH
if (WIN) {
  const extra = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'), path.dirname(process.execPath)];
  for (const d of extra) if (fs.existsSync(d) && !process.env.Path?.toLowerCase().includes(d.toLowerCase())) process.env.Path = `${d};${process.env.Path}`;
}

async function ping() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/app/ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Microsoft Edge in app mode: its own window and taskbar entry, no tabs or address bar. Default browser otherwise.
function openWindow() {
  try {
    if (WIN) {
      const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
        .filter(Boolean).map((d) => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => fs.existsSync(p));
      const child = edge
        ? spawn(edge, [`--app=${URL_}`, '--window-size=1440,920'], { detached: true, stdio: 'ignore' })
        : spawn('cmd', ['/c', 'start', '', URL_], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (e) => log(`open window failed: ${e.message}`));
      child.unref();
    } else {
      const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    }
  } catch (e) {
    log(`open window failed: ${e.message}`);
  }
}

// The installer's "prepare" step: same update, progress printed in the console
if (flags.has('--prepare')) {
  const progress = createProgress(({ percent, label }) => {
    const n = Math.round(percent / 4);
    process.stdout.write(`\r  [${'#'.repeat(n)}${'-'.repeat(25 - n)}] ${String(percent).padStart(3)}%  ${label.padEnd(48).slice(0, 48)}`);
  });
  try {
    const { notes } = await update({ appDir, statePath, progress, log });
    progress.start('start', 'Ready');
    progress.finish('Ready');
    process.stdout.write('\n');
    for (const n of notes) console.log(`  ${n}`);
    process.exit(0);
  } catch (e) {
    process.stdout.write('\n');
    console.error(e.message);
    process.exit(1);
  }
}

// Already running: just bring up a window
if (await ping()) {
  if (OPEN) openWindow();
  process.exit(0);
}
if (flags.has('--restart')) for (let k = 0; k < 60 && await ping(); k++) await wait(250);

const info = await versionInfo(appDir).catch(() => ({}));
const versionText = [info.version && `v${info.version}`, info.commit, info.date].filter(Boolean).join(' · ');
let status = { percent: 0, label: 'Starting…', notes: [], error: null, version: versionText, canOpen: false, ready: false };
let lastPoll = Date.now();
let busy = false;
let app = null;

const splashHtml = fs.readFileSync(path.join(here, 'splash.html'));
const fontsDir = path.join(appDir, 'public', 'fonts');
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const splash = http.createServer((req, res) => {
  if (!LOCAL.test(String(req.headers.host || ''))) return json(res, 403, { error: 'Forbidden' });
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/__launcher/status') { lastPoll = Date.now(); return json(res, 200, status); }
  if (u.pathname === '/api/app/ping') return json(res, 200, { app: 'quantbot', phase: 'starting' });
  if (req.method === 'POST' && u.pathname === '/__launcher/retry') { prepare(false); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && u.pathname === '/__launcher/open-anyway') { prepare(true); return json(res, 200, { ok: true }); }
  if (u.pathname.startsWith('/fonts/')) {
    const file = path.join(fontsDir, path.basename(u.pathname));
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
    return fs.createReadStream(file).pipe(res);
  }
  if (u.pathname.startsWith('/api/')) return json(res, 503, { error: 'QuantBot is still starting' });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  return res.end(splashHtml);
});

try {
  await new Promise((resolve, reject) => { splash.once('error', reject); splash.listen(PORT, '127.0.0.1', resolve); });
} catch (e) {
  log(`port ${PORT} busy: ${e.message}`);
  if (OPEN) openWindow();
  process.exit(1);
}
log(`launcher started (${versionText || 'no version'})`);
if (OPEN) openWindow();

let lastBeat = Date.now();
const hooks = {
  heartbeat: () => { lastBeat = Date.now(); },
  info: async () => ({ ...(await versionInfo(appDir)), behind: await hooks.updates() }),
  updates: (() => {
    let cached = null, at = 0, pending = null;
    return async (force = false) => {
      if (force || Date.now() - at > 10 * 60000) {
        pending = pending || checkForUpdates(appDir).then((n) => { cached = n; at = Date.now(); }).finally(() => { pending = null; });
        await pending;
      }
      return cached;
    };
  })(),
  // Starts a fresh launcher (which installs the update behind the loading screen) and steps aside
  restart: async () => {
    log('restart requested');
    spawn(process.execPath, [path.join(here, 'launch.js'), '--restart'], { cwd: appDir, detached: true, stdio: 'ignore', env: process.env, windowsHide: true }).unref();
    await app?.close();
    process.exit(0);
  },
};

async function prepare(skipUpdate) {
  if (busy) return;
  busy = true;
  status = { ...status, error: null, percent: 0, label: 'Starting…', canOpen: false };
  const progress = createProgress((p) => { status = { ...status, ...p }; });
  try {
    if (skipUpdate) progress.plan([['start', 1]]);
    else status.notes = (await update({ appDir, statePath, progress, log })).notes;
    progress.start('start', 'Opening QuantBot…');
    // Loaded only now, so an update's new server code is the one that runs
    const { startServer } = await import(pathToFileURL(path.join(appDir, 'server', 'index.js')).href);
    progress.finish('Opening QuantBot…');
    await wait(700); // let the loading screen show 100%
    splash.closeAllConnections?.();
    await new Promise((r) => splash.close(r));
    app = await startServer({ port: PORT, dataDir, prod: true, quiet: true, app: hooks });
    lastBeat = Date.now();
    log('QuantBot ready');
  } catch (e) {
    log(`start failed: ${e.stack || e.message}`);
    status = { ...status, error: e.message, canOpen: !skipUpdate && fs.existsSync(path.join(appDir, 'dist', 'index.html')) };
  }
  busy = false;
}

// Quit once the window has been closed for a while (the page sends a heartbeat while it is open)
setInterval(() => {
  const idle = Date.now() - (app ? lastBeat : lastPoll);
  if (idle > IDLE_MS && !busy) {
    log('window closed, quitting');
    Promise.resolve(app ? app.close() : new Promise((r) => splash.close(r))).finally(() => process.exit(0));
  }
}, 15000);

prepare(false);
