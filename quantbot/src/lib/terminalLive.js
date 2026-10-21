// Live and replay helpers for the Terminal: folding the latest minute candles into the chart's bars, and the
// practice trades of replay mode (stops and targets hit inside a bar, the stop first when both are)
export function mergeCandles(bars, candles, tfMs) {
  if (!bars || !candles?.length) return bars;
  const out = Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map((c) => [c, Array.from(bars[c])]));
  let changed = false;
  for (const c of candles) {
    const b = Math.floor(c.time / tfMs) * tfMs, L = out.time.length - 1;
    if (L >= 0 && b < out.time[L]) continue;
    if (L >= 0 && b === out.time[L]) {
      out.high[L] = Math.max(out.high[L], c.high); out.low[L] = Math.min(out.low[L], c.low); out.close[L] = c.close;
    } else {
      out.time.push(b); out.open.push(c.open); out.high.push(c.high); out.low.push(c.low); out.close.push(c.close);
    }
    changed = true;
  }
  return changed ? out : bars;
}

export const sliceBars = (bars, n) => (bars ? Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map((c) => [c, Array.from(bars[c].slice(0, n))])) : bars);

// Where price is a fraction f (0..1) through a candle, the way a chart replays it: a rising candle goes
// open -> low -> high -> close, a falling one open -> high -> low -> close, each leg taking time by its length
export function pathPrice(o, h, l, c, f) {
  const pts = c >= o ? [o, l, h, c] : [o, h, l, c];
  const legs = [Math.abs(pts[1] - pts[0]), Math.abs(pts[2] - pts[1]), Math.abs(pts[3] - pts[2])];
  const total = legs[0] + legs[1] + legs[2];
  if (!total) return c;
  let d = Math.max(0, Math.min(1, f)) * total;
  for (let k = 0; k < 3; k++) {
    if (d <= legs[k] || k === 2) return pts[k] + (pts[k + 1] - pts[k]) * (legs[k] ? Math.min(1, d / legs[k]) : 1);
    d -= legs[k];
  }
  return c;
}

// Replay in real time: the bars closed before `clock`, plus the candle forming at `clock` built from 1-minute bars
// (minutes, when loaded) or from the candle's own path. -> bars, or null before the first bar
export function replayBars(bars, minutes, tfMs, clock) {
  if (!bars?.time.length) return null;
  let i = -1;
  for (let lo = 0, hi = bars.time.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (bars.time[m] <= clock) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i < 0) return null;
  const out = sliceBars(bars, i);
  const t0 = bars.time[i], end = Math.min(t0 + tfMs, i + 1 < bars.time.length ? bars.time[i + 1] : Infinity);
  let o = null, h = -Infinity, l = Infinity, c = null;
  const take = (p) => { if (o == null) o = p; h = Math.max(h, p); l = Math.min(l, p); c = p; };
  const mins = minutes?.time.length && minutes.time[0] <= t0 && minutes.time[minutes.time.length - 1] >= Math.min(clock, end) - 60000;
  if (mins) {
    for (let k = 0; k < minutes.time.length; k++) {
      const mt = minutes.time[k];
      if (mt < t0) continue;
      if (mt > clock || mt >= end) break;
      const f = (clock - mt) / 60000;
      if (f >= 1) { take(minutes.open[k]); take(minutes.high[k]); take(minutes.low[k]); take(minutes.close[k]); } else {
        // The minute that is forming: walk its path up to now
        const steps = Math.max(1, Math.round(f * 12));
        for (let s = 0; s <= steps; s++) take(pathPrice(minutes.open[k], minutes.high[k], minutes.low[k], minutes.close[k], (f * s) / steps));
      }
    }
  }
  if (o == null) {
    const f = (clock - t0) / (end - t0 || 1), steps = Math.max(1, Math.round(f * 40));
    for (let s = 0; s <= steps; s++) take(pathPrice(bars.open[i], bars.high[i], bars.low[i], bars.close[i], (f * s) / steps));
  }
  for (const [k, v] of [['time', t0], ['open', o], ['high', h], ['low', l], ['close', c]]) out[k].push(v);
  return out;
}

const pnlOf = (t, price) => Math.round((price - t.entry) * (t.side === 'long' ? 1 : -1) * t.qty * t.point_value * 100) / 100;

// One replay bar for the open practice trades -> { open, closed } (closed ones get exit, pnl and reason)
export function stepPractice(open, bar) {
  const still = [], closed = [];
  for (const t0 of open) {
    let t = t0;
    const dir = t.side === 'long' ? 1 : -1;
    const worst = dir > 0 ? bar.low : bar.high, best = dir > 0 ? bar.high : bar.low;
    if (t.sl != null && (worst - t.sl) * dir <= 0) { closed.push({ ...t, exit: t.sl, pnl: pnlOf(t, t.sl), reason: 'stop' }); continue; }
    if (t.tp != null && (best - t.tp) * dir >= 0) { closed.push({ ...t, exit: t.tp, pnl: pnlOf(t, t.tp), reason: 'target' }); continue; }
    if (t.trail) {
      const sl = Math.round((bar.close - dir * t.trail) * 100) / 100;
      if (t.sl == null || (sl - t.sl) * dir > 0) t = { ...t, sl };
    }
    still.push(t);
  }
  return { open: still, closed };
}

export const closePractice = (t, price, reason = 'manual') => ({ ...t, exit: price, pnl: pnlOf(t, price), reason });

// UTC ms of a wall-clock time in a time zone on a date (DST included): guess, then correct by the zone's offset
const OFF = new Map();
function offsetMin(ms, zone) {
  let f = OFF.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); OFF.set(zone, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}
export function zonedUtc(day, hh, mm, zone) {
  const guess = Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  return guess - offsetMin(guess - offsetMin(guess, zone) * 60000, zone) * 60000;
}

// The trading sessions in local time where they happen
export const SESSIONS = [
  { name: 'Asia', zone: 'Asia/Tokyo', from: [9, 0], to: [15, 0], color: '#e8c468' },
  { name: 'London', zone: 'Europe/London', from: [8, 0], to: [16, 30], color: '#2962ff' },
  { name: 'New York', zone: 'America/New_York', from: [9, 30], to: [16, 0], color: '#089981' },
];

// Session boxes for the days between two UTC times, weekdays only -> [{ from, to (UTC ms), name, color }]
export function sessionBoxes(fromMs, toMs) {
  const out = [];
  for (let d = Math.floor(fromMs / 86400000) * 86400000; d <= toMs + 86400000; d += 86400000) {
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const day = new Date(d).toISOString().slice(0, 10);
    for (const s of SESSIONS) {
      const a = zonedUtc(day, ...s.from, s.zone), b = zonedUtc(day, ...s.to, s.zone);
      if (b >= fromMs && a <= toMs + 86400000) out.push({ from: a, to: b, name: s.name, color: s.color });
    }
    if (out.length > 200) break;
  }
  return out;
}
