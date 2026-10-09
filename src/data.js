// Market data: talks to the local MT5 bridge (bridge/mt5_bridge.py) when it
// is running, otherwise falls back to deterministic demo candles so the UI
// still works offline.
import { MT5_SYMBOLS } from './symbols.js';

export class MT5Client {
  constructor(url) { this.url = url; this.connected = false; }

  async req(path, opts) {
    const r = await fetch(this.url + path, { ...opts, headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  }

  async connect() {
    try { const s = await this.req('/status'); this.connected = !!s.connected; return s; }
    catch { this.connected = false; return { connected: false }; }
  }

  async symbols() {
    if (this.connected) { try { return await this.req('/symbols'); } catch { /* fall through */ } }
    return MT5_SYMBOLS;
  }

  async bars(symbol, tf, tfSeconds, count = 1000) {
    if (this.connected) {
      try { return await this.req(`/rates?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&count=${count}`); }
      catch { /* fall through */ }
    }
    return demoBars(symbol, tfSeconds, count);
  }

  async tick(symbol) { return this.connected ? this.req(`/tick?symbol=${encodeURIComponent(symbol)}`) : null; }
  account() { return this.req('/account'); }
  positions() { return this.req('/positions'); }
  orders() { return this.req('/orders'); }
  history() { return this.req('/history'); }
  order(body) { return this.req('/order', { method: 'POST', body: JSON.stringify(body) }); }
  close(ticket) { return this.req('/close', { method: 'POST', body: JSON.stringify({ ticket }) }); }
  login(body) { return this.req('/login', { method: 'POST', body: JSON.stringify(body) }); }
  experts() { return this.req('/experts'); }
  uploadExpert(name, contentBase64) { return this.req('/experts', { method: 'POST', body: JSON.stringify({ name, content: contentBase64 }) }); }
  deleteExpert(name) { return this.req(`/experts?name=${encodeURIComponent(name)}`, { method: 'DELETE' }); }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function demoBars(symbol, tfSeconds, count) {
  const info = MT5_SYMBOLS.find((s) => s.name === symbol) || { base: 100, digits: 2 };
  const rand = rng([...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), tfSeconds));
  const now = Math.floor(Date.now() / 1000 / tfSeconds) * tfSeconds;
  const vol = info.base * 0.0015 * Math.sqrt(tfSeconds / 3600);
  const p = 10 ** info.digits;
  const out = [];
  let price = info.base;
  for (let i = count - 1; i >= 0; i--) {
    const open = price;
    const close = open + (rand() - 0.5) * 2 * vol;
    const high = Math.max(open, close) + rand() * vol * 0.6;
    const low = Math.min(open, close) - rand() * vol * 0.6;
    out.push({ time: now - i * tfSeconds, open: r(open), high: r(high), low: r(low), close: r(close), volume: Math.round(500 + rand() * 4500) });
    price = close;
  }
  return out;
  function r(v) { return Math.round(v * p) / p; }
}
