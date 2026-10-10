// Market data (read-only). Talks to the local MT5 bridge (bridge/mt5_bridge.py)
// when it is running, otherwise falls back to deterministic demo candles so
// the UI still works offline. Nothing here can place or change orders.
import { MT5_SYMBOLS } from './symbols.js';

export class MT5Client {
  constructor(url) { this.url = url; this.connected = false; this.demo = new DemoFeed(); }

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
    return this.demo.bars(symbol, tfSeconds, count);
  }

  // Latest bid/ask for many symbols in one round trip.
  async ticks(symbols) {
    if (!symbols.length) return [];
    if (this.connected) return this.req(`/ticks?symbols=${symbols.map(encodeURIComponent).join(',')}`);
    return this.demo.ticks(symbols);
  }

  terminal() { return this.req('/terminal'); }
  login(body) { return this.req('/login', { method: 'POST', body: JSON.stringify(body) }); }
  experts() { return this.req('/experts'); }
  uploadExpert(name, contentBase64) { return this.req('/experts', { method: 'POST', body: JSON.stringify({ name, content: contentBase64 }) }); }
  deleteExpert(name) { return this.req(`/experts?name=${encodeURIComponent(name)}`, { method: 'DELETE' }); }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Offline feed: seeded random-walk candles, plus ticks that continue from
// the last close so the demo charts move like a live market would.
export class DemoFeed {
  constructor() { this.last = {}; this.rand = rng(Date.now()); }

  info(symbol) { return MT5_SYMBOLS.find((s) => s.name === symbol) || { base: 100, digits: 2 }; }

  bars(symbol, tfSeconds, count) {
    const info = this.info(symbol);
    const rand = rng([...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), tfSeconds));
    const now = Math.floor(Date.now() / 1000 / tfSeconds) * tfSeconds;
    const vol = info.base * 0.0015 * Math.sqrt(tfSeconds / 3600);
    const p = 10 ** info.digits;
    const r = (v) => Math.round(v * p) / p;
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
    if (this.last[symbol] == null) this.last[symbol] = out.at(-1).close;
    return out;
  }

  ticks(symbols) {
    const now = Math.floor(Date.now() / 1000);
    return symbols.map((symbol) => {
      const info = this.info(symbol);
      const point = 10 ** -info.digits;
      const prev = this.last[symbol] ?? info.base;
      const bid = +(prev + (this.rand() - 0.5) * info.base * 0.0002).toFixed(info.digits);
      this.last[symbol] = bid;
      const spreadPts = Math.max(1, Math.round((info.base * 0.00008) / point));
      return { symbol, time: now, bid, ask: +(bid + spreadPts * point).toFixed(info.digits), digits: info.digits, point };
    });
  }
}
