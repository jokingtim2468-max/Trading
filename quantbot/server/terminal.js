// Terminal page: the chart's settings with a version history (presets, the AI chart editor, revert), and orders
// placed from the page, sent to one copy group through the copier (MT5 accounts get them through the Copier EA).
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CHART, CHART_PRESETS, cleanChartChange, CHART_KEYS } from './lib/chartTheme.js';

export const TERMINAL_SCRIPT = 'QuantBot Terminal';
const KEEP_VERSIONS = 50;
const EVENTS = ['buy', 'sell', 'close', 'set_sl', 'set_tp'];

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

export function createTerminal({ dataDir, db, signals, ask, log = () => {} }) {
  const dir = path.join(dataDir, 'terminal');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'chart.json');
  const run = (...a) => db.run(...a);
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = null; }
  if (!state?.versions?.length) state = { versions: [{ settings: { ...DEFAULT_CHART }, note: 'Default', at: new Date().toISOString() }] };
  const save = () => fs.writeFileSync(file, JSON.stringify(state));
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

  return {
    chart: view,
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
      const b = body || {};
      const event = String(b.event || '');
      if (!EVENTS.includes(event)) throw Object.assign(new Error(`Order must be one of ${EVENTS.join(', ')}`), { status: 400 });
      if (!b.group_id) throw Object.assign(new Error('Choose the group to trade on'), { status: 400 });
      let group;
      try { group = await run('CopyGroup', 'get', String(b.group_id)); } catch { throw Object.assign(new Error('No such group'), { status: 400 }); }
      const num = (v) => (v === '' || v == null ? null : Number(v));
      const price = num(b.price), sl = num(b.sl), tp = num(b.tp);
      if ((event === 'buy' || event === 'sell' || event === 'close') && !(price > 0)) throw Object.assign(new Error('A price is needed'), { status: 400 });
      if (event === 'buy' && ((sl != null && sl >= price) || (tp != null && tp <= price))) throw Object.assign(new Error('For a buy the stop goes below the price and the target above'), { status: 400 });
      if (event === 'sell' && ((sl != null && sl <= price) || (tp != null && tp >= price))) throw Object.assign(new Error('For a sell the stop goes above the price and the target below'), { status: 400 });
      const script = await terminalScript();
      const msg = {
        event, symbol: String(b.symbol || 'XAUUSD').slice(0, 30), price, sl, tp, qty: num(b.qty) || 1, reason: event === 'close' ? 'manual' : '',
        strategy: TERMINAL_SCRIPT, source: 'other', trade_id: event === 'close' ? String(b.trade_id || '') : String(b.trade_id || `T-${Date.now()}`), time: Date.now(),
      };
      if (event === 'set_sl' && sl == null) throw Object.assign(new Error('set_sl needs sl'), { status: 400 });
      if (event === 'set_tp' && tp == null) throw Object.assign(new Error('set_tp needs tp'), { status: 400 });
      const saved = await signals.receive(JSON.stringify(msg), { scriptId: script.id, groupId: group.id, local: true });
      log(`terminal: ${event} ${msg.symbol} on ${group.name}`);
      return { ok: true, signal: saved.id, trade_id: msg.trade_id };
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
