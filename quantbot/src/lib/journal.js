// Trading journal: closed trades from the copier (every Terminal and script trade) and imported trade history, with
// R multiples and stats per setup. parseHistory reads MT5's "History > Positions" export or any CSV / tab file with
// headers like symbol, type / side, volume / qty, open time, open price, close time, close price, profit / pnl.
const num = (v) => { const n = Number(String(v ?? '').replace(/[\s,](?=\d{3}\b)/g, '').replace(/[^\d.+-]/g, '')); return Number.isFinite(n) ? n : null; };
const when = (v) => { const s = String(v || '').trim().replace(/^(\d{4})\.(\d\d)\.(\d\d)/, '$1-$2-$3'); const t = Date.parse(/[zZ+]|T/.test(s) ? s : `${s.replace(' ', 'T')}Z`); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

function splitLine(line, sep) {
  if (sep === '\t') return line.split('\t').map((c) => c.trim());
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// -> { trades: [{ symbol, side, qty, entry, exit, entry_time, exit_time, pnl, fees }], skipped }
export function parseHistory(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { trades: [], skipped: 0 };
  const sep = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const head = splitLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[^a-z/]/g, ''));
  // Repeated "time" / "price" columns (MT5): the first is the open, the second the close
  const seen = {};
  const keys = head.map((h) => {
    seen[h] = (seen[h] || 0) + 1;
    if (h === 'time') return seen[h] === 1 ? 'entry_time' : 'exit_time';
    if (h === 'price') return seen[h] === 1 ? 'entry' : 'exit';
    if (['symbol', 'instrument', 'ticker', 'market'].includes(h)) return 'symbol';
    if (['type', 'side', 'direction', 'action'].includes(h)) return 'side';
    if (['volume', 'qty', 'quantity', 'size', 'lots', 'contracts'].includes(h)) return 'qty';
    if (['opentime', 'entrytime', 'opened', 'boughttimestamp'].includes(h)) return 'entry_time';
    if (['closetime', 'exittime', 'closed', 'soldtimestamp'].includes(h)) return 'exit_time';
    if (['openprice', 'entryprice', 'entry', 'buyprice'].includes(h)) return 'entry';
    if (['closeprice', 'exitprice', 'exit', 'sellprice'].includes(h)) return 'exit';
    if (['profit', 'pnl', 'netpnl', 'profitloss', 'pl', 'p/l'].includes(h)) return 'pnl';
    if (['commission', 'fees', 'fee'].includes(h)) return 'commission';
    if (h === 'swap') return 'swap';
    return null;
  });
  const trades = []; let skipped = 0;
  for (const line of lines.slice(1)) {
    const c = splitLine(line, sep);
    const r = {};
    keys.forEach((k, i) => { if (k && r[k] == null) r[k] = c[i]; });
    const side = /^(buy|long|b)\b/i.test(r.side || '') ? 'long' : /^(sell|short|s)\b/i.test(r.side || '') ? 'short' : null;
    const pnl = num(r.pnl), exitTime = when(r.exit_time || r.entry_time);
    if (!r.symbol || !side || pnl == null || !exitTime) { skipped++; continue; }
    const fees = Math.round(((num(r.commission) || 0) + (num(r.swap) || 0)) * 100) / 100;
    trades.push({ symbol: r.symbol.toUpperCase(), side, qty: num(r.qty), entry: num(r.entry), exit: num(r.exit), entry_time: when(r.entry_time), exit_time: exitTime, pnl: Math.round((pnl + fees) * 100) / 100, fees });
  }
  return { trades, skipped };
}

export const dedupeKey = (accountId, t) => `${accountId}|${t.symbol}|${t.side}|${t.entry_time || ''}|${t.exit_time}|${t.qty}|${t.pnl}`;

// R multiple: P&L over the risk when the trade opened
export const rOf = (t) => (Number(t.risk_open) > 0 ? Math.round((t.pnl / t.risk_open) * 100) / 100 : null);

export function stats(list) {
  const wins = list.filter((t) => t.pnl > 0), losses = list.filter((t) => t.pnl < 0);
  const gross = wins.reduce((s, t) => s + t.pnl, 0), lost = -losses.reduce((s, t) => s + t.pnl, 0);
  const rs = list.map(rOf).filter((r) => r != null);
  return {
    trades: list.length, wins: wins.length, winRate: list.length ? Math.round((wins.length / list.length) * 100) : 0,
    net: Math.round((gross - lost) * 100) / 100, pf: lost ? Math.round((gross / lost) * 100) / 100 : null,
    avgR: rs.length ? Math.round((rs.reduce((s, r) => s + r, 0) / rs.length) * 100) / 100 : null,
  };
}

export function bySetup(list) {
  const m = new Map();
  for (const t of list) { const k = t.setup || 'No setup'; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].map(([setup, l]) => ({ setup, ...stats(l) })).sort((a, b) => b.net - a.net);
}

// Monday 00:00 UTC of a moment's week
export const weekStart = (t) => { const d = new Date(Date.parse(t)); const day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };

// One week's report: stats, best and worst setup, best and worst day, and the rule-breaks the app blocked
export function weekly(list, start, events = []) {
  const end = start + 7 * 86400000;
  const inWeek = list.filter((t) => { const x = Date.parse(t.exit_time); return x >= start && x < end; });
  const days = new Map();
  for (const t of inWeek) { const d = String(t.exit_time).slice(0, 10); days.set(d, (days.get(d) || 0) + t.pnl); }
  const dayList = [...days.entries()].map(([day, pnl]) => ({ day, pnl: Math.round(pnl * 100) / 100 })).sort((a, b) => b.pnl - a.pnl);
  const setups = bySetup(inWeek);
  const blocks = events.filter((e) => { const x = Date.parse(e.created_date); return x >= start && x < end && ['block', 'limit'].includes(e.kind); });
  return { start, end, ...stats(inWeek), bestSetup: setups[0] || null, worstSetup: setups.length > 1 ? setups.at(-1) : null, bestDay: dayList[0] || null, worstDay: dayList.length > 1 ? dayList.at(-1) : null, blocks: blocks.length, trades_list: inWeek };
}

// The model's daily high / low against what happened: daily = [{ day, high, low }] (finished days only)
export function scorecard(preds, daily) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const rows = [];
  for (const p of preds) {
    const d = byDay.get(p.day);
    if (!d) continue;
    const range = d.high - d.low || 1;
    const hiErr = Math.round((d.high - p.high) * 100) / 100, loErr = Math.round((p.low - d.low) * 100) / 100;
    rows.push({ ...p, actualHigh: d.high, actualLow: d.low, hiErr, loErr, hit: Math.abs(hiErr) <= range * 0.25 && Math.abs(loErr) <= range * 0.25 });
  }
  const bucket = (lo, hi) => { const l = rows.filter((r) => r.confidence != null && r.confidence >= lo && r.confidence < hi); return { label: `${lo}-${hi === 101 ? 100 : hi - 1}%`, days: l.length, hitRate: l.length ? Math.round((l.filter((r) => r.hit).length / l.length) * 100) : null }; };
  const avg = (k) => (rows.length ? Math.round((rows.reduce((s, r) => s + Math.abs(r[k]), 0) / rows.length) * 100) / 100 : null);
  return { rows, days: rows.length, hitRate: rows.length ? Math.round((rows.filter((r) => r.hit).length / rows.length) * 100) : null, avgHighErr: avg('hiErr'), avgLowErr: avg('loErr'), buckets: [bucket(0, 50), bucket(50, 70), bucket(70, 101)] };
}
