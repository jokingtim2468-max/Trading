// Multi-broker MT5 accounts for the 24/7 auto-login daemon (mt5/mt5_manager.py).
// Accounts are ordinary TradingAccount records (platform MT5): broker in `firm`, account number in `login`, plus
// `capital`, `enabled` (the daemon keeps it logged in) and `terminal_path` (that account's own terminal64.exe).
// The password is stored only encrypted (`password_enc`, AES-256-GCM, the same key as the API keys) and is never
// sent to the app's pages; only the daemon on this PC gets it, over 127.0.0.1 with the daemon token.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomName, randomSeed } from './lib/copyRules.js';

const STATUS_SAVE_MS = 60000;

// Fields the pages never see
export function sanitizeAccount(a) {
  if (!a || typeof a !== 'object') return a;
  const { password_enc: enc, ...rest } = a;
  return { ...rest, has_password: !!enc };
}
export function sanitizeResult(result) {
  if (Array.isArray(result)) return result.map(sanitizeAccount);
  if (result && Array.isArray(result.items)) return { ...result, items: result.items.map(sanitizeAccount) };
  return sanitizeAccount(result);
}

// "broker, account number, password, server[, capital[, terminal path]]" per line (comma, semicolon or tab)
export function parseBulk(text) {
  const rows = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return;
    const sep = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ',';
    const [broker, number, password, server, capital, terminal] = raw.split(sep).map((x) => x.trim());
    if (i === 0 && /broker/i.test(broker) && /account/i.test(number || '')) return; // header line
    if (!broker || !number || !password || !server) { errors.push({ line: i + 1, error: 'needs broker, account number, password and server' }); return; }
    rows.push({ broker_name: broker, account_number: number, password, server, capital, terminal_path: terminal, line: i + 1 });
  });
  return { rows, errors };
}

export function validateAccount(a) {
  const number = String(a.account_number ?? '').trim();
  if (!String(a.broker_name || '').trim()) return 'Broker is required';
  if (!/^\d{3,15}$/.test(number)) return 'Account number must be digits';
  if (!String(a.server || '').trim()) return 'Server is required (exactly as MT5 shows it)';
  if (a.capital != null && a.capital !== '' && !(Number(a.capital) >= 0)) return 'Capital must be a number';
  if (a.terminal_path && !/terminal64\.exe$/i.test(String(a.terminal_path).trim())) return 'Terminal path must end in terminal64.exe';
  return null;
}

export function createDaemonApi({ dataDir, db, cipher, log = () => {} }) {
  const run = async (...a) => db.run(...a);
  const file = path.join(dataDir, 'daemon.json');
  let token;
  try { token = JSON.parse(fs.readFileSync(file, 'utf8')).token; } catch { /* first run */ }
  const saveToken = () => fs.writeFileSync(file, JSON.stringify({ token }), { mode: 0o600 });
  if (!/^[0-9a-f]{40}$/.test(token || '')) { token = crypto.randomBytes(20).toString('hex'); saveToken(); }
  const live = new Map(); // account id -> last report
  const savedAt = new Map();

  const mt5Accounts = async () => (await run('TradingAccount', 'filter', { platform: 'MT5' }));

  // Add one account, or update the one with the same number on the same server
  async function upsert(a) {
    const bad = validateAccount(a);
    if (bad) throw Object.assign(new Error(bad), { status: 400 });
    const number = String(a.account_number).trim(), server = String(a.server).trim();
    const capital = a.capital === '' || a.capital == null ? null : Number(a.capital);
    const fields = {
      platform: 'MT5', firm: String(a.broker_name).trim(), login: number, server,
      ...(capital != null ? { capital } : {}),
      ...(a.terminal_path ? { terminal_path: String(a.terminal_path).trim() } : {}),
      enabled: a.enabled !== false, portable: a.portable !== false,
      ...(a.password ? { password_enc: cipher.encrypt(String(a.password)) } : {}),
    };
    const existing = (await mt5Accounts()).find((x) => String(x.login) === number && String(x.server).toLowerCase() === server.toLowerCase());
    if (existing) {
      const saved = await run('TradingAccount', 'update', existing.id, fields);
      return { action: 'updated', account: sanitizeAccount(saved) };
    }
    const start = capital ?? 0;
    const saved = await run('TradingAccount', 'create', {
      ...fields, label: `${fields.firm} ${number}`, display_name: randomName(), avatar_seed: randomSeed(), group_id: '',
      plan: 'none', start_balance: start, balance: start, environment: '',
    });
    return { action: 'added', account: sanitizeAccount(saved) };
  }

  async function addMany(list) {
    const results = [];
    for (const a of list) {
      try { results.push({ line: a.line, ...(await upsert(a)) }); } catch (e) { results.push({ line: a.line, action: 'error', error: e.message, account_number: a.account_number }); }
    }
    const n = (k) => results.filter((r) => r.action === k).length;
    log(`mt5 accounts: ${n('added')} added, ${n('updated')} updated, ${n('error')} rejected`);
    return results;
  }

  async function setPassword(id, password) {
    if (!password) throw Object.assign(new Error('Password is required'), { status: 400 });
    await run('TradingAccount', 'update', id, { password_enc: cipher.encrypt(String(password)) });
    return { ok: true };
  }

  // What the daemon needs to log each enabled account in (passwords decrypted here, for 127.0.0.1 only)
  async function forDaemon() {
    const out = [];
    for (const a of await mt5Accounts()) {
      if (a.enabled === false || !a.password_enc) continue;
      let password;
      try { password = cipher.decrypt(a.password_enc); } catch { log(`mt5 daemon: password for ${a.label} can't be read, enter it again`); continue; }
      out.push({
        id: a.id, label: a.label, broker_name: a.firm || '', account_number: Number(a.login), password, server: a.server,
        terminal_path: a.terminal_path || '', portable: a.portable !== false,
      });
    }
    return out;
  }

  // A report from the daemon: connected / connecting / error, with the broker's balance and equity
  async function report(body) {
    const id = String(body?.id || '');
    let acc;
    try { acc = await run('TradingAccount', 'get', id); } catch { throw Object.assign(new Error('No such account'), { status: 404 }); }
    const state = ['connected', 'connecting', 'error', 'stopped'].includes(body.state) ? body.state : 'error';
    const rep = {
      daemon_state: state, daemon_error: String(body.error || '').slice(0, 300), daemon_seen_at: new Date().toISOString(),
      ...(Number.isFinite(Number(body.balance)) && body.balance != null ? { broker_balance: Number(body.balance) } : {}),
      ...(Number.isFinite(Number(body.equity)) && body.equity != null ? { broker_equity: Number(body.equity) } : {}),
      ...(body.currency ? { broker_currency: String(body.currency).slice(0, 8) } : {}),
      ...(body.algo_trading != null ? { algo_trading: !!body.algo_trading } : {}),
    };
    const before = live.get(id);
    live.set(id, rep);
    // Saved on a change of state, and otherwise once a minute (the daemon reports every 30 s)
    if (!before || before.daemon_state !== state || before.daemon_error !== rep.daemon_error || Date.now() - (savedAt.get(id) || 0) > STATUS_SAVE_MS) {
      savedAt.set(id, Date.now());
      await run('TradingAccount', 'update', id, rep);
      if (!before || before.daemon_state !== state || before.daemon_error !== rep.daemon_error) {
        log(`mt5 daemon: ${acc.label} ${state}${rep.daemon_error ? `: ${rep.daemon_error}` : ''}`);
      }
    }
    return { ok: true };
  }

  return {
    token: () => token,
    matches(candidate) {
      const a = Buffer.from(String(candidate || '')), b = Buffer.from(token);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    rotate() { token = crypto.randomBytes(20).toString('hex'); saveToken(); return token; },
    addMany, upsert, setPassword, forDaemon, report,
    status: async () => {
      const accs = (await mt5Accounts()).map(sanitizeAccount);
      const seen = accs.map((a) => a.daemon_seen_at).filter(Boolean).sort().at(-1) || null;
      return {
        accounts: accs.length, enabled: accs.filter((a) => a.enabled !== false).length,
        with_password: accs.filter((a) => a.has_password).length,
        connected: accs.filter((a) => live.get(a.id)?.daemon_state === 'connected' && Date.now() - Date.parse(live.get(a.id).daemon_seen_at) < 120000).length,
        last_report: seen,
      };
    },
  };
}
