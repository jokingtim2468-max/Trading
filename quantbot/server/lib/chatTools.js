// Tools the chat models call to read the trader's own tests and QuantBot's built-in market data, so fine-tuning
// advice is based on real numbers instead of guesses. Every tool only reads; nothing is changed or traded.
import { INSTRUMENTS, TIMEFRAMES, MAX_RANGE_DAYS, firstDate } from '../market/instruments.js';
import { marketStats } from '../../src/lib/backtest/marketStats.js';
import { evaluate, levelFromXp, tierOf, groupScriptIds, ACCOUNT_STEP, SCRIPT_STEP } from './copyRules.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadPresets } from './fleetRules.js';

const MAX_RESULT = 60000; // characters per tool result, so a big answer can't crowd out the conversation
const MAX_BARS = 1500;
const r2 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 100) / 100);
const day = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : null);

export const TOOL_DEFS = [
  {
    name: 'calculate',
    description: 'Exact arithmetic (small models get maths wrong): + - * / ^ % and parentheses, e.g. "(10000*0.0125)/(4.5*100)".',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
  },
  {
    name: 'position_size',
    description: 'Lots / contracts for a trade from the dollars at risk and the stop distance. Gold (XAUUSD) MT5: $100 per $1 per lot; US100 CFD $1 per point; NQ $20, MNQ $2, MGC $10 per point per contract.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, risk_usd: { type: 'number' }, stop_distance: { type: 'number', description: 'entry to stop, in price units' } }, required: ['symbol', 'risk_usd', 'stop_distance'] },
  },
  {
    name: 'prop_rules',
    description: "A prop firm account's exact rules from QuantBot's presets: profit target, daily loss, max loss and type, minimum days, consistency, fee. Leave out size/model to list what the firm offers.",
    parameters: { type: 'object', properties: { firm: { type: 'string', description: 'FTMO, FTMO US (OANDA), The5ers, Alpha Capital, Lucid Trading' }, model: { type: 'string' }, size: { type: 'number' } }, required: ['firm'] },
  },
  {
    name: 'workspace_files',
    description: "List this chat's workspace folder (scripts/ and notes).",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'workspace_read',
    description: 'Read a file in this chat\'s workspace, e.g. scripts/gold-breakout.mq5.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'workspace_write',
    description: "Save a notes / data file in this chat's workspace (scripts are saved automatically from your code blocks). Not for .exe/.bat/.ps1.",
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'web_search',
    description: 'Search the web (docs, MQL5 / Pine reference, news, prop firm rules). Returns titles, links and snippets.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer', description: '1-10, default 5' } }, required: ['query'] },
  },
  {
    name: 'web_fetch',
    description: 'Read one web page as plain text (use a link from web_search).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'list_markets',
    description: 'The built-in markets (XAUUSD, US100, NQ): contract specs, timeframes, how far back the data goes, broker time and the backtester\'s fill rules.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_tests',
    description: 'The trader\'s saved backtests (Strategy Converter and Strategy Tester), newest first: every bot, every version and market with net P&L, trades, win rate, profit factor, max drawdown, Monte Carlo grade and rules passed. Use run ids from here with get_test_run and get_trades.',
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Only this bot (exact name). Leave out for every bot.' },
        limit: { type: 'integer', description: 'Most bots to return (default 10, max 30).' },
      },
    },
  },
  {
    name: 'get_test_run',
    description: 'One tested version in full: test window, every metric, Monte Carlo results, each rule check with its detail, the run log, the tested MQL5 / Pine code and the simulation code the backtester ran.',
    parameters: {
      type: 'object',
      properties: { run_id: { type: 'string', description: 'Run id from list_tests.' } },
      required: ['run_id'],
    },
  },
  {
    name: 'get_trades',
    description: 'Trades of one tested version with a breakdown: by side, by exit reason (sl, tp, signal, reverse, end), by server hour and weekday, MAE / MFE (adverse / favourable excursion in price), hold time. Returns up to 200 trades per call.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Run id from list_tests.' },
        offset: { type: 'integer', description: 'Skip this many trades (default 0).' },
        limit: { type: 'integer', description: 'Trades to list (default 100, max 200). 0 for the breakdown only.' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'get_bars',
    description: `OHLC candles from the built-in data, in broker time (UTC+2, UTC+3 in US summer time), as CSV: time,open,high,low,close,volume,spread_points. At most ${MAX_BARS} bars per call; pick a higher timeframe or a shorter range for more history. Downloads missing data first, which can take a little while.`,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', enum: Object.keys(INSTRUMENTS) },
        timeframe: { type: 'string', enum: Object.keys(TIMEFRAMES) },
        from: { type: 'string', description: 'First day, YYYY-MM-DD (broker time).' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD (broker time).' },
      },
      required: ['symbol', 'timeframe', 'from', 'to'],
    },
  },
  {
    name: 'market_stats',
    description: 'Quant profile of a market over a date range: true range percentiles per bar, ATR(14), median daily range, median spread, average bar range by server hour (session volatility), range by weekday, trend and return. Use it to size stops, targets and session filters. Ranges of years are fine on H1 and above.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', enum: Object.keys(INSTRUMENTS) },
        timeframe: { type: 'string', enum: Object.keys(TIMEFRAMES) },
        from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD.' },
      },
      required: ['symbol', 'timeframe', 'from', 'to'],
    },
  },
  {
    name: 'copy_trading_summary',
    description: 'Copy trading (paper accounts that copy script alerts): every script, group and account with balance, status (active / passed / failed), rules, risk per trade, XP and rank, and an evaluation of the copied trades per script, per account, per group and per exit reason (trades, win rate, net, avg win / loss, profit factor, P&L per trade, max drawdown). Use it to judge how a script does across accounts.',
    parameters: { type: 'object', properties: { group: { type: 'string', description: 'Only this group (name). Leave out for all.' } } },
  },
  {
    name: 'copy_trading_log',
    description: 'The copy trading activity log, newest first: each signal received, how every account sized its trade, skips and warnings (paused group, max trades reached, failed account, 1 contract over the risk), fills, SL / TP moves, closes with P&L and XP, max-loss floor moves, rank-ups, pass / fail, orders sent to order URLs, and setup changes made in the app.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['signal', 'open', 'skip', 'move', 'close', 'rank', 'status', 'floor', 'order', 'limit', 'ignore', 'setup'], description: 'Only this kind of event.' },
        account: { type: 'string', description: 'Only this account (trader name or account name).' },
        script: { type: 'string', description: 'Only this script (name).' },
        problems_only: { type: 'boolean', description: 'Only warnings and errors.' },
        limit: { type: 'integer', description: 'Most events (default 100, max 400).' },
        offset: { type: 'integer', description: 'Skip this many of the newest events.' },
      },
    },
  },
  {
    name: 'copy_trading_trades',
    description: 'Copied trades (one row per account per script trade), oldest first: account, script, symbol, side, quantity, entry, stop, target, exit, points, P&L, XP, exit reason, open / close time, order URL result.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Only this account (trader name or account name).' },
        script: { type: 'string', description: 'Only this script (name).' },
        offset: { type: 'integer' },
        limit: { type: 'integer', description: 'Default 100, max 300.' },
      },
    },
  },
];

const runLine = (r) => {
  const m = r.metrics || {};
  const passed = (r.results || []).filter((x) => x.status === 'pass').length;
  return {
    run_id: r.id, version: r.version, symbol: r.symbol, target: r.target, window: `${r.window_label || ''} ${day(r.start)} to ${day(r.end)}`.trim(),
    net: r2(m.net), return_pct: r2(m.returnPct), trades: m.trades, win_rate: r2(m.winRate), profit_factor: r2(m.profitFactor),
    max_dd_pct: r2(m.maxDDPct), monte_carlo: m.mc ? `${m.mc.score}/100 ${m.mc.grade}` : null,
    rules_passed: `${passed}/${(r.results || []).length}`, tested_at: day(r.created_date),
  };
};

// Trades breakdown: where the money comes from and where it leaks
function breakdown(trades) {
  const group = (keyOf) => {
    const out = {};
    for (const t of trades) {
      const k = keyOf(t);
      const g = out[k] || (out[k] = { trades: 0, wins: 0, net: 0 });
      g.trades++; g.net += t.pnl; if (t.pnl > 0) g.wins++;
    }
    return Object.fromEntries(Object.entries(out).map(([k, g]) => [k, { trades: g.trades, win_rate: r2((g.wins / g.trades) * 100), net: r2(g.net) }]));
  };
  const avg = (arr) => (arr.length ? r2(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const winners = trades.filter((t) => t.pnl > 0), losers = trades.filter((t) => t.pnl <= 0);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    trades: trades.length,
    by_side: group((t) => t.side),
    by_exit_reason: group((t) => t.reason),
    by_entry_server_hour: group((t) => String(new Date(t.entry_time).getUTCHours()).padStart(2, '0')),
    by_entry_weekday: group((t) => days[new Date(t.entry_time).getUTCDay()]),
    avg_mae: { winners: avg(winners.map((t) => t.mae)), losers: avg(losers.map((t) => t.mae)) },
    avg_mfe: { winners: avg(winners.map((t) => t.mfe)), losers: avg(losers.map((t) => t.mfe)) },
    avg_hold_minutes: avg(trades.map((t) => (Date.parse(t.exit_time) - Date.parse(t.entry_time)) / 60000)),
  };
}

function atrStats(bars) {
  const n = bars.time.length;
  if (n < 20) return null;
  let atr = null;
  const series = [];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(bars.high[i], bars.close[i - 1]) - Math.min(bars.low[i], bars.close[i - 1]);
    atr = atr == null ? tr : (atr * 13 + tr) / 14;
    if (i >= 14) series.push(atr);
  }
  const s = [...series].sort((a, b) => a - b);
  return { latest: r2(series.at(-1)), median: r2(s[Math.floor(s.length / 2)]), p20: r2(s[Math.floor(s.length * 0.2)]), p80: r2(s[Math.floor(s.length * 0.8)]) };
}

function weekdayRanges(bars) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const acc = {};
  for (let i = 0; i < bars.time.length; i++) {
    const d = days[new Date(bars.time[i]).getUTCDay()];
    const a = acc[d] || (acc[d] = [0, 0]);
    a[0] += bars.high[i] - bars.low[i]; a[1]++;
  }
  return Object.fromEntries(days.filter((d) => acc[d]).map((d) => [d, r2(acc[d][0] / acc[d][1])]));
}

// Web access: Ollama's web search API when an Ollama key is saved (ollama.com/settings/keys), otherwise DuckDuckGo
const textOf = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
export async function webSearch(query, max = 5, key = '') {
  const n = Math.max(1, Math.min(10, Number(max) || 5));
  if (key) {
    const r = await fetch('https://ollama.com/api/web_search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query, max_results: n }), signal: AbortSignal.timeout(20000) });
    if (r.ok) return { source: 'ollama', results: ((await r.json()).results || []).map((x) => ({ title: x.title, url: x.url, snippet: String(x.content || '').slice(0, 600) })) };
  }
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'Mozilla/5.0 QuantBot' }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html)) && results.length < n;) {
    let url = m[1].replace(/&amp;/g, '&');
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    results.push({ title: textOf(m[2]), url, snippet: textOf(m[3]) });
  }
  if (results.length) return { source: 'duckduckgo', results };
  // DuckDuckGo sometimes answers with a bot check: Bing's results page instead
  const b = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(20000) });
  const page = await b.text();
  for (const block of page.split('<li class="b_algo"').slice(1)) {
    if (results.length >= n) break;
    const a = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    const enc = url.match(/[?&]u=a1([^&]+)/);
    if (enc) { try { url = Buffer.from(enc[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { /* keep the bing link */ } }
    results.push({ title: textOf(a[2]), url, snippet: textOf(block.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || '').slice(0, 600) });
  }
  return { source: 'bing', results };
}
export async function webFetch(url, key = '') {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Give a full http(s) link');
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith('.local')) throw new Error('Only public web pages');
  if (key) {
    const r = await fetch('https://ollama.com/api/web_fetch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(30000) });
    if (r.ok) { const j = await r.json(); return { title: j.title, text: String(j.content || '').slice(0, 20000) }; }
  }
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 QuantBot' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const html = await r.text();
  return { title: textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), text: textOf(html).slice(0, 20000) };
}

export function createChatTools({ db, market, webKey = () => '' }) {
  const list = (entity, query, opts) => db.run(entity, 'filter', query, opts).items;
  const getRun = (id) => {
    try {
      return db.run('StrategyRun', 'get', String(id || ''));
    } catch {
      throw new Error(`No test run ${id}. Use list_tests for run ids.`);
    }
  };
  const csv = (bars, k) => [new Date(bars.time[k]).toISOString().slice(0, 16).replace('T', ' '), bars.open[k], bars.high[k], bars.low[k], bars.close[k], bars.volume[k], bars.spread[k]].join(',');

  // Copy trading lookups by name
  const copyData = () => ({
    scripts: list('Script', {}, { limit: 500 }), groups: list('CopyGroup', {}, { limit: 500 }),
    accounts: list('TradingAccount', {}, { limit: 1000 }), trades: list('AccountTrade', {}, { sort: 'opened_at', limit: 100000 }),
  });
  const findIn = (rows, name, keys) => {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    const hit = rows.find((r) => keys.some((k) => String(r[k] || '').toLowerCase() === n));
    if (!hit) throw new Error(`No "${name}". Known: ${rows.map((r) => r[keys[0]] || r[keys[1]]).join(', ') || 'none yet'}`);
    return hit;
  };
  const evalOut = (e) => ({
    trades: e.trades, open: e.open, wins: e.wins, losses: e.losses, win_rate: r2(e.winRate * 100), net: e.net, avg_win: e.avgWin, avg_loss: e.avgLoss,
    profit_factor: e.profitFactor === Infinity ? 'infinite' : r2(e.profitFactor), per_trade: e.expectancy, max_drawdown: e.maxDrawdown,
    best: e.best, worst: e.worst, avg_hold_minutes: e.avgHoldMin, longs: e.longs, shorts: e.shorts, xp: e.xp,
  });
  const rank = (xp, step) => { const l = levelFromXp(Number(xp) || 0, step); const t = tierOf(l.level); return `${t.name}${t.division ? ` ${t.division}` : ''} (level ${l.level}, ${l.into}/${l.need} XP to next)`; };

  const tools = {
    copy_trading_summary({ group } = {}) {
      const d = copyData();
      const g = findIn(d.groups, group, ['name']);
      const trades = g ? d.trades.filter((t) => t.group_id === g.id) : d.trades;
      const accounts = g ? d.accounts.filter((a) => a.group_id === g.id) : d.accounts;
      const name = (rows, id) => rows.find((r) => r.id === id)?.name || null;
      return {
        note: 'Paper copies: each account fills at the alert price, sized from its risk per trade. Amounts in dollars.',
        overall: evalOut(evaluate(trades)),
        scripts: d.scripts.map((s) => ({ name: s.name, language: s.language, xp: s.xp || 0, rank: rank(s.xp, SCRIPT_STEP), groups: d.groups.filter((x) => groupScriptIds(x).includes(s.id)).map((x) => x.name), results: evalOut(evaluate(trades.filter((t) => t.script_id === s.id))) })),
        groups: (g ? [g] : d.groups).map((x) => ({ name: x.name, scripts: groupScriptIds(x).map((id) => name(d.scripts, id)).filter(Boolean), paused: x.enabled === false, trades_made: x.trades_made || 0, max_trades: x.max_trades || 100, accounts: d.accounts.filter((a) => a.group_id === x.id).length, results: evalOut(evaluate(d.trades.filter((t) => t.group_id === x.id))) })),
        accounts: accounts.map((a) => ({
          trader: a.display_name, account: a.label, platform: a.platform, group: name(d.groups, a.group_id), status: a.status || 'active',
          plan: a.plan, start_balance: a.start_balance, balance: a.balance, target: a.target, max_loss: a.max_loss, max_loss_floor: a.floor, trailing: a.trailing,
          risk_per_trade: a.risk_usd, order_url: a.forward_url ? 'set' : 'none', xp: a.xp || 0, rank: rank(a.xp, ACCOUNT_STEP),
          results: evalOut(evaluate(trades.filter((t) => t.account_id === a.id))),
        })),
        by_exit: Object.fromEntries([...new Set(trades.filter((t) => t.status === 'closed').map((t) => t.reason || 'signal'))].map((r) => [r, evalOut(evaluate(trades.filter((t) => t.status === 'closed' && (t.reason || 'signal') === r)))])),
      };
    },

    copy_trading_log({ kind, account, script, problems_only, limit = 100, offset = 0 } = {}) {
      const d = copyData();
      const a = findIn(d.accounts, account, ['display_name', 'label']);
      const s = findIn(d.scripts, script, ['name']);
      const q = { ...(kind ? { kind } : {}), ...(a ? { account_id: a.id } : {}), ...(s ? { script_id: s.id } : {}) };
      let rows = list('CopyEvent', q, { sort: '-created_date', limit: 20000 });
      if (problems_only) rows = rows.filter((e) => e.level !== 'info');
      const from = Math.max(0, Number(offset) || 0), n = Math.min(400, Math.max(1, Number(limit) || 100));
      return {
        total: rows.length, offset: from,
        events: rows.slice(from, from + n).map((e) => ({ time: day(e.created_date), kind: e.kind, level: e.level, message: e.message, ...(e.data ? { data: e.data } : {}) })),
        more: Math.max(0, rows.length - from - n),
      };
    },

    copy_trading_trades({ account, script, offset = 0, limit = 100 } = {}) {
      const d = copyData();
      const a = findIn(d.accounts, account, ['display_name', 'label']);
      const s = findIn(d.scripts, script, ['name']);
      const rows = d.trades.filter((t) => (!a || t.account_id === a.id) && (!s || t.script_id === s.id));
      const from = Math.max(0, Number(offset) || 0), n = Math.min(300, Math.max(1, Number(limit) || 100));
      const acc = (id) => d.accounts.find((x) => x.id === id);
      return {
        total: rows.length, results: evalOut(evaluate(rows)), offset: from,
        trades: rows.slice(from, from + n).map((t) => ({
          account: acc(t.account_id)?.display_name || acc(t.account_id)?.label || 'removed', script: d.scripts.find((x) => x.id === t.script_id)?.name, trade_id: t.trade_id,
          symbol: t.symbol, side: t.side, qty: t.qty, entry: t.entry, sl: t.sl, tp: t.tp, exit: t.exit,
          points: t.exit != null ? r2((t.exit - t.entry) * (t.side === 'long' ? 1 : -1)) : null, pnl: t.pnl, xp: t.xp, reason: t.reason, status: t.status,
          opened: day(t.opened_at), closed: day(t.closed_at), order: t.forwarded || null,
        })),
        more: Math.max(0, rows.length - from - n),
      };
    },

    list_markets() {
      return {
        markets: Object.values(INSTRUMENTS).map((i) => ({
          symbol: i.symbol, name: i.name, point: i.point, contract_size: i.contract_size,
          value_per_point_per_lot: r2(i.point * i.contract_size), spread: i.spreadPoints != null ? `${i.spreadPoints} point fixed` : 'real Dukascopy spread per bar',
          data_from: { M1_to_M30: i.minuteStart, H1_H4: i.hourStart, D1: firstDate(i, 'D1') },
        })),
        timeframes: Object.keys(TIMEFRAMES),
        max_range_days: MAX_RANGE_DAYS,
        time: 'Broker server time: UTC+2, UTC+3 while New York is on daylight saving time (like FTMO MT5). Bar times are bar opens.',
        backtester: 'Signals are read on bar close and fill at the next bar open. Buys fill at ask (bid + spread), sells at bid. Stop loss is checked before take profit inside a bar. Trades still open at the end of the test close at the last close. P&L = price move x lots x contract size.',
      };
    },

    list_tests({ bot_name, limit = 10 } = {}) {
      const sessions = list('TestSession', bot_name ? { bot_name } : {}, { sort: '-last_run_at', limit: Math.min(30, Math.max(1, Number(limit) || 10)) });
      if (!sessions.length) return { tests: [], note: bot_name ? `No tests saved for "${bot_name}".` : 'No tests saved yet.' };
      return {
        tests: sessions.map((s) => ({
          bot_name: s.bot_name, target: s.target, timeframe: s.timeframe, balance: s.balance, last_run: day(s.last_run_at),
          runs: list('StrategyRun', { session_id: s.id }, { sort: '-version', limit: 30 }).map(runLine),
        })),
      };
    },

    get_test_run({ run_id }) {
      const r = getRun(run_id);
      const { mc, ...metrics } = r.metrics || {};
      return {
        ...runLine(r), bot_name: r.bot_name, model: r.model, summary: r.summary, rules: r.rules,
        metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, r2(v)])),
        monte_carlo: mc ? { ...mc, bands: undefined } : null,
        rule_checks: r.results, log: String(r.log || '').slice(0, 12000),
        code: r.code, sim_code: r.sim_code,
      };
    },

    get_trades({ run_id, offset = 0, limit = 100 }) {
      const r = getRun(run_id);
      const trades = list('Trade', { run_id: r.id }, { sort: 'entry_time', limit: 100000 });
      const from = Math.max(0, Number(offset) || 0);
      const n = Math.min(200, Math.max(0, Number(limit ?? 100)));
      return {
        run: runLine(r), breakdown: breakdown(trades), offset: from,
        trades: trades.slice(from, from + n).map((t) => ({
          side: t.side, lots: t.lots, entry_time: day(t.entry_time), entry: t.entry, exit_time: day(t.exit_time), exit: t.exit,
          reason: t.reason, pnl: r2(t.pnl), mae: r2(t.mae), mfe: r2(t.mfe),
        })),
        more: Math.max(0, trades.length - from - n),
      };
    },

    async get_bars({ symbol, timeframe, from, to }) {
      const bars = await market.bars(symbol, timeframe, from, to);
      const n = bars.time.length;
      if (!n) return { bars: 0, note: 'No bars in that range (weekend or holiday?).' };
      const start = Math.max(0, n - MAX_BARS);
      const rows = [];
      for (let k = start; k < n; k++) rows.push(csv(bars, k));
      return {
        symbol, timeframe, bars: n - start,
        ...(start ? { note: `The range has ${n} bars; these are the last ${MAX_BARS}. Use a shorter range or higher timeframe for the rest.` } : {}),
        csv: `time,open,high,low,close,volume,spread_points\n${rows.join('\n')}`,
      };
    },

    async market_stats({ symbol, timeframe, from, to }) {
      const bars = await market.bars(symbol, timeframe, from, to);
      const stats = marketStats(bars);
      if (!stats) return { note: 'Too few bars in that range for statistics (need 30).' };
      const n = bars.time.length;
      let hi = -Infinity, lo = Infinity;
      for (let k = 0; k < n; k++) { hi = Math.max(hi, bars.high[k]); lo = Math.min(lo, bars.low[k]); }
      return {
        symbol, timeframe, ...stats, atr14: atrStats(bars), avgBarRangeByWeekday: weekdayRanges(bars),
        high: hi, low: lo, firstOpen: bars.open[0], lastClose: bars.close[n - 1],
      };
    },
    web_search: ({ query, max_results }) => webSearch(String(query || ''), max_results, webKey()),
    web_fetch: ({ url }) => webFetch(String(url || ''), webKey()),
  };

  // -> text for the model (errors are returned too, so the model can correct itself)
  // Files only inside the chat's own workspace
  const inside = (ws, rel) => {
    if (!ws) throw new Error('This chat has no workspace yet: it is created after the first reply');
    const full = path.resolve(ws, String(rel || '.'));
    if (full !== path.resolve(ws) && !full.startsWith(path.resolve(ws) + path.sep)) throw new Error('Only files inside the workspace');
    return full;
  };
  const POINT_VALUE = { XAUUSD: 100, GOLD: 100, US100: 1, NAS100: 1, NQ: 20, MNQ: 2, MGC: 10, GC: 100, ES: 50, MES: 5 };
  Object.assign(tools, {
    calculate: ({ expression }) => {
      const e = String(expression || '').replace(/\^/g, '**');
      if (!/^[\d\s+\-*/().%e]+$/i.test(e)) throw new Error('Only numbers and + - * / ^ % ( )');
      const v = Function(`"use strict"; return (${e});`)();
      if (!Number.isFinite(v)) throw new Error('Not a finite number');
      return { expression, result: Math.round(v * 1e8) / 1e8 };
    },
    position_size: ({ symbol, risk_usd, stop_distance }) => {
      const sym = String(symbol || '').toUpperCase().replace(/\d+!?$/, '');
      const pv = POINT_VALUE[sym];
      if (!pv) throw new Error(`Unknown symbol ${symbol}: one of ${Object.keys(POINT_VALUE).join(', ')}`);
      const raw = Number(risk_usd) / (Number(stop_distance) * pv);
      if (!(raw > 0)) throw new Error('risk_usd and stop_distance must be positive');
      const futures = ['NQ', 'MNQ', 'MGC', 'GC', 'ES', 'MES'].includes(sym);
      const size = futures ? Math.floor(raw) : Math.floor(raw * 100) / 100;
      return { symbol: sym, dollars_per_point_per_unit: pv, size, unit: futures ? 'contracts' : 'lots', risk_at_that_size: Math.round(size * Number(stop_distance) * pv * 100) / 100, note: size <= 0 ? 'Below the minimum size: widen the risk or tighten the stop' : '' };
    },
    prop_rules: ({ firm, model, size }) => {
      const p = loadPresets();
      const f = Object.keys(p.firms).find((x) => x.toLowerCase() === String(firm || '').toLowerCase()) || Object.keys(p.firms).find((x) => x.toLowerCase().includes(String(firm || '').toLowerCase()));
      if (!f) throw new Error(`Unknown firm: one of ${Object.keys(p.firms).join(', ')}`);
      const list = p.presets.filter((x) => x.firm === f && (!size || x.size === Number(size)) && (!model || x.model.toLowerCase().includes(String(model).toLowerCase())));
      return { firm: f, source: p.firms[f].rules_source, checked: p.firms[f].rules_checked, note: p.firms[f].note || '', accounts: list.slice(0, 20).map((x) => ({ model: x.model, size: x.size, stage: x.stage, profit_target: x.profit_target, daily_loss: x.broker_daily_limit, max_loss: x.max_drawdown, drawdown_type: x.drawdown_type, min_trading_days: x.min_trading_days, consistency: x.consistency_eval || x.consistency_funded, fee: x.fee, risk_per_trade: x.risk_usd })) };
    },
    workspace_files: (_, ctx) => {
      const ws = inside(ctx?.workspace, '.');
      const walk = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]));
      return { workspace: ws, files: walk(ws).slice(0, 300) };
    },
    workspace_read: ({ path: rel }, ctx) => ({ path: rel, content: fs.readFileSync(inside(ctx?.workspace, rel), 'utf8').slice(0, 50000) }),
    workspace_write: ({ path: rel, content }, ctx) => {
      if (/\.(exe|bat|cmd|ps1|vbs|dll|sh)$/i.test(String(rel))) throw new Error('Not that file type');
      const full = inside(ctx?.workspace, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, String(content ?? '').slice(0, 200000));
      return { saved: rel };
    },
  });

  async function run(name, input, ctx = {}) {
    let out;
    try {
      if (!tools[name]) throw new Error(`Unknown tool ${name}`);
      out = await tools[name](input || {}, ctx);
    } catch (e) {
      out = { error: e.message };
    }
    const text = JSON.stringify(out);
    return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}... [cut: ask for less]` : text;
  }

  // Short summary of a bot's tests for the system prompt, so even a model without tool support knows the results
  function testBrief(botName) {
    const s = list('TestSession', { bot_name: botName }, { sort: '-last_run_at', limit: 1 })[0];
    if (!s) return '';
    const runs = list('StrategyRun', { bot_name: botName }, { sort: '-version', limit: 12 }).map(runLine);
    const lines = runs.map((r) => `- run ${r.run_id}: v${r.version} ${r.symbol} (${r.window}): net ${r.net}, ${r.trades} trades, win ${r.win_rate}%, PF ${r.profit_factor}, max DD ${r.max_dd_pct}%, Monte Carlo ${r.monte_carlo || 'n/a'}, rules ${r.rules_passed}`);
    const latest = runs[0] && getRun(runs[0].run_id);
    const failed = (latest?.results || []).filter((x) => x.status !== 'pass').map((x) => `- ${x.rule}: ${x.status}. ${x.detail || ''}`);
    return [
      `LINKED BOT: "${botName}" (${s.target}, ${s.timeframe}, balance ${s.balance}). This chat fine-tunes it. Newest tests:`,
      ...lines,
      ...(failed.length ? ['Rule checks not passed on the newest version:', ...failed] : []),
      `Original strategy as the trader wrote it:\n${String(s.strategy || '').slice(0, 4000)}`,
      s.rules ? `Trader's rules:\n${String(s.rules).slice(0, 3000)}` : '',
    ].filter(Boolean).join('\n');
  }

  return { defs: TOOL_DEFS, run, testBrief };
}
