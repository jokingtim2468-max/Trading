// Terminal page: the chart's settings with a version history (presets, the AI chart editor, revert), and orders
// placed from the page, sent to one copy group through the copier (MT5 accounts get them through the Copier EA).
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CHART, CHART_PRESETS, cleanChartChange, CHART_KEYS } from './lib/chartTheme.js';
import { accountRoom, copyQty, pointValue, mapSymbol, money2, protectionFor } from './lib/copyRules.js';
import { safetyBlock, closedOnDay } from './lib/fleetRules.js';
import { fetchCandles, candlesUrl } from './market/dukascopy.js';
import { instrument } from './market/instruments.js';
import { toBroker } from './market/brokerTime.js';

export const TERMINAL_SCRIPT = 'QuantBot Terminal';
const KEEP_VERSIONS = 50;
const EVENTS = ['buy', 'sell', 'close', 'set_sl', 'set_tp'];
// Pending orders: the side they open, and where the trigger sits against the price (+1 above, -1 below).
// A limit waits for a better price (buy below, sell above); a stop waits for the price to break out (buy above, sell below).
export const PENDING = { buy_limit: ['buy', -1], buy_stop: ['buy', 1], sell_limit: ['sell', 1], sell_stop: ['sell', -1] };
const PENDING_NAME = { buy_limit: 'Buy limit', buy_stop: 'Buy stop', sell_limit: 'Sell limit', sell_stop: 'Sell stop' };
const r2 = (v) => Math.round(v * 100) / 100;
const fin = (v) => (Number.isFinite(v) ? r2(v) : null);
const usd = (v) => `$${money2(v)}`;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

// Where the account's open trades on one symbol would fail it: P with sum(dir * qty * pv * (P - entry)) = -room
export function failPrice(trades, room) {
  if (!trades.length || !Number.isFinite(room)) return null;
  let a = 0, b = 0;
  for (const t of trades) { const k = (t.side === 'long' ? 1 : -1) * Number(t.qty) * (Number(t.point_value) || 1); a += k; b += k * Number(t.entry); }
  return a ? r2((b - room) / a) : null;
}

// The model's daily high / low: a JSON reply checked against today's open
export function cleanPrediction(out, open) {
  const high = Number(out?.high), low = Number(out?.low), conf = Number(out?.confidence);
  if (!(high > 0 && low > 0) || high < open || low > open || high / low > 1.15) return null;
  return { high: r2(high), low: r2(low), confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : null, why: String(out.why || '').slice(0, 200) };
}

// The first JSON object in a model's reply
export function jsonIn(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  if (a < 0) return null;
  for (let depth = 0, i = a; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch { return null; } }
  }
  return null;
}

export function editorPrompt(settings) {
  return `You edit the chart on QuantBot's Terminal page and nothing else. Reply with ONE JSON object and no other text:
{"change": {<only the settings to change>}, "say": "<one short sentence for the trader>"}
Settings you may change: colors ${CHART_KEYS.colors.join(', ')} (hex like #131722; wickUp / wickDown "" = same as the candle), switches ${CHART_KEYS.switches.join(', ')} (true / false).
up = rising candles, down = falling candles, prediction = the model's high / low lines, hollow = rising candles drawn as outlines.
If the request isn't about these settings, reply {"change": {}, "say": "<what you can change>"}.
Current settings: ${JSON.stringify(settings)}`;
}

const INDICATOR_REWRITE = `You rewrite trading indicators (MQL5 or Pine Script) into a restricted Pine Script v5 indicator that QuantBot's chart runs. Keep the maths and the default input values the same.
Allowed, one statement per line, no indentation:
- indicator("Title", overlay=true|false)   (overlay=true when it draws on price)
- name = input.int(14, "Label") / input.float / input.bool / input.source(close, "Source")
- name = <expression>, [a, b, c] = ta.macd(src, fast, slow, signal) or ta.bb(src, len, mult)
- plot(series, "Title", color=color.blue or #RRGGBB, linewidth=1-4), hline(70, color=color.gray)
Expressions: numbers, open high low close volume hl2 hlc3 ohlc4 bar_index, + - * / %, comparisons, and or not, cond ? a : b, history x[1],
ta.sma ema rma wma hma vwma rsi atr tr stdev highest lowest change mom roc cum crossover crossunder cross vwap macd bb stoch, math.abs sqrt log exp pow round floor ceil max min avg, nz na fixnan.
Not allowed: if/for/while blocks, var, functions, arrays, request.security, labels, lines, tables.
Every value is a whole series computed at once, so turn loops into these functions. Buffers become plot() calls. Separate-window MQL5 indicators use overlay=false.
Reply with ONLY the Pine code in one \`\`\`pine block.`;

export function createTerminal({ dataDir, db, signals, ask, log = () => {} }) {
  const dir = path.join(dataDir, 'terminal');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'chart.json');
  const run = (...a) => db.run(...a);
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = null; }
  if (!state?.versions?.length) state = { versions: [{ settings: { ...DEFAULT_CHART }, note: 'Default', at: new Date().toISOString() }] };
  const save = () => fs.writeFileSync(file, JSON.stringify(state));
  // Pending orders, trailing stops, price alerts and the model's daily predictions
  const bookFile = path.join(dir, 'book.json');
  let book;
  try { book = JSON.parse(fs.readFileSync(bookFile, 'utf8')); } catch { book = {}; }
  book = { pending: [], trails: {}, alerts: [], predictions: {}, ...book };
  const saveBook = () => fs.writeFileSync(bookFile, JSON.stringify(book));
  const snaps = path.join(dir, 'snaps');
  fs.mkdirSync(snaps, { recursive: true });
  const current = () => state.versions.at(-1);
  const view = () => ({ settings: current().settings, versions: state.versions.map((v, i) => ({ n: i + 1, note: v.note, at: v.at })), presets: CHART_PRESETS });

  function change(next, note) {
    const settings = { ...current().settings, ...next };
    state.versions.push({ settings, note: String(note).slice(0, 200), at: new Date().toISOString() });
    if (state.versions.length > KEEP_VERSIONS) state.versions = [state.versions[0], ...state.versions.slice(-KEEP_VERSIONS + 1)];
    save();
    return view();
  }

  async function terminalScript() {
    const found = (await run('Script', 'filter', {})).find((s) => s.name === TERMINAL_SCRIPT);
    return found || run('Script', 'create', { name: TERMINAL_SCRIPT, language: 'Other', notes: 'Orders placed by hand on the Terminal page' });
  }

  const quotes = new Map();
  const predicting = new Map();
  let ticking = false;
  let lastOrderAt = 0;
  const queued = new Map(); // symbol -> [price, quote] of the newest tick waiting

  async function guard(groupId, t = null) {
    const members = (await run('TradingAccount', 'filter', { group_id: groupId })).filter((a) => (a.status || 'active') === 'active');
    const open = await run('AccountTrade', 'filter', { group_id: groupId, status: 'open' });
    // Extra protection only costs a look at closed trades when the group has a rule on
    let rules = null;
    try { rules = (await run('CopyGroup', 'get', groupId)).protect || null; } catch { /* no group */ }
    const on = rules && (Number(rules.lock) > 0 || Number(rules.streak) > 0 || Number(rules.consistency) > 0);
    const closed = on ? await run('AccountTrade', 'filter', { group_id: groupId, status: 'closed' }) : [];
    return members.map((a) => {
      const r = accountRoom(a);
      const row = { id: a.id, name: a.display_name || a.label, balance: r2(r.balance), day_pnl: r2(r.dayPnl), room: fin(r.room), rule: r.rule, to_floor: fin(r.toFloor), to_daily: fin(r.toDaily),
        start: Number(a.start_balance) || null, daily_limit: Number(a.daily_loss) || null, max_loss: Number(a.max_loss) || null, target: Number(a.target) || null, firm: a.firm || '', model: a.model || '' };
      if (on) row.protect = protectionFor(rules, a, closed.filter((x) => x.account_id === a.id));
      if (a.daily_floor || a.daily_cap || a.kill_losses) {
        const why = safetyBlock(a, closedOnDay(db.run('AccountTrade', 'filter', { account_id: a.id, status: 'closed' }), a));
        if (why) row.protect = { ...(row.protect || {}), blocked: row.protect?.blocked || why, safety: why };
      }
      const mine = open.filter((x) => x.account_id === a.id);
      if (mine.length) row.open = { symbol: mine[0].symbol, fail: failPrice(mine.filter((x) => x.symbol === mine[0].symbol), r.room) };
      if (t && (t.event === 'buy' || t.event === 'sell')) {
        const pv = pointValue(mapSymbol(a.symbol_map, t.symbol));
        const { qty, stop } = copyQty(a, t, pv);
        const risk = stop > 0 && qty > 0 ? r2(stop * qty * pv) : null;
        row.ticket = { qty, risk, blocked: row.protect?.blocked || null, ok: !row.protect?.blocked && (Number.isFinite(r.room) ? risk != null && risk <= r.room : true),
          fail: qty > 0 ? failPrice([{ side: t.event === 'buy' ? 'long' : 'short', qty, point_value: pv, entry: t.price }], r.room) : null };
      }
      return row;
    });
  }

  return {
    chart: view,
    // Rewrite an MQL5 indicator (or Pine the chart can't run as is) into the Pine subset the chart runs
    async indicator(code, why, model) {
      const src = String(code || '').slice(0, 60000);
      if (!src.trim()) throw Object.assign(new Error('Paste the indicator code first'), { status: 400 });
      const reply = await ask(model, INDICATOR_REWRITE, [{ role: 'user', content: `${why ? `The chart couldn't run it as is: ${why}\n\n` : ''}Indicator code:\n${src}` }], 3000);
      const pine = String(reply).replace(/^[\s\S]*?```(?:pine|pinescript)?\s*\n/i, '').replace(/```[\s\S]*$/, '').trim();
      if (!/\bplot\s*\(|\bhline\s*\(/.test(pine)) throw Object.assign(new Error("The model's rewrite had no plot() in it. Try again."), { status: 502 });
      return { pine };
    },
    preset(id) {
      const p = CHART_PRESETS.find((x) => x.id === id);
      if (!p) throw Object.assign(new Error('No such preset'), { status: 400 });
      return change(p.settings, `Preset: ${p.name}`);
    },
    set(changeIn, note = 'Edited') {
      try { return change(cleanChartChange(changeIn), note); } catch (e) { throw Object.assign(e, { status: 400 }); }
    },
    revert() {
      if (state.versions.length > 1) { state.versions.pop(); save(); }
      return view();
    },
    restore(n) {
      const v = state.versions[Number(n) - 1];
      if (!v) throw Object.assign(new Error('No such version'), { status: 400 });
      return change(v.settings, `Restored v${n}`);
    },
    // The AI chart editor: the model only proposes settings; they pass the same check as everything else
    async edit(message, model) {
      const text = String(message || '').trim().slice(0, 1000);
      if (!text) throw Object.assign(new Error('Type what to change'), { status: 400 });
      const reply = await ask(model, editorPrompt(current().settings), [{ role: 'user', content: text }], 400);
      const out = jsonIn(reply);
      if (!out || typeof out.change !== 'object') return { ...view(), say: "I couldn't turn that into a chart change. Try: black background, white candles, hide the grid.", changed: false };
      if (!Object.keys(out.change).length) return { ...view(), say: String(out.say || 'Nothing to change.').slice(0, 300), changed: false };
      let clean;
      try { clean = cleanChartChange(out.change); } catch (e) { return { ...view(), say: `I can't do that: ${e.message}`, changed: false }; }
      const say = String(out.say || 'Done.').slice(0, 300);
      return { ...change(clean, `AI: ${text.slice(0, 80)}`), say, changed: true };
    },

    // Orders from the page: one group, through the copier like any script's signals
    async order(body) {
      const t0 = process.hrtime.bigint(); // the app's checks start: rule guard, group, prices, then the copier
      lastOrderAt = Date.now();
      const b = body || {};
      const event = String(b.event || '');
      if (!EVENTS.includes(event) && !PENDING[event] && !['cancel', 'move_pending', 'trail'].includes(event)) throw bad(`Order must be one of ${[...EVENTS, ...Object.keys(PENDING), 'cancel', 'move_pending', 'trail'].join(', ')}`);
      if (event === 'cancel') {
        const before = book.pending.length;
        book.pending = book.pending.filter((p) => (b.id ? p.id !== b.id : p.group_id !== b.group_id));
        saveBook();
        return { ok: true, cancelled: before - book.pending.length };
      }
      if (!b.group_id) throw Object.assign(new Error('Choose the group to trade on'), { status: 400 });
      let group;
      try { group = await run('CopyGroup', 'get', String(b.group_id)); } catch { throw Object.assign(new Error('No such group'), { status: 400 }); }
      const num = (v) => (v === '' || v == null ? null : Number(v));
      const price = num(b.price), sl = num(b.sl), tp = num(b.tp);
      const risk_usd = num(b.risk_usd) > 0 ? num(b.risk_usd) : null;
      const symbol = String(b.symbol || 'XAUUSD').slice(0, 30);
      const check = async (side, at) => {
        if (b.guard === false) return;
        const rows = await guard(group.id, { event: side, symbol, price: at, sl, qty: num(b.qty) || 1, risk_usd });
        const no = rows.find((r) => r.ticket && !r.ticket.ok);
        if (!no) return;
        if (no.ticket.blocked) throw bad(`${no.name}: ${no.ticket.blocked}`);
        if (no.ticket.risk == null) throw bad(`Rule guard: add a stop loss so the risk can be checked against ${no.name}'s limits (or switch the guard off)`);
        throw bad(`Rule guard: ${no.name} would risk ${usd(no.ticket.risk)} with ${usd(no.room)} left before its ${no.rule}`);
      };
      if ((event === 'buy' || event === 'sell' || event === 'close') && !(price > 0)) throw Object.assign(new Error('A price is needed'), { status: 400 });
      if (event === 'buy' && ((sl != null && sl >= price) || (tp != null && tp <= price))) throw Object.assign(new Error('For a buy the stop goes below the price and the target above'), { status: 400 });
      if (event === 'sell' && ((sl != null && sl <= price) || (tp != null && tp >= price))) throw Object.assign(new Error('For a sell the stop goes above the price and the target below'), { status: 400 });
      if (event === 'buy' || event === 'sell') await check(event, price);
      if (PENDING[event] || event === 'move_pending') {
        const p = event === 'move_pending' ? book.pending.find((x) => x.id === b.id) : null;
        if (event === 'move_pending' && !p) throw bad('No such pending order');
        const kind = p ? p.event : event, [side, where] = PENDING[kind];
        const at = num(b.at);
        if (!(at > 0) || !(price > 0)) throw bad('A pending order needs its price and the current price');
        if (where > 0 ? at <= price : at >= price) throw bad(`A ${PENDING_NAME[kind].toLowerCase()} goes ${where > 0 ? 'above' : 'below'} the current price`);
        if (p) { p.at = r2(at); saveBook(); return { ok: true, pending: p.id }; }
        if (side === 'buy' && ((sl != null && sl >= at) || (tp != null && tp <= at))) throw bad('For a buy the stop goes below the price and the target above');
        if (side === 'sell' && ((sl != null && sl <= at) || (tp != null && tp >= at))) throw bad('For a sell the stop goes above the price and the target below');
        await check(side, at);
        const order = { id: `P-${Date.now()}`, event, group_id: group.id, symbol, at: r2(at), qty: num(b.qty) || 1, sl, tp, risk_usd, guard: b.guard !== false, at_created: new Date().toISOString() };
        book.pending.push(order); saveBook();
        log(`terminal: ${event} ${symbol} at ${order.at} on ${group.name}`);
        return { ok: true, pending: order.id };
      }
      if (event === 'trail') {
        const dist = num(b.distance);
        if (!b.trade_id) throw bad('Which trade to trail?');
        if (!dist) { delete book.trails[b.trade_id]; saveBook(); return { ok: true, trail: null }; }
        if (!(dist > 0)) throw bad('The trailing distance must be above 0');
        book.trails[b.trade_id] = { dist: r2(dist), group_id: group.id, symbol }; saveBook();
        return { ok: true, trail: book.trails[b.trade_id] };
      }
      const script = await terminalScript();
      const msg = {
        event, symbol, price, sl, tp, qty: num(b.qty) || 1, reason: event === 'close' ? 'manual' : '', ...(risk_usd ? { risk_usd } : {}),
        ...(event === 'close' && num(b.fraction) > 0 && num(b.fraction) < 1 ? { fraction: num(b.fraction) } : {}),
        strategy: TERMINAL_SCRIPT, source: 'other', trade_id: event === 'close' ? String(b.trade_id || '') : String(b.trade_id || `T-${Date.now()}`), time: Date.now(),
      };
      if (event === 'set_sl' && sl == null) throw Object.assign(new Error('set_sl needs sl'), { status: 400 });
      if (event === 'set_tp' && tp == null) throw Object.assign(new Error('set_tp needs tp'), { status: 400 });
      const saved = await signals.receive(JSON.stringify(msg), { scriptId: script.id, groupId: group.id, local: true, t0 });
      // Microseconds from the first check to the slowest account's order leaving for MT5 (fast lane accounts)
      const push_us = saved.pushed?.length ? Math.max(...saved.pushed) : null;
      log(`terminal: ${event} ${msg.symbol} on ${group.name}`);
      // Nothing copied (news block, max trades, every account skipped): say why instead of "executed"
      if (saved.copied === 0) {
        const why = (await run('CopyEvent', 'filter', { signal_id: saved.id })).filter((e) => e.level === 'warn' || e.level === 'error').map((e) => e.message.replace(/^[^:]+: /, ''));
        return { ok: true, copied: 0, reasons: [...new Set(why)].slice(0, 3), signal: saved.id, trade_id: msg.trade_id };
      }
      return { ok: true, copied: saved.copied ?? null, push_us, signal: saved.id, trade_id: msg.trade_id };
    },
    // Each active account's room before its firm rules fail it, where price would fail it on its open trades, and
    // for a ticket: the size, risk and whether it fits
    guard,
    async positionsAll(groupId) {
      return { positions: await this.positions(groupId), pending: book.pending.filter((p) => !groupId || p.group_id === groupId), trails: book.trails, alerts: book.alerts };
    },
    // Closes every Terminal trade on every group and cancels every pending order
    async flatten(price) {
      const open = (await this.positions()).filter((t) => t.closable);
      const groups = [...new Set(open.map((t) => t.group_id).filter(Boolean))];
      const cancelled = book.pending.length;
      book.pending = []; book.trails = {}; saveBook();
      for (const g of groups) {
        const p = Number(price?.[open.find((t) => t.group_id === g).symbol] ?? price) || open.find((t) => t.group_id === g).entry;
        await this.order({ event: 'close', group_id: g, price: p, symbol: open.find((t) => t.group_id === g).symbol });
      }
      log(`terminal: flatten all, ${open.length} trades on ${groups.length} groups, ${cancelled} pending cancelled`);
      return { ok: true, trades: open.length, groups: groups.length, cancelled };
    },
    // The latest minute candles from Dukascopy (cached 10 s), so the chart and pending orders follow the price
    async quote(symbol) {
      const inst = instrument(symbol);
      const hit = quotes.get(inst.symbol);
      if (hit && Date.now() - hit.at < 10000) return hit.value;
      const now = Date.now();
      const list = await fetchCandles(candlesUrl(inst.code, 'BID', 'minute', now, now), { retries: 1 });
      const last = list.slice(-30).map((c) => ({ time: toBroker(c.time), open: c.open, high: c.high, low: c.low, close: c.close }));
      const value = { symbol: inst.symbol, candles: last, price: last.at(-1)?.close ?? null };
      quotes.set(inst.symbol, { at: Date.now(), value });
      return value;
    },
    // A new price: fires pending orders and alerts it crosses and moves trailing stops
    // q: { bid, ask } from MT5 (buys fill at the ask, sells at the bid); price alone from the chart
    // A tick that arrives while the last one is still being checked waits, and only the newest one per symbol
    // runs next (never dropped: it could be the one that fills an order); queued runs report through onBook
    async tick(symbol, price, q = {}) {
      const none = { fired: [], moved: [], alerts: [] };
      if (!(Number(price) > 0)) return none;
      if (ticking) { queued.set(symbol, [price, q]); return none; }
      const r = await this.tickNow(symbol, price, q);
      while (queued.size) {
        const [sym, [p2, q2]] = queued.entries().next().value;
        queued.delete(sym);
        const r2 = await this.tickNow(sym, p2, q2);
        if (r2.fired.length || r2.moved.length || r2.alerts.length) this.onBook?.(r2);
      }
      return r;
    },
    onBook: null,
    async tickNow(symbol, price, q = {}) {
      price = Number(price);
      const none = { fired: [], moved: [], alerts: [] };
      // Most ticks have nothing to do: no pending order, trailing stop or alert on this symbol
      if (!book.pending.some((p) => p.symbol === symbol) && !book.alerts.some((a) => a.symbol === symbol) && !Object.values(book.trails).some((t) => t.symbol === symbol)) return none;
      const ask = Number(q.ask) > 0 ? Number(q.ask) : price, bid = Number(q.bid) > 0 ? Number(q.bid) : price;
      ticking = true;
      const fired = [], moved = [], alerts = [];
      try {
        for (const p of book.pending.filter((x) => x.symbol === symbol)) {
          const [side, where] = PENDING[p.event];
          const px = side === 'buy' ? ask : bid;
          if (where > 0 ? px < p.at : px > p.at) continue;
          book.pending = book.pending.filter((x) => x.id !== p.id); saveBook();
          try {
            const fill = side === 'buy' ? ask : bid;
            const r = await this.order({ ...p, event: side, price: fill, trade_id: p.id, from_pending: true });
            fired.push({ ...p, price: fill, trade_id: r.trade_id, push_us: r.push_us });
          } catch (e) { fired.push({ ...p, price, error: e.message }); }
        }
        const open = (await this.positions()).filter((t) => t.closable && t.symbol === symbol);
        for (const [id, tr] of Object.entries(book.trails)) {
          const mine = open.filter((t) => t.trade_id === id);
          if (!mine.length) { if (tr.symbol === symbol) { delete book.trails[id]; saveBook(); } continue; }
          const t = mine[0], dir = t.side === 'long' ? 1 : -1;
          const sl = r2((dir > 0 ? bid : ask) - dir * tr.dist);
          if (t.sl != null && (sl - t.sl) * dir < 0.01) continue;
          await this.order({ event: 'set_sl', group_id: t.group_id, symbol, price, sl, trade_id: id });
          moved.push({ trade_id: id, sl });
        }
        for (const a of book.alerts.filter((x) => x.symbol === symbol)) {
          if (a.above ? price < a.price : price > a.price) continue;
          book.alerts = book.alerts.filter((x) => x.id !== a.id); saveBook();
          alerts.push({ ...a, hit: price });
        }
      } finally { ticking = false; }
      return { fired, moved, alerts };
    },
    alert(b) {
      if (b.remove) { book.alerts = book.alerts.filter((a) => a.id !== b.remove); saveBook(); return { alerts: book.alerts }; }
      const price = Number(b.price), now = Number(b.now);
      if (!(price > 0) || !(now > 0)) throw bad('An alert needs a price and the current price');
      book.alerts.push({ id: `A-${Date.now()}`, symbol: String(b.symbol || 'XAUUSD'), price: r2(price), above: price > now, note: String(b.note || '').slice(0, 80) });
      saveBook();
      return { alerts: book.alerts };
    },
    // Today's high / low from the local model (once a day per symbol): daily = [{ time, open, high, low, close }],
    // the last one today's bar so far
    async predict(symbol, daily, model) {
      const bars = (Array.isArray(daily) ? daily : []).slice(-25).map((d) => ({ day: new Date(Number(d.time)).toISOString().slice(0, 10), o: r2(+d.open), h: r2(+d.high), l: r2(+d.low), c: r2(+d.close) }));
      if (bars.length < 6) throw bad('Not enough daily bars to predict from');
      const today = bars.at(-1), key = `${symbol}|${today.day}`;
      if (book.predictions[key]) return book.predictions[key];
      if (!predicting.has(key)) {
        predicting.set(key, (async () => {
          const past = bars.slice(0, -1).map((d) => `${d.day},${d.o},${d.h},${d.l},${d.c}`).join('\n');
          const reply = await ask(model, `You predict today's high and low for ${symbol}. Reply with ONE JSON object and no other text: {"high": <price>, "low": <price>, "confidence": <0-100>, "why": "<one short sentence>"}`,
            [{ role: 'user', content: `Daily bars, oldest first (day,open,high,low,close):\n${past}\nToday ${today.day} opened at ${today.o}.` }], 200);
          const p = cleanPrediction(jsonIn(reply), today.o);
          if (!p) throw new Error("The model's answer wasn't a usable high / low");
          const out = { symbol, day: today.day, ...p, at: new Date().toISOString() };
          book.predictions[key] = out;
          book.predictions = Object.fromEntries(Object.entries(book.predictions).slice(-60));
          saveBook();
          return out;
        })().finally(() => predicting.delete(key)));
      }
      return predicting.get(key).catch((e) => { throw Object.assign(new Error(`The model didn't give a prediction: ${e.message}`), { status: 503 }); });
    },
    // A chart picture for the journal, saved on every account's copy of the trade
    async snapshot(tradeId, kind, image) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
      if (!m || !tradeId || !['open', 'close'].includes(kind)) throw bad('A snapshot needs a trade, open or close, and a PNG');
      const name = `${String(tradeId).replace(/[^\w-]/g, '')}-${kind}.png`;
      fs.writeFileSync(path.join(snaps, name), Buffer.from(m[1], 'base64'));
      for (const t of await run('AccountTrade', 'filter', { trade_id: String(tradeId) })) await run('AccountTrade', 'update', t.id, { [`snap_${kind}`]: `/api/terminal/snap/${name}` });
      return { ok: true, url: `/api/terminal/snap/${name}` };
    },
    snapFile: (name) => path.join(snaps, path.basename(String(name))),
    // Runs the order checks (rule guard, sizing, limits) a few hundred times with no side effects, so the first real
    // orders after start or after MT5 connects already run compiled (cold, an order takes ~1-2 ms instead of ~0.5)
    async warm() {
      const groups = await run('CopyGroup', 'filter', {});
      for (let i = 0; i < 300; i++) {
        // One step per event-loop turn, and never while real orders are coming in
        await new Promise((r) => setImmediate(r));
        if (Date.now() - lastOrderAt < 3000) return;
        for (const g of groups) await guard(g.id, { event: i % 2 ? 'sell' : 'buy', symbol: 'XAUUSD', price: 2000 + i, sl: i % 2 ? 2010 + i : 1990 + i, qty: 1 });
      }
    },
    predictions: () => Object.values(book.predictions).sort((a, b) => String(a.day).localeCompare(String(b.day))),
    // Every group and account on one screen: balance, today, total, room before the limits, open trades, MT5 link
    async overview(lanes = []) {
      const groups = await run('CopyGroup', 'filter', {});
      const accounts = await run('TradingAccount', 'filter', {});
      const open = await run('AccountTrade', 'filter', { status: 'open' });
      const row = (a) => {
        const r = accountRoom(a);
        const start = Number(a.start_balance) || 0;
        return {
          id: a.id, name: a.display_name || a.label, platform: a.platform, firm: a.firm || '', status: a.status || 'active', status_reason: a.status_reason || '',
          balance: r2(r.balance), start: r2(start), total: r2(r.balance - start), today: r2(r.dayPnl), target: Number(a.target) || null,
          room: fin(r.room), rule: r.rule, open: open.filter((t) => t.account_id === a.id).length, mt5: a.platform === 'MT5' ? (lanes.includes(a.id) ? 'fast lane' : a.daemon_state || (a.mt5_seen_at ? 'polling' : 'not connected')) : null,
        };
      };
      const out = groups.map((g) => ({ id: g.id, name: g.name, enabled: g.enabled !== false, protect: g.protect || null, accounts: accounts.filter((a) => a.group_id === g.id).map(row) }));
      const loose = accounts.filter((a) => !groups.some((g) => g.id === a.group_id));
      if (loose.length) out.push({ id: '', name: 'Not in a group', enabled: true, accounts: loose.map(row) });
      return out;
    },
    // A group's protection rules (profit lock, loss-streak cooldown, consistency cap)
    async protect(groupId, rules) {
      const n = (v, max) => { const x = Number(v); return x > 0 ? Math.min(x, max) : 0; };
      const clean = { lock: n(rules?.lock, 1e7), lockMode: rules?.lockMode === 'breakeven' ? 'breakeven' : 'block', streak: Math.round(n(rules?.streak, 20)), cooldown: Math.round(n(rules?.cooldown, 1440)) || 30, consistency: Math.round(n(rules?.consistency, 100)) };
      await run('CopyGroup', 'update', String(groupId), { protect: clean });
      return clean;
    },
    // Profit lock in break-even mode: once an account is up the lock amount today, the Terminal's open trades on
    // its group get their stops moved to the entry (once per trade)
    async sweepLocks() {
      for (const g of await run('CopyGroup', 'filter', {})) {
        if (!(Number(g.protect?.lock) > 0) || g.protect.lockMode !== 'breakeven') continue;
        const rows = await guard(g.id);
        if (!rows.some((r) => r.protect?.lock?.hit)) continue;
        const open = (await this.positions(g.id)).filter((t) => t.closable && Number(t.sl) !== Number(t.entry));
        for (const id of new Set(open.map((t) => t.trade_id))) {
          const t = open.find((x) => x.trade_id === id);
          await this.order({ event: 'set_sl', group_id: g.id, symbol: t.symbol, sl: t.entry, price: t.entry, trade_id: id, guard: false });
          log(`terminal: profit lock on ${g.name}, stop to break-even on ${id}`);
        }
      }
    },
    async positions(groupId) {
      const q = { status: 'open', ...(groupId ? { group_id: groupId } : {}) };
      const trades = await run('AccountTrade', 'filter', q, '-opened_at', 200);
      const accounts = Object.fromEntries((await run('TradingAccount', 'filter', {})).map((a) => [a.id, a]));
      const mine = (await run('Script', 'filter', {})).find((s) => s.name === TERMINAL_SCRIPT)?.id;
      // Only the Terminal's own trades close from here; a script's trades close when that script says so
      return trades.map((t) => ({ ...t, account: accounts[t.account_id]?.display_name || accounts[t.account_id]?.label || t.account_id, closable: !!mine && t.script_id === mine }));
    },
  };
}
