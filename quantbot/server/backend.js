// QuantBot's backend: data, files, keys and AI calls, all kept in the app's data folder on this PC.
// server/index.js serves it over HTTP to the UI.
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from './db.js';
import { createUser, createKeys, createFiles } from './store.js';
import { createFunctions } from './functions.js';

// Default field values from the entity schemas, so new records match what the pages expect
export function entityDefaults(dir) {
  return Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonc')).map((f) => {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    const props = Object.entries(schema.properties || {}).filter(([, p]) => 'default' in p);
    return [schema.name, Object.fromEntries(props.map(([k, p]) => [k, p.default]))];
  }));
}

// market: the built-in market data store (server/market/store.js), read by the chat's data tools
export function createBackend({ dataDir, encrypt, decrypt, userName, defaults, market = null, folders = null }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const user = createUser(dataDir, userName);
  const db = createDb(path.join(dataDir, 'entities'), 'local', defaults);
  const keys = createKeys(dataDir, encrypt, decrypt);
  const files = createFiles(path.join(dataDir, 'files'));
  const functions = createFunctions({ db, user, keys, market, folders: () => folders });
  const setFolders = (f) => { folders = f; };

  return {
    setFolders,
    handle(kind, ...args) {
      switch (kind) {
        case 'entity': return db.run(...args);
        case 'user': return args[0] === 'update' ? user.update(args[1]) : user.me();
        case 'file': return files.upload(args[0], args[1]);
        case 'function': {
          const fn = String(args[0]).startsWith('_') ? null : functions[args[0]];
          if (!fn) throw new Error(`Unknown function ${args[0]}`);
          return fn(args[1] || {});
        }
        default: throw new Error('Unknown request');
      }
    },
    ask: functions._ask,
    filePath: files.path,
    flush: db.flush,
  };
}