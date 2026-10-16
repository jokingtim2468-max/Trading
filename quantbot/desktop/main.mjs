// QuantBot desktop app (Electron). Opening it:
//   1. a small loading window grows in and shows real progress
//   2. installed copies check GitHub Releases for a newer version; one that is found downloads (progress in the
//      loading window), installs silently and reopens QuantBot
//   3. QuantBot's local server starts inside the app and the main window fades in as the loading window shrinks away
// Data (chats, tests, keys, market data) lives in %APPDATA%\QuantBot\data and survives updates and uninstalls.
import fs from 'node:fs';
// Load Node's networking (and the performance timers it needs) up front, in a fixed order. Importing node:http for the
// first time later, from the server, occasionally failed inside Electron ("reading 'markResourceTiming'"), which
// stopped QuantBot from starting.
import 'node:perf_hooks';
import 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, nativeTheme, shell, screen, ipcMain, session } from 'electron';
import updaterPkg from 'electron-updater';
import { createTunnel } from './tunnel.mjs';

const { autoUpdater } = updaterPkg;
const here = path.dirname(fileURLToPath(import.meta.url));
// The packaged app carries server/, dist/ and fonts in resources/quantbot; a dev run uses the source folder
const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'quantbot') : path.resolve(here, '..');
const PORT = Number(process.env.QUANTBOT_PORT) || 5174;
const UPDATES = app.isPackaged && !process.env.QUANTBOT_NO_UPDATE;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.setAppUserModelId('com.quantbot.desktop');
// A standard Chrome identity: Dukascopy's bot filter blocks browsers whose user agent carries extra app names
// ("QuantBot/1.0 ... Electron/38"), which is what Electron sends by default
app.userAgentFallback = app.userAgentFallback.replace(/ QuantBot\/\S+/i, '').replace(/ Electron\/\S+/, '').replace(/ quantbot-desktop\/\S+/i, '');
nativeTheme.themeSource = 'dark';
Menu.setApplicationMenu(null);

const primary = app.requestSingleInstanceLock();

let splash = null;
let main = null;
let server = null;
let updateReady = false;
const userData = () => app.getPath('userData');
const dataDir = () => process.env.QUANTBOT_DATA || path.join(userData(), 'data');
// Settings > Motion ("full" or "reduced"), saved by the app through hooks.setPrefs
const prefsFile = () => path.join(userData(), 'prefs.json');
const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } };
const calm = () => prefs().motion === 'reduced';
// The log is in a "logs" folder inside the install folder, next to QuantBot.exe (a per-user install, so it can be
// written). Running from source, or if that folder can't be written, it is in the app data folder instead. An update
// replaces the install folder, so the log is copied to the app data folder first and copied back on the next start.
let logsDir = null;
const logDir = () => {
  if (logsDir) return logsDir;
  const candidates = [process.env.QUANTBOT_LOG_DIR, app.isPackaged && path.join(path.dirname(process.execPath), 'logs'), path.join(userData(), 'logs')];
  for (const dir of candidates.filter(Boolean)) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return (logsDir = dir); } catch { /* next */ }
  }
  return (logsDir = userData());
};
const logFile = () => path.join(logDir(), 'quantbot.log');
// Script folders for Claude sit next to the logs folder ("scripts"). QuantBot rebuilds them from its data at start,
// so an update replacing the install folder loses nothing (your notes.md are kept in QuantBot's data too).
const scriptsDir = () => (path.basename(logDir()) === 'logs' ? path.join(path.dirname(logDir()), 'scripts') : path.join(logDir(), 'scripts'));
const logBackup = () => path.join(userData(), 'quantbot.log'); // also where older versions kept the log
const LOG_MAX = 5 * 1024 * 1024;
const log = (msg) => {
  try {
    const file = logFile();
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size || 0) > LOG_MAX) fs.renameSync(file, path.join(logDir(), 'quantbot.old.log'));
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* best effort */ }
};
// Before an update installs: keep a copy outside the install folder
const backupLog = () => { try { fs.copyFileSync(logFile(), logBackup()); } catch { /* nothing to keep */ } };
// On start: bring back the copy kept through an update (or the log from older versions) if the install folder lost it
function restoreLog() {
  try {
    const kept = logBackup();
    if (kept === logFile() || !fs.existsSync(kept)) return;
    if (!fs.existsSync(logFile())) fs.copyFileSync(kept, logFile());
    fs.rmSync(kept);
  } catch { /* best effort */ }
}

app.on('second-instance', () => {
  const w = main || splash;
  if (!w) return;
  if (w.isMinimized()) w.restore();
  w.focus();
});

function progress(p) {
  if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`window.setProgress(${JSON.stringify(p)})`).catch(() => {});
}

function createSplash() {
  splash = new BrowserWindow({
    width: 440, height: 460, frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    show: false, center: true, title: 'QuantBot', icon: path.join(here, 'build', 'icon.ico'), backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  splash.loadFile(path.join(here, 'splash.html'), { query: { version: app.getVersion(), ...(calm() ? { motion: 'reduced' } : {}) } });
  splash.once('ready-to-show', () => splash.show());
  return new Promise((r) => splash.webContents.once('did-finish-load', r));
}

// Moves the old PowerShell install's data (chats, tests, keys) into the app the first time it opens
function migrateOldData() {
  const target = dataDir();
  const old = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'QuantBot', 'quantbot', 'data');
  if (fs.existsSync(target) || !old || !fs.existsSync(old)) return;
  try {
    fs.cpSync(old, target, { recursive: true });
    log(`copied data from ${old}`);
  } catch (e) {
    log(`data copy failed: ${e.message}`);
  }
}

// At start: a newer version on GitHub is downloaded and installed before QuantBot opens. Gives up quietly offline.
function updateAtStart() {
  if (!UPDATES) return Promise.resolve(false);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  return new Promise((resolve) => {
    let downloading = false;
    const done = (installing) => { cleanup(); resolve(installing); };
    const timer = setTimeout(() => { if (!downloading) done(false); }, 12000);
    const onAvailable = (info) => { downloading = true; progress({ percent: 6, label: `Downloading QuantBot ${info.version}…` }); };
    const onNone = () => done(false);
    const onProgress = (p) => progress({ percent: 6 + p.percent * 0.84, label: `Downloading update… ${(p.transferred / 1e6).toFixed(1)} of ${(p.total / 1e6).toFixed(1)} MB` });
    const onDownloaded = () => {
      progress({ percent: 96, label: 'Installing the update…' });
      backupLog();
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 600);
      done(true);
    };
    const onError = (e) => { log(`update check failed: ${e?.message || e}`); done(false); };
    function cleanup() {
      clearTimeout(timer);
      autoUpdater.off('update-available', onAvailable).off('update-not-available', onNone).off('download-progress', onProgress)
        .off('update-downloaded', onDownloaded).off('error', onError);
    }
    autoUpdater.on('update-available', onAvailable).on('update-not-available', onNone).on('download-progress', onProgress)
      .on('update-downloaded', onDownloaded).on('error', onError);
    progress({ percent: 2, label: 'Checking for updates…' });
    autoUpdater.checkForUpdates().catch(onError);
  });
}

// Dukascopy only serves browsers now (Amazon's bot check). Market downloads go through Chromium's network stack,
// and when the check comes up, a hidden window opens the same address so Chromium runs it and keeps its cookie.
async function useBrowserForMarketData() {
  const { useBrowser } = await import(pathToFileURL(path.join(appRoot, 'server', 'market', 'dukascopy.js')).href);
  const ses = session.defaultSession;
  useBrowser({
    fetch: (url, init) => ses.fetch(url, { signal: init?.signal }),
    log,
    solve: async (url) => {
      const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      try {
        // The check page runs its script, then reloads the address, which now answers 200 with data
        let last = null;
        const ok = await new Promise((resolve) => {
          w.webContents.on('did-navigate', (_e, _u, code) => { last = code; if (code === 200) resolve(true); else if (code !== 202) resolve(false); });
          setTimeout(() => resolve(false), 20000);
          w.loadURL(url).catch(() => {});
        });
        log(`market data: Dukascopy bot check ${ok ? 'passed' : `failed (${last ?? 'no answer'})`}`);
        return ok;
      } finally {
        if (!w.isDestroyed()) w.destroy();
      }
    },
  });
}

// Signals page > public link for TradingView alerts; remembered, so it comes back on when QuantBot reopens
const tunnel = createTunnel({
  binDir: path.join(app.getPath('userData'), 'bin'),
  port: () => server?.port,
  fetch: (url) => session.defaultSession.fetch(url),
  log,
});

// What Settings > Updates, the Signals page and the server's /api/app routes call
const hooks = {
  heartbeat() {},
  log,
  scriptsDir,
  // Opens a script's folder (only inside the scripts folder) in File Explorer; '' when it opened
  openScriptsFolder(dir) {
    const rel = path.relative(scriptsDir(), path.resolve(dir));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return 'Not a script folder';
    return shell.openPath(dir);
  },
  tunnel: {
    status: tunnel.status,
    async start() { hooks.setPrefs({ tunnel: true }); return tunnel.start(); },
    stop() { hooks.setPrefs({ tunnel: false }); return tunnel.stop(); },
  },
  setPrefs(next) {
    try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...prefs(), ...next })); } catch (e) { log(`prefs: ${e.message}`); }
  },
  async info() {
    return { version: app.getVersion(), commit: null, date: null, behind: await hooks.updates() };
  },
  updates: (() => {
    let cached = null, at = 0;
    return async (force = false) => {
      if (!UPDATES) return 0;
      if (!force && Date.now() - at < 10 * 60000) return cached;
      try {
        const res = await autoUpdater.checkForUpdates();
        cached = res?.isUpdateAvailable ? 1 : 0;
      } catch (e) {
        log(`update check failed: ${e.message}`);
        cached = null;
      }
      at = Date.now();
      return cached;
    };
  })(),
  // Installs a downloaded update now, or reopens QuantBot so the loading window downloads it
  async restart() {
    if (updateReady) { backupLog(); return autoUpdater.quitAndInstall(true, true); }
    app.relaunch();
    app.quit();
  },
};

function windowState() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(userData(), 'window.json'), 'utf8'));
    const visible = screen.getAllDisplays().some((d) => s.x >= d.bounds.x - 50 && s.y >= d.bounds.y - 50 && s.x < d.bounds.x + d.bounds.width && s.y < d.bounds.y + d.bounds.height);
    return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch {
    return { width: 1440, height: 920 };
  }
}

function createMain(url) {
  const s = windowState();
  main = new BrowserWindow({
    x: s.x, y: s.y, width: s.width || 1440, height: s.height || 920, minWidth: 960, minHeight: 640,
    show: false, title: 'QuantBot', backgroundColor: '#272725', icon: path.join(here, 'build', 'icon.ico'),
    // No Windows frame: QuantBot draws its own title bar and window buttons (src/components/TitleBar.jsx)
    frame: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(here, 'preload.cjs') },
  });
  const sendMax = () => { if (!main.isDestroyed()) main.webContents.send('window:maximized', main.isMaximized()); };
  main.on('maximize', sendMax);
  main.on('unmaximize', sendMax);
  if (s.maximized) main.maximize();
  // The taskbar always says QuantBot (the page's own title is longer)
  main.on('page-title-updated', (e) => e.preventDefault());
  // Links to websites open in the browser, not inside QuantBot
  main.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target) && !target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });
  main.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) { e.preventDefault(); shell.openExternal(target); }
  });
  const save = () => {
    if (main.isDestroyed() || main.isMinimized()) return;
    try { fs.writeFileSync(path.join(userData(), 'window.json'), JSON.stringify({ ...main.getNormalBounds(), maximized: main.isMaximized() })); } catch { /* best effort */ }
  };
  main.on('close', save);
  // Closing the main window ends QuantBot even if a hidden helper window (Dukascopy's bot check) is still open
  main.on('closed', () => { main = null; shutdown(); });
  return main;
}

// Title bar buttons (only the main window's own page can send these)
const fromMain = (e) => main && !main.isDestroyed() && e.sender === main.webContents;
ipcMain.on('window:minimize', (e) => { if (fromMain(e)) main.minimize(); });
ipcMain.on('window:toggle-maximize', (e) => { if (fromMain(e)) { if (main.isMaximized()) main.unmaximize(); else main.maximize(); } });
ipcMain.on('window:close', (e) => { if (fromMain(e)) main.close(); });
ipcMain.handle('window:is-maximized', (e) => (fromMain(e) ? main.isMaximized() : false));
// Settings > Logs
ipcMain.handle('logs:path', (e) => (fromMain(e) ? logFile() : null));
ipcMain.handle('logs:open', async (e) => {
  if (!fromMain(e)) return 'Not allowed';
  if (!fs.existsSync(logFile())) log('Log opened from Settings');
  return shell.openPath(logDir()); // '' when it opened
});

// Opening: the main window appears at its real size (resizing a window every frame is what made it stutter) and fades
// in while its content zooms out of the middle (CSS, on the graphics card: html.app-opening in src/index.css) and the
// loading card fades away. Settings > Motion "Reduced" just fades.
async function reveal() {
  if (splash && !splash.isDestroyed()) await splash.webContents.executeJavaScript('window.leave()').catch(() => {});
  if (!calm()) await main.webContents.executeJavaScript("document.documentElement.classList.add('app-opening')").catch(() => {});
  main.setOpacity(0);
  main.show();
  main.focus();
  const old = splash;
  splash = null;
  setTimeout(() => { if (old && !old.isDestroyed()) old.destroy(); }, 420);
  for (let k = 1; k <= 10; k++) { main.setOpacity(k / 10); await wait(16); }
  main.setOpacity(1);
}

async function start() {
  await createSplash();
  if (await updateAtStart()) return; // QuantBot reopens after the update installs

  try {
    progress({ percent: 8, label: 'Starting QuantBot…' });
    migrateOldData();
    const { startServer } = await import(pathToFileURL(path.join(appRoot, 'server', 'index.js')).href);
    await useBrowserForMarketData();
    progress({ percent: 30, label: 'Loading your chats and tests…' });
    try {
      server = await startServer({ port: PORT, dataDir: dataDir(), prod: true, quiet: true, app: hooks });
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      server = await startServer({ port: 0, dataDir: dataDir(), prod: true, quiet: true, app: hooks });
    }
    const url = `http://localhost:${server.port}`;
    log(`QuantBot ${app.getVersion()} on ${url}`);
    progress({ percent: 55, label: 'Opening QuantBot…' });
    const win = createMain(url);
    win.webContents.on('did-start-loading', () => progress({ percent: 70, label: 'Opening QuantBot…' }));
    win.webContents.on('dom-ready', () => progress({ percent: 88, label: 'Almost ready…' }));
    await new Promise((resolve, reject) => {
      win.once('ready-to-show', resolve);
      win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`The window could not load (${desc || code}).`)));
      win.loadURL(url);
    });
    progress({ percent: 100, label: 'Ready' });
    await reveal();
  } catch (e) {
    log(`start failed: ${e.stack || e.message}`);
    progress({ label: "QuantBot couldn't start", error: `${e.message} Details: ${logFile()}` });
    return;
  }

  if (prefs().tunnel) tunnel.start();

  // Later updates download in the background and install the next time QuantBot closes
  if (UPDATES) {
    autoUpdater.on('update-downloaded', () => { updateReady = true; });
    autoUpdater.on('error', (e) => log(`update: ${e?.message || e}`));
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600000);
  }
}

// A second copy only brings the open window forward
if (!primary) app.quit();
else {
  restoreLog(); // before anything writes to the log
  app.whenReady().then(start);
}

// Closing the window ends QuantBot completely: the local server stops (open connections included) and the
// process exits, so nothing keeps running in the background or in Task Manager. A downloaded update installs now.
let quitting = false;
async function shutdown() {
  if (quitting) return;
  quitting = true;
  setTimeout(() => app.exit(0), 3000); // never hang on the way out
  tunnel.stop();
  try {
    server?.server.closeAllConnections?.();
    await server?.close();
  } catch { /* exiting anyway */ }
  if (updateReady) { backupLog(); autoUpdater.quitAndInstall(true, false); } else app.exit(0);
}
app.on('window-all-closed', shutdown);
app.on('before-quit', (e) => { if (!quitting && server) { e.preventDefault(); shutdown(); } });
