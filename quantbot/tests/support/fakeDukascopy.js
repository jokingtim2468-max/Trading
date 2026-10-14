// A stand-in for Dukascopy's candle server: deterministic prices, the same delta-encoded JSON, weekends closed.
// Bid follows a slow wave; ask = bid + a fixed spread per symbol.
import http from 'node:http';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const BASE = { 'XAU-USD': 2000, 'USATECH.IDX-USD': 15000 };
const SPREAD = { 'XAU-USD': 0.3, 'USATECH.IDX-USD': 1.5 };
const MULT = 0.001;

// FX-style week: closed from Friday 21:00 to Sunday 22:00 UTC
export const open = (t) => {
  const d = new Date(t), day = d.getUTCDay(), h = d.getUTCHours();
  return !(day === 6 || (day === 5 && h >= 21) || (day === 0 && h < 22));
};

const price = (code, t) => BASE[code] * (1 + 0.05 * Math.sin(t / (7 * DAY)) + 0.002 * Math.sin(t / (3 * HOUR)));

function candles(code, side, start, end, step) {
  const out = [];
  for (let t = start; t < end; t += step) {
    if (step < DAY && !open(t)) continue;
    const add = side === 'ASK' ? SPREAD[code] : 0;
    const o = price(code, t) + add, c = price(code, t + step - MIN) + add;
    out.push({ t, o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 1.25 });
  }
  return out;
}

function encode(list, start, step) {
  const units = (v) => Math.round(v / MULT);
  const body = { timestamp: start, multiplier: MULT, shift: step, open: 0, high: 0, low: 0, close: 0, times: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  let t = start, o = 0, h = 0, l = 0, c = 0;
  for (const x of list) {
    body.times.push((x.t - t) / step); t = x.t;
    body.opens.push(units(x.o) - o); o = units(x.o);
    body.highs.push(units(x.h) - h); h = units(x.h);
    body.lows.push(units(x.l) - l); l = units(x.l);
    body.closes.push(units(x.c) - c); c = units(x.c);
    body.volumes.push(x.v);
  }
  return body;
}

export async function startFakeDukascopy() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname + url.search);
    const m = url.pathname.match(/^\/v1\/candles\/(minute|hour|day)\/([^/]+)\/(BID|ASK)(?:\/(\d+)(?:\/(\d+))?(?:\/(\d+))?)?$/);
    if (!m) { res.writeHead(404); return res.end(); }
    const [, period, code, side, y, mo, d] = m;
    if (!BASE[code]) { res.writeHead(404); return res.end(); }
    let start, end;
    if (y) {
      start = period === 'minute' ? Date.UTC(+y, +mo - 1, +d) : period === 'hour' ? Date.UTC(+y, +mo - 1, 1) : Date.UTC(+y, 0, 1);
      end = period === 'minute' ? start + DAY : period === 'hour' ? Date.UTC(+y, +mo, 1) : Date.UTC(+y + 1, 0, 1);
    } else {
      start = Number(url.searchParams.get('from'));
      end = Math.min(Date.now(), period === 'minute' ? start + DAY : period === 'hour' ? Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 1) : Date.UTC(new Date(start).getUTCFullYear() + 1, 0, 1));
    }
    const step = period === 'minute' ? MIN : period === 'hour' ? HOUR : DAY;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(encode(candles(code, side, start, end, step), start, step)));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  return { url, requests, close: () => new Promise((r) => server.close(r)), price };
}
