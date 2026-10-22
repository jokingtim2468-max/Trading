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
import { createSignals } from './signals.js';
import { createCopier } from './copier.js';
import { createScriptFolders } from './scriptFolders.js';
import { createNews } from './news.js';
import { createMt5Bridge } from './mt5.js';
import { createPayouts } from './payouts.js';
import { pcZone } from './lib/blackout.js';
import { createDaemonApi, sanitizeResult, parseBulk } from './mt5daemon.js';
import { createTrainer } from './train.js';
import { createTerminal } from './terminal.js';
import { createFastLane } from './fastlane.js';
import { createFleet } from './fleet.js';
import { loadPresets } from './lib/fleetRules.js';
import { createAgents } from './agents.js';

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

const FOLDER_ENTITIES = new Set(['Script', 'CopyGroup', 'TradingAccount', 'AccountTrade', 'CopyEvent']);

async function handleApi(req, res, { backend, market, app, signals, port, folders, news, payouts, daemon, trainer, terminal, lane, fleet, agents }, url) {
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

  // Signals page: the webhook addresses (this PC for MT5, the desktop app's public link for TradingView)
  // Multi-broker MT5 accounts for the auto-login daemon: add one or many (passwords encrypted here), set a password,
  // the daemon's token and command, and the script itself
  if (req.method === 'POST' && url.pathname === '/api/mt5/accounts') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
    const { rows, errors } = body.bulk != null ? parseBulk(body.bulk) : { rows: Array.isArray(body.accounts) ? body.accounts : [body], errors: [] };
    const results = [...errors.map((e) => ({ ...e, action: 'error' })), ...(await daemon.addMany(rows))];
    folders.syncSoon();
    return send(res, 200, { results });
  }
  if (req.method === 'POST' && url.pathname === '/api/mt5/password') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    const { id, password } = JSON.parse((await readBody(req, 4000)).toString('utf8') || '{}');
    return send(res, 200, await daemon.setPassword(id, password));
  }
  if (req.method === 'GET' && url.pathname === '/api/mt5/daemon') {
    const base = `http://127.0.0.1:${port()}`;
    return send(res, 200, { token: daemon.token(), url: base, ...(await daemon.status()) });
  }
  if (req.method === 'POST' && url.pathname === '/api/mt5/daemon/rotate') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    return send(res, 200, { token: daemon.rotate() });
  }
  if (req.method === 'GET' && url.pathname === '/api/mt5/daemon/script') {
    res.writeHead(200, { 'content-type': 'text/x-python; charset=utf-8', 'content-disposition': 'attachment; filename="mt5_manager.py"' });
    return res.end(fs.readFileSync(path.join(root, 'mt5', 'mt5_manager.py')));
  }
  // Start with Windows (desktop app), for a 24/7 VPS
  if (url.pathname === '/api/app/startup') {
    if (!app?.startup) return send(res, 200, { available: false });
    if (req.method === 'POST') {
      if (!json()) return send(res, 415, { error: 'JSON required' });
      const { on } = JSON.parse((await readBody(req, 1000)).toString('utf8') || '{}');
      app.startup.set(!!on);
    }
    return send(res, 200, { available: true, on: app.startup.get() });
  }

  // Economic calendar for news blackouts, and this PC's time zone (blackout times are in it)
  if (req.method === 'GET' && url.pathname === '/api/news') {
    const from = Date.now() - 86400000, to = Date.now() + 9 * 86400000;
    return send(res, 200, { events: news.events().filter((e) => { const t = Date.parse(e.time); return t >= from && t <= to; }), status: news.status(), tz: pcZone() });
  }
  if (req.method === 'POST' && url.pathname === '/api/news/refresh') return send(res, 200, { ...(await news.refresh()), status: news.status() });
  if (req.method === 'POST' && url.pathname === '/api/payouts/check') return send(res, 200, { due: (await payouts.check()).length });
  // The MT5 copier EA for an account's terminal, and the address it calls
  if (req.method === 'GET' && url.pathname === '/api/mt5/ea') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="QuantBotCopier.mq5"' });
    return res.end(fs.readFileSync(path.join(root, 'mt5', 'QuantBotCopier.mq5')));
  }
  if (req.method === 'GET' && url.pathname === '/api/mt5/url') {
    const id = url.searchParams.get('account') || '';
    return send(res, 200, { url: `http://127.0.0.1:${port()}/mt5/${signals.key()}/${id}`, allow: `http://127.0.0.1:${port()}`, fast_lane: lane?.port() ? `127.0.0.1:${lane.port()}` : null });
  }

  // Script folders for Claude: where they are (brought up to date first); the desktop app can open them
  if (req.method === 'GET' && url.pathname === '/api/scripts/folders') {
    return send(res, 200, { ...(await folders.sync()), canOpen: !!app?.openScriptsFolder });
  }
  if (req.method === 'POST' && url.pathname === '/api/scripts/open') {
    const { id } = JSON.parse((await readBody(req, 2000)).toString('utf8') || '{}');
    const { scripts, root: dir } = await folders.sync();
    const target = id ? scripts.find((s) => s.id === id)?.dir : dir;
    if (!target || !app?.openScriptsFolder) return send(res, 400, { error: 'Open the folder from the desktop app' });
    const failed = await app.openScriptsFolder(target);
    return failed ? send(res, 500, { error: failed }) : send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/signals/config') {
    const tunnel = app?.tunnel ? app.tunnel.status() : { available: false };
    return send(res, 200, { key: signals.key(), localUrl: `http://127.0.0.1:${port()}/hook/${signals.key()}`, tunnel });
  }
  if (req.method === 'POST' && url.pathname === '/api/signals/rotate') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    signals.rotate();
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/signals/tunnel') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    if (!app?.tunnel) return send(res, 400, { error: 'The public link is part of the desktop app' });
    const { on } = JSON.parse((await readBody(req, 1000)).toString('utf8') || '{}');
    return send(res, 200, on ? await app.tunnel.start() : await app.tunnel.stop());
  }
  if (req.method === 'POST' && url.pathname === '/api/signals/test') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    const body = (await readBody(req, 4000)).toString('utf8');
    return send(res, 200, await signals.receive(body, { local: true }));
  }

  // Agent Team: per-agent folders, sandboxed file commands and the local model's turns
  if (url.pathname.startsWith('/api/agents/') && req.method === 'POST') {
    const b = JSON.parse((await readBody(req, 600000)).toString('utf8') || '{}');
    const p = url.pathname.slice('/api/agents/'.length);
    if (!json()) return send(res, 415, { error: 'JSON required' });
    if (p === 'setup') return send(res, 200, agents.setup(b));
    if (p === 'fs') return send(res, 200, agents.fsOp(b));
    if (p === 'chat') return send(res, 200, await agents.chat(b));
  }
  if (req.method === 'GET' && url.pathname === '/api/agents/system') return send(res, 200, { system: agents.system });
  // Fleet: account profiles, the simplified accounts list, deploy, pause, payout audit, notifications
  // The prop-firm account presets (firms, models, sizes, rules), for the Strategy Tester's account picker
  if (req.method === 'GET' && url.pathname === '/api/presets') return send(res, 200, loadPresets());
  if (url.pathname.startsWith('/api/fleet')) {
    const body = async () => { if (!json()) throw Object.assign(new Error('JSON required'), { status: 415 }); return JSON.parse((await readBody(req, 20000)).toString('utf8') || '{}'); };
    const p = url.pathname.slice('/api/fleet'.length);
    if (req.method === 'GET' && p === '') return send(res, 200, await fleet.view());
    if (req.method === 'POST' && p === '/deploy') return send(res, 200, await fleet.deploy(await body()));
    if (req.method === 'POST' && p === '/pause') { const b = await body(); return send(res, 200, await fleet.pause(b.account_id, b.paused)); }
    if (req.method === 'POST' && p === '/audit') return send(res, 200, await fleet.audit((await body()).account_id));
    if (req.method === 'POST' && p === '/settings') return send(res, 200, fleet.settings(await body()));
    if (req.method === 'GET' && p.startsWith('/set/')) {
      const f = fleet.setPath(decodeURIComponent(p.slice(5)));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'No set file for that account' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${path.basename(f)}"` });
      return fs.createReadStream(f).pipe(res);
    }
  }
  // Terminal page: chart settings (presets, AI edits, versions) and orders to a copy group
  if (url.pathname.startsWith('/api/terminal/')) {
    const body = async (limit = 20000) => { if (!json()) throw Object.assign(new Error('JSON required'), { status: 415 }); return JSON.parse((await readBody(req, limit)).toString('utf8') || '{}'); };
    const p = url.pathname.slice('/api/terminal/'.length);
    if (req.method === 'GET' && p === 'chart') return send(res, 200, terminal.chart());
    if (req.method === 'POST' && p === 'chart/preset') return send(res, 200, terminal.preset((await body()).id));
    if (req.method === 'POST' && p === 'chart/set') { const b = await body(); return send(res, 200, terminal.set(b.change, b.note)); }
    if (req.method === 'POST' && p === 'chart/revert') { await body(); return send(res, 200, terminal.revert()); }
    if (req.method === 'POST' && p === 'chart/restore') return send(res, 200, terminal.restore((await body()).n));
    if (req.method === 'POST' && p === 'indicator') { const b = await body(); return send(res, 200, await terminal.indicator(b.code, b.why, b.model)); }
    if (req.method === 'POST' && p === 'chart/edit') { const b = await body(); return send(res, 200, await terminal.edit(b.message, b.model)); }
    if (req.method === 'POST' && p === 'order') return send(res, 200, await terminal.order(await body()));
    if (req.method === 'GET' && p === 'positions') return send(res, 200, await terminal.positionsAll(url.searchParams.get('group')));
    if (req.method === 'POST' && p === 'guard') { const b = await body(); return send(res, 200, { accounts: await terminal.guard(b.group_id, b.ticket || null) }); }
    if (req.method === 'GET' && p === 'predictions') return send(res, 200, { predictions: terminal.predictions() });
    if (req.method === 'GET' && p === 'overview') return send(res, 200, { groups: await terminal.overview(lane?.connected() || []) });
    if (req.method === 'POST' && p === 'protect') { const b = await body(); return send(res, 200, { protect: await terminal.protect(b.group_id, b.rules) }); }
    if (req.method === 'POST' && p === 'flatten') return send(res, 200, await terminal.flatten((await body()).price));
    if (req.method === 'GET' && p === 'quote') {
      // Live MT5 tick when the fast lane has one (last 15 s), else Dukascopy's latest minute candles
      const sym = url.searchParams.get('symbol') || 'XAUUSD';
      const t = lane?.tick(sym);
      if (t && Date.now() - t.at < 15000) return send(res, 200, { symbol: sym, source: 'mt5', price: t.bid, bid: t.bid, ask: t.ask, candles: [{ time: t.time, open: t.bid, high: t.bid, low: t.bid, close: t.bid }] });
      return send(res, 200, { ...(await terminal.quote(sym)), source: 'dukascopy' });
    }
    // Server-sent events: MT5 ticks, fills (with times), pending fills / trails / alerts, fast lane up / down
    if (req.method === 'GET' && p === 'stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ lanes: lane?.connected() || [] })}\n\n`);
      const off = lane?.subscribe((type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { off?.(); clearInterval(ping); });
      return undefined;
    }
    if (req.method === 'POST' && p === 'tick') { const b = await body(); return send(res, 200, await terminal.tick(String(b.symbol || ''), b.price)); }
    if (req.method === 'POST' && p === 'alert') return send(res, 200, terminal.alert(await body()));
    if (req.method === 'POST' && p === 'predict') { const b = await body(); return send(res, 200, await terminal.predict(String(b.symbol || 'XAUUSD'), b.daily, b.model)); }
    if (req.method === 'POST' && p === 'snapshot') { const b = await body(6 * 1024 * 1024); return send(res, 200, await terminal.snapshot(b.trade_id, b.kind, b.image)); }
    if (req.method === 'GET' && p.startsWith('snap/')) {
      const f = terminal.snapFile(p.slice(5));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'No such snapshot' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
  }

  // Train page: Unsloth fine-tuning in Docker
  // The title bar's model light: is the local model set, installed, and loaded in Ollama right now?
  if (req.method === 'GET' && url.pathname === '/api/model/status') {
    const me = backend.handle('user', 'me');
    const model = me.ollama_model || null;
    if (!model) return send(res, 200, { state: 'unset', model: null });
    const base = String(me.ollama_url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    try {
      const tags = await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) })).json();
      const same = (n) => n === model || n === `${model}:latest`;
      if (!(tags.models || []).some((m) => same(m.name))) return send(res, 200, { state: 'missing', model });
      const ps = await (await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2500) })).json().catch(() => ({}));
      return send(res, 200, { state: (ps.models || []).some((m) => same(m.name)) ? 'loaded' : 'ready', model });
    } catch { return send(res, 200, { state: 'off', model }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/train/status') return send(res, 200, { ...(await trainer.status()), models: trainer.models, defaults: trainer.defaults, image_name: trainer.image, exports: trainer.exportsList });
  if (req.method === 'GET' && url.pathname === '/api/train/hf') return send(res, 200, await trainer.hf.account());
  if (req.method === 'POST' && url.pathname === '/api/train/hf') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    const { token } = JSON.parse((await readBody(req, 2000)).toString('utf8') || '{}');
    return send(res, 200, await trainer.hf.save(token));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/train/hf') return send(res, 200, trainer.hf.remove());
  if (req.method === 'GET' && url.pathname === '/api/train/hf/search') return send(res, 200, { models: await trainer.hf.search(url.searchParams.get('q')) });
  if (req.method === 'GET' && url.pathname === '/api/train/hf/model') return send(res, 200, await trainer.hf.model(url.searchParams.get('id') || ''));
  if (req.method === 'GET' && url.pathname === '/api/train/local') return send(res, 200, await trainer.local(url.searchParams.get('path') || ''));
  if (req.method === 'POST' && url.pathname === '/api/train/pull') { if (!json()) return send(res, 415, { error: 'JSON required' }); return send(res, 200, trainer.pull()); }
  if (req.method === 'GET' && url.pathname === '/api/train/runs') return send(res, 200, { runs: trainer.runs() });
  if (req.method === 'GET' && url.pathname === '/api/train/auto') return send(res, 200, await trainer.auto(url.searchParams.get('model')));
  const recipe = url.pathname.match(/^\/api\/train\/runs\/([0-9a-z-]+)\/recipe(?:\/([^/]+))?$/i);
  if (req.method === 'GET' && recipe) {
    if (!recipe[2]) return send(res, 200, { files: trainer.recipe(recipe[1]) });
    const f = trainer.recipeFile(recipe[1], decodeURIComponent(recipe[2]));
    if (!f) return send(res, 404, { error: 'No such file' });
    res.writeHead(200, { 'content-type': f.endsWith('.yaml') ? 'application/x-yaml' : 'application/x-ndjson', 'content-disposition': `attachment; filename="${path.basename(f)}"` });
    return fs.createReadStream(f).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/api/train/autoconfig') return send(res, 200, await trainer.autoConfig());
  if (req.method === 'POST' && url.pathname === '/api/train/autostart') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    return send(res, 200, await trainer.autoStart(JSON.parse((await readBody(req, 2000)).toString('utf8') || '{}')));
  }
  if (req.method === 'POST' && url.pathname === '/api/train/start') {
    if (!json()) return send(res, 415, { error: 'JSON required' });
    return send(res, 200, await trainer.start(JSON.parse((await readBody(req, 20000)).toString('utf8') || '{}')));
  }
  const trainRun = url.pathname.match(/^\/api\/train\/runs\/([0-9a-z-]+)(\/stop)?$/i);
  if (trainRun) {
    const [, id, action] = trainRun;
    if (req.method === 'GET' && !action) { const r = trainer.run(id); return r ? send(res, 200, r) : send(res, 404, { error: 'No such run' }); }
    if (req.method === 'POST' && action === '/stop') { if (!json()) return send(res, 415, { error: 'JSON required' }); return send(res, 200, await trainer.stop(id)); }
    if (req.method === 'DELETE' && !action) return send(res, 200, trainer.remove(id));
  }

  if (req.method === 'POST' && url.pathname === '/api/invoke') {
    // A JSON content type forces a CORS preflight for cross-site requests, which this server never approves
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
    const { kind, args } = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}');
    if (kind === 'file') return send(res, 400, { error: 'Upload files through /api/files' });
    const list = Array.isArray(args) ? args : [];
    // MT5 passwords only go in through /api/mt5 (encrypted) and never come out to the pages
    if (kind === 'entity' && list[0] === 'TradingAccount' && ['create', 'update'].includes(list[1])) {
      const data = list[1] === 'create' ? list[2] : list[3];
      if (data && typeof data === 'object') { delete data.password_enc; delete data.password; }
    }
    const raw = await backend.handle(kind, ...list);
    const result = kind === 'entity' && list[0] === 'TradingAccount' ? sanitizeResult(raw) : raw;
    // Copy trading actions taken in the app (script dropped on a group, account moved, reset...) also go in the log file
    if (kind === 'entity' && list[0] === 'CopyEvent' && list[1] === 'create' && list[2]?.message) app?.log?.(`copy ${list[2].kind || 'setup'}: ${list[2].message}`);
    if (kind === 'entity' && FOLDER_ENTITIES.has(list[0]) && !['get', 'filter', 'list', 'count', 'aggregate'].includes(list[1])) folders.syncSoon();
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
  // Today's model high / low for a symbol (asks the local model once a day, then answers from memory) and the
  // recent days' levels, for scripts outside the app (tools/daily_levels.py writes them into a Pine indicator)
  if (req.method === 'GET' && url.pathname === '/api/levels') {
    const symbol = String(url.searchParams.get('symbol') || 'XAUUSD').toUpperCase();
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const d = await market.bars(symbol, 'D1', day(Date.now() - 45 * 86400000), day(Date.now()));
    const daily = Array.from(d.time, (t, i) => ({ time: t, open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i] }));
    const today = await terminal.predict(symbol, daily, url.searchParams.get('model') || undefined);
    const history = terminal.predictions().filter((x) => x.symbol === symbol).slice(-30);
    return send(res, 200, { symbol, today, history });
  }
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
// newsFetch: replaces fetch for the economic calendars (tests)
export async function startServer({ port = 5173, dataDir = path.join(root, 'data'), prod = false, userName, quiet = false, app = null, newsFetch } = {}) {
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

  const entityDb = { run: (...a) => backend.handle('entity', ...a) };
  // A folder per script next to the logs (desktop app) or in the data folder, for Claude's context
  const folders = createScriptFolders({ root: app?.scriptsDir?.() || path.join(dataDir, 'scripts'), db: entityDb, log: app?.log });
  backend.setFolders(folders);
  folders.syncSoon(300);
  // Economic calendars for news blackouts, refreshed every 30 minutes
  const news = createNews({ dataDir, log: app?.log, ...(newsFetch ? { fetch: newsFetch } : {}) });
  news.start();
  let lane = null;
  const copier = createCopier({ db: entityDb, log: app?.log, news: () => news.events(), onMt5: (order, t0) => lane?.push(order, t0) });
  const signals = createSignals({ dataDir, db: entityDb, log: app?.log, copier });
  // MT5 terminals (QuantBot Copier EA) and auto-withdraw, both writing to the copy trading activity log
  const mt5 = createMt5Bridge({ db: entityDb, note: copier.note });
  const daemon = createDaemonApi({ dataDir, db: entityDb, cipher, log: app?.log });
  const trainer = createTrainer({ dataDir, market, cipher, log: app?.log, ollama: () => { try { const me = backend.handle('user', 'me'); return { url: me.ollama_url, model: me.ollama_model }; } catch { return {}; } },
    // The best tested version of each of the trader's bots that passed the bar
    goodScripts: () => {
      try {
        const best = new Map();
        for (const r of backend.handle('entity', 'StrategyRun', 'filter', {}, { limit: 5000 }).items) {
          const m = r.metrics || {};
          if (!(m.profitFactor > 1.3 && m.maxDDPct < 10 && m.trades >= 30 && r.code)) continue;
          const old = best.get(r.bot_name);
          if (!old || m.profitFactor > old.pf) best.set(r.bot_name, { name: r.bot_name, target: r.target, symbol: r.symbol, code: r.code, summary: r.summary, pf: Math.round(m.profitFactor * 100) / 100, dd: Math.round(m.maxDDPct * 10) / 10, trades: m.trades });
        }
        return [...best.values()];
      } catch { return []; }
    } });
  const terminal = createTerminal({ dataDir, db: entityDb, signals, ask: backend.ask, log: app?.log });
  // MT5 fast lane: live ticks in, orders out the moment they're checked; ticks drive pending orders, trails, alerts
  lane = createFastLane({
    db: entityDb, mt5, key: () => signals.key(), log: app?.log || (() => {}),
    onTick: (t) => terminal.tick(t.symbol, t.bid, t).then((r) => { if (r.fired.length || r.moved.length || r.alerts.length) lane.emit('book', r); }).catch(() => {}),
  });
  terminal.onBook = (r) => lane.emit('book', r);
  lane.subscribe((type, d) => { if (type === 'lane' && d.up) terminal.warm().catch(() => {}); });
  setTimeout(() => terminal.warm().catch(() => {}), 3000).unref?.();
  const lockTimer = setInterval(() => terminal.sweepLocks().catch((e) => app?.log?.(`profit lock: ${e.message}`)), 5000);
  lockTimer.unref?.();
  let fleet = null;
  const payouts = createPayouts({ db: entityDb, note: copier.note, notify: (t) => fleet?.notify(t) });
  fleet = createFleet({ dataDir, db: entityDb, payouts, log: app?.log });
  const agents = createAgents({ dataDir, user: { me: () => backend.handle('user', 'me') }, log: app?.log });
  const checkPayouts = () => payouts.check().then((p) => p.length && folders.syncSoon()).catch((e) => app?.log?.(`payouts: ${e.message}`));
  const payoutTimer = setInterval(checkPayouts, 3600000);
  payoutTimer.unref?.();
  setTimeout(checkPayouts, 30000).unref?.();
  const server = http.createServer();
  const boundPort = () => server.address()?.port;
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
    // Webhook for TradingView alerts and MT5 EAs: open to any host (the public link forwards here), guarded by the key
    const hook = url.pathname.match(/^\/hook\/([^/]+)(?:\/s\/([A-Za-z0-9]+))?\/?$/);
    if (hook) {
      if (req.method !== 'POST' || !signals.matches(hook[1])) return send(res, 404, { error: 'Not found' });
      try {
        const body = (await readBody(req, 4000)).toString('utf8');
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        const saved = await signals.receive(body, { userAgent: String(req.headers['user-agent'] || ''), local: LOCAL_HOSTS.has(host) && !req.headers['cf-connecting-ip'], scriptId: hook[2] });
        folders.syncSoon();
        return send(res, 200, { ok: true, id: saved.id });
      } catch (e) {
        app?.log?.(`signal rejected: ${e.message}`);
        return send(res, e.status || 400, { error: e.message });
      }
    }
    // The MT5 auto-login daemon (mt5/mt5_manager.py) on this PC / VPS: local only, guarded by its token
    if (url.pathname === '/daemon/accounts' || url.pathname === '/daemon/status') {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host) || req.headers['cf-connecting-ip'] || req.headers.origin || !daemon.matches(req.headers['x-quantbot-daemon'])) return send(res, 404, { error: 'Not found' });
      try {
        if (url.pathname === '/daemon/accounts') return send(res, 200, { accounts: await daemon.forDaemon() });
        if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
        return send(res, 200, await daemon.report(JSON.parse((await readBody(req, 8000)).toString('utf8') || '{}')));
      } catch (e) {
        return send(res, e.status || 400, { error: e.message });
      }
    }
    // The MT5 copier EA on this PC / VPS: local only, guarded by the webhook key
    const ea = url.pathname.match(/^\/mt5\/([^/]+)\/([A-Za-z0-9]+)\/(poll|ack)$/);
    if (ea) {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host) || req.headers['cf-connecting-ip'] || !signals.matches(ea[1])) return send(res, 404, { error: 'Not found' });
      try {
        if (ea[3] === 'poll') {
          const text = await mt5.poll(ea[2]);
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          return res.end(text);
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
        const n = await mt5.ack(ea[2], (await readBody(req, 20000)).toString('utf8'));
        folders.syncSoon();
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(String(n));
      } catch (e) {
        return send(res, e.status || 400, { error: e.message });
      }
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        await handleApi(req, res, { backend, market, app, signals, port: boundPort, folders, news, payouts, daemon, trainer, terminal, lane, fleet, agents }, url);
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
  await lane.listen(port ? server.address().port + 1 : 0);

  const close = async () => {
    news.stop();
    clearInterval(payoutTimer);
    clearInterval(lockTimer);
    backend.flush();
    await lane.close();
    if (vite) await vite.close();
    await new Promise((r) => server.close(r));
  };
  return { server, port: server.address().port, close, backend, market, signals, lane };
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
