// AES-256-GCM for stored API keys. The 32-byte secret is created once in the data folder (owner-only
// permissions) or taken from QUANTBOT_SECRET (64 hex characters).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function loadSecret(dataDir) {
  const fromEnv = process.env.QUANTBOT_SECRET;
  if (fromEnv) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnv)) throw new Error('QUANTBOT_SECRET must be 64 hex characters');
    return Buffer.from(fromEnv, 'hex');
  }
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

export function createCipher(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const key = loadSecret(dataDir);
  return {
    // -> "iv.tag.ciphertext", base64 parts
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
    },
    decrypt(stored) {
      const [iv, tag, data] = String(stored).split('.').map((s) => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString('utf8');
    },
  };
}
