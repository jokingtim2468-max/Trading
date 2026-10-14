// The trader's profile, API keys and uploaded files, all in the app's data folder on this PC.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { KEY_PROVIDERS } from './lib/keyRules.js';

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const BUILT_IN = ['id', 'email', 'role', 'created_date'];

// One trader per PC; settings like default models live on the profile
export function createUser(dir, name) {
  const file = path.join(dir, 'profile.json');
  const me = () => ({ full_name: name || 'Trader', ...readJson(file, {}), id: 'local', email: '', role: 'admin' });
  return {
    me,
    update(data) {
      const profile = readJson(file, {});
      for (const [k, v] of Object.entries(data || {})) if (!BUILT_IN.includes(k)) profile[k] = v;
      writeJson(file, profile);
      return me();
    },
  };
}

// Claude / Gemini keys, encrypted with this PC's secret key (server/crypto.js); only ever sent to their provider
export function createKeys(dir, encrypt, decrypt) {
  const file = path.join(dir, 'keys.json');
  const all = () => readJson(file, {});
  return {
    get: (provider) => { const r = all()[provider]; return r ? decrypt(r.ciphertext) : null; },
    set(provider, key) {
      const a = all();
      a[provider] = { ciphertext: encrypt(key), last4: key.slice(-4) };
      writeJson(file, a);
    },
    remove(provider) {
      const a = all();
      delete a[provider];
      writeJson(file, a);
    },
    status() {
      const a = all();
      return Object.fromEntries(Object.keys(KEY_PROVIDERS).map((p) => [p, a[p] ? { linked: true, last4: a[p].last4 } : { linked: false }]));
    },
  };
}

// Uploaded files (candle CSVs); the app reads them back at /api/files/<name>
export function createFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    upload(name, bytes) {
      const safe = path.basename(String(name || 'file')).replace(/[^\w.-]+/g, '_').slice(-100);
      const stored = `${crypto.randomUUID().slice(0, 8)}-${safe}`;
      fs.writeFileSync(path.join(dir, stored), Buffer.from(bytes));
      return { file_uri: `local-file://${stored}`, file_url: `/api/files/${stored}` };
    },
    path: (stored) => path.join(dir, path.basename(String(stored))),
  };
}