// Tools the chat models call to read the trader's own tests and QuantBot's built-in market data, so fine-tuning
// advice is based on real numbers instead of guesses. Every tool only reads; nothing is changed or traded.
import { INSTRUMENTS, TIMEFRAMES, MAX_RANGE_DAYS, firstDate } from '../market/instruments.js';
import { marketStats } from '../../src/lib/backtest/marketStats.js';

const MAX_RESULT = 60000; // characters per tool result, so a big answer can't crowd out the conversation
const MAX_BARS = 1500;
const r2 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 100) / 100);
const day = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : null);

export const TOOL_DEFS = [
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

export function createChatTools({ db, market }) {
  const list = (entity, query, opts) => db.run(entity, 'filter', query, opts).items;
  const getRun = (id) => {
    try {
      return db.run('StrategyRun', 'get', String(id || ''));
    } catch {
      throw new Error(`No test run ${id}. Use list_tests for run ids.`);
    }
  };
  const csv = (bars, k) => [new Date(bars.time[k]).toISOString().slice(0, 16).replace('T', ' '), bars.open[k], bars.high[k], bars.low[k], bars.close[k], bars.volume[k], bars.spread[k]].join(',');

  const tools = {
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
  };

  // -> text for the model (errors are returned too, so the model can correct itself)
  async function run(name, input) {
    let out;
    try {
      if (!tools[name]) throw new Error(`Unknown tool ${name}`);
      out = await tools[name](input || {});
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
