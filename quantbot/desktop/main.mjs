// QuantBot desktop app (Electron). Opening it:
//   1. a small loading window grows in and shows real progress
//   2. installed copies check GitHub Releases for a newer version; one that is found downloads (progress in the
//      loading window), installs silently and reopens QuantBot
//   3. QuantBot's local server starts inside the app and the main window fades in as the loading window shrinks away
// Data (chats, tests, keys, market data) lives in %APPDATA%\QuantBot\data and survives updates and uninstalls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, nativeTheme, shell, screen } from 'electron';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;
const here = path.dirname(fileURLToPath(import.meta.url));
// The packaged app carries server/, dist/ and fonts in resources/quantbot; a dev run uses the source folder
const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'quantbot') : path.resolve(here, '..');
const PORT = Number(process.env.QUANTBOT_PORT) || 5174;
const UPDATES = app.isPackaged && !process.env.QUANTBOT_NO_UPDATE;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.setAppUserModelId('com.quantbot.desktop');
nativeTheme.themeSource = 'dark';
Menu.setApplicationMenu(null);

const primary = app.requestSingleInstanceLock();

let splash = null;
let main = null;
let server = null;
let updateReady = false;
const userData = () => app.getPath('userData');
const dataDir = () => process.env.QUANTBOT_DATA || path.join(userData(), 'data');
const log = (msg) => { try { fs.appendFileSync(path.join(userData(), 'quantbot.log'), `${new Date().toISOString()} ${msg}\n`); } catch { /* best effort */ } };

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
  splash.loadFile(path.join(here, 'splash.html'), { query: { version: app.getVersion() } });
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

// What Settings > Updates and the server's /api/app routes call
const hooks = {
  heartbeat() {},
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
    if (updateReady) return autoUpdater.quitAndInstall(true, true);
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
    autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (s.maximized) main.maximize();
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
  main.on('closed', () => { main = null; });
  return main;
}

// The main window fades in while the loading window shrinks away
async function reveal() {
  if (splash && !splash.isDestroyed()) await splash.webContents.executeJavaScript('window.leave()').catch(() => {});
  main.setOpacity(0);
  main.show();
  for (let k = 1; k <= 12; k++) { main.setOpacity(k / 12); await wait(16); }
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
}

async function start() {
  await createSplash();
  if (await updateAtStart()) return; // QuantBot reopens after the update installs

  try {
    progress({ percent: 8, label: 'Starting QuantBot…' });
    migrateOldData();
    const { startServer } = await import(pathToFileURL(path.join(appRoot, 'server', 'index.js')).href);
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
    progress({ label: "QuantBot couldn't start", error: `${e.message} Details: ${path.join(userData(), 'quantbot.log')}` });
    return;
  }

  // Later updates download in the background and install the next time QuantBot closes
  if (UPDATES) {
    autoUpdater.on('update-downloaded', () => { updateReady = true; });
    autoUpdater.on('error', (e) => log(`update: ${e?.message || e}`));
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600000);
  }
}

// A second copy only brings the open window forward
if (!primary) app.quit();
else app.whenReady().then(start);

app.on('window-all-closed', async () => {
  try { await server?.close(); } catch { /* closing anyway */ }
  app.quit();
});
