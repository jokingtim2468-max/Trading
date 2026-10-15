// QuantBot local server: serves the UI and answers its data, file and AI calls on this PC.
//   npm start            UI from source (Vite, live reload)
//   npm run serve        UI from the built dist/ folder (after npm run build)
// Listens on 127.0.0.1 only. QUANTBOT_PORT (default 5173) and QUANTBOT_DATA (default ./data) change the defaults.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend, entityDefaults } from './backend.js';
import { createCipher } from './crypto.js';
import { createMarketStore } from './market/store.js';
import { TIMEFRAMES, MAX_RANGE_DAYS } from './market/instruments.js';
import { encodeBars } from './market/resample.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JSON = 20 * 1024 * 1024;
const MAX_UPLOAD = 300 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.csv': 'text/csv' };

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Only this PC's own pages may call the API: blocks other websites (and DNS rebinding) from using it through the browser
function trusted(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

async function handleApi(req, res, { backend, market, app }, url) {
  if (!trusted(req)) return send(res, 403, { error: 'Forbidden' });
  const json = () => String(req.headers['content-type'] || '').startsWith('application/json');

  // The desktop launcher (launcher/launch.js) passes `app`: updates, restart and the window heartbeat
  if (url.pathname === '/api/app/ping') return send(res, 200, { app: 'quantbot', phase: 'ready', managed: !!app });
  if (req.method === 'POST' && url.pathname === '/api/app/heartbeat') { app?.heartbeat(); return send(res, 200, { ok: true }); }
  // Settings > Motion, so the desktop app's loading window and window opening follow it
  if (req.method === 'POST' && url.pathname === '/api/app/prefs') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    const body = JSON.parse((await readBody(req, 1000)).toString('utf8') || '{}');
    if (app?.setPrefs) await app.setPrefs({ motion: body.motion === 'reduced' ? 'reduced' : 'full' });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/app/info') return send(res, 200, app ? { managed: true, ...(await app.info()) } : { managed: false });
  if (req.method === 'POST' && url.pathname === '/api/app/check') {
    if (!app || !json()) return send(res, 400, { error: 'Updates are handled by the desktop shortcut' });
    return send(res, 200, { behind: await app.updates(true) });
  }
  if (req.method === 'POST' && url.pathname === '/api/app/restart') {
    if (!app || !json()) return send(res, 400, { error: 'Updates are handled by the desktop shortcut' });
    send(res, 200, { ok: true });
    setTimeout(() => app.restart(), 100);
    return undefined;
  }

  if (req.method === 'POST' && url.pathname === '/api/invoke') {
    // A JSON content type forces a CORS preflight for cross-site requests, which this server never approves
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
    const { kind, args } = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}');
    if (kind === 'file') return send(res, 400, { error: 'Upload files through /api/files' });
    const result = await backend.handle(kind, ...(Array.isArray(args) ? args : []));
    return send(res, 200, { result: result === undefined ? null : result });
  }

  if (req.method === 'POST' && url.pathname === '/api/files') {
    if (req.headers['x-quantbot-upload'] !== '1') return send(res, 400, { error: 'Missing upload header' });
    const bytes = await readBody(req, MAX_UPLOAD);
    return send(res, 200, backend.handle('file', url.searchParams.get('name') || 'file', bytes));
  }

  // Built-in market data (XAUUSD, US100), downloaded from Dukascopy on first use
  if (req.method === 'GET' && url.pathname === '/api/market/info') {
    return send(res, 200, { markets: market.info(), timeframes: Object.keys(TIMEFRAMES), maxRangeDays: MAX_RANGE_DAYS });
  }
  if (req.method === 'POST' && url.pathname === '/api/market/prepare') {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
    const { symbol, tf, from, to } = JSON.parse((await readBody(req, 10000)).toString('utf8') || '{}');
    return send(res, 200, market.prepare(symbol, tf, from, to));
  }
  const job = url.pathname.match(/^\/api\/market\/jobs\/(\d+)$/);
  if (req.method === 'GET' && job) return send(res, 200, market.job(job[1]));
  if (req.method === 'GET' && url.pathname === '/api/market/bars') {
    const q = url.searchParams;
    const bars = await market.bars(q.get('symbol'), q.get('tf'), q.get('from'), q.get('to'));
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(encodeBars(bars));
  }

  const m = url.pathname.match(/^\/api\/files\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const file = backend.filePath(decodeURIComponent(m[1]));
    if (!fs.existsSync(file)) return send(res, 404, { error: 'File not found' });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return fs.createReadStream(file).pipe(res);
  }

  return send(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, dist) {
  const url = new URL(req.url, 'http://x');
  let file = path.join(dist, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// app: hooks from the desktop launcher ({ heartbeat, info, updates, restart }); absent with npm start
export async function startServer({ port = 5173, dataDir = path.join(root, 'data'), prod = false, userName, quiet = false, app = null } = {}) {
  const cipher = createCipher(dataDir);
  const market = createMarketStore(dataDir, { log: app?.log });
  const backend = createBackend({
    market,
    dataDir,
    encrypt: cipher.encrypt,
    decrypt: cipher.decrypt,
    userName: userName || process.env.QUANTBOT_USER || os.userInfo().username,
    defaults: entityDefaults(path.join(root, 'server', 'entities')),
  });

  const server = http.createServer();
  let vite = null;
  const dist = path.join(root, 'dist');
  if (prod) {
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('No build found: run npm run build first');
  } else {
    const { createServer } = await import('vite');
    vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa', logLevel: quiet ? 'error' : 'info' });
  }

  server.on('request', async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // The launcher's loading screen asks this until QuantBot itself answers
    if (url.pathname === '/__launcher/status') return send(res, 200, { percent: 100, label: 'Ready', ready: true });
    if (url.pathname.startsWith('/api/')) {
      try {
        await handleApi(req, res, { backend, market, app }, url);
      } catch (e) {
        // The desktop app writes the full error to logs\quantbot.log in its install folder (Settings > Logs)
        app?.log?.(`${req.method} ${url.pathname}: ${e.stack || e}`);
        if (!res.headersSent) send(res, e.status || 500, { error: e.message || String(e) });
      }
      return;
    }
    if (vite) vite.middlewares(req, res);
    else serveStatic(req, res, dist);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const close = async () => {
    backend.flush();
    if (vite) await vite.close();
    await new Promise((r) => server.close(r));
  };
  return { server, port: server.address().port, close, backend, market };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prod = process.argv.includes('--prod');
  const port = Number(process.env.QUANTBOT_PORT) || 5173;
  const dataDir = process.env.QUANTBOT_DATA ? path.resolve(process.env.QUANTBOT_DATA) : undefined;
  startServer({ port, dataDir, prod }).then((app) => {
    console.log(`QuantBot running at http://localhost:${app.port}`);
    const stop = () => app.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Set QUANTBOT_PORT to another port.` : e.message);
    process.exit(1);
  });
}
