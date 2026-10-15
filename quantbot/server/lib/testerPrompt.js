// Strategy Tester (chat scripts) prompt, task and result shaping.
import { SIM_CONTRACT, marketText, clip } from './simContract.js';

const BALANCE = 10000;

// Tester settings are fixed here so the trader only picks a chat and a timeframe
const SETTINGS = `TESTER SETTINGS (fixed, never ask the trader):
- Starting balance $${BALANCE}. One position at a time. Orders fill at the next bar's open, spread comes from the data, no commission.
- Run the script exactly as written with its default input values (lot size, risk %, SL/TP, sessions, filters, breakeven, trailing).
- Only open the sides the script opens: a long-only script never sells, a short-only script never buys.
- Position size: a fixed lot input in an MT5 script is used as-is; a risk % input is applied to ctx.balance and the stop distance. Otherwise (including Pine qty/contracts) risk 1% of balance per trade: lots = (ctx.balance * 0.01) / (stop distance * ctx.contractSize), rounded down to 0.01, min 0.01. Never invent a fixed lot.
- If an entry has no stop loss or take profit, use 1.5x ATR(14) for the stop and 2x the stop distance for the target, and say so in the rules.
- Session and time filters use ctx.hour / ctx.minute (broker server time of the data) with the script's own hours and offsets.`;

export const TESTER_SYSTEM = `You are QuantBot's strategy tester. You get a complete MetaTrader 5 (MQL5) or TradingView (Pine Script) script. Translate its trading logic into sim_code for QuantBot's bar-by-bar simulator so the backtest measures the script as written.
- Reproduce the logic faithfully: entries, filters, sessions, stops, targets, breakeven, trailing, partial closes (approximate as a stop move) and strategy exits. Do not improve or change the strategy.
- Logic that needs data the simulator lacks (ticks, other symbols, order book) is approximated on the available bars and noted in the rules. Build higher-timeframe values (H1/H4/D1 highs, lows, EMAs, Asian range) from the current bars inside ctx.state.
- ${SIM_CONTRACT}

${SETTINGS}

Respond with ONLY a JSON object, no Markdown fences, shaped exactly:
{"sim_code": string, "summary": string, "rules": [string]}
summary: one or two sentences on what the strategy does. rules: the entry, exit and risk rules exactly as implemented in sim_code, one short line each.`;

export const TESTER_SCHEMA = {
  type: 'object',
  properties: { sim_code: { type: 'string' }, summary: { type: 'string' }, rules: { type: 'array', items: { type: 'string' } } },
};

// Why the script can't be tested, or null
export function testerInputError({ code, language }) {
  if (!code?.trim()) return 'No script to test';
  if (code.length > 80000) return 'Script is too long to test';
  if (!['MT5', 'Pine'].includes(language)) return 'Script must be MT5 or Pine';
  return null;
}

// slow: { sim_code, done, total, seconds } from a previous translation that ran too slowly
// idle: { sim_code, bars, counts, log } from a previous translation that took no trades
export const testerTask = ({ code, language, market, slow, idle }) => {
  const task = `${marketText({ ...market, balance: BALANCE })}\n\n${language === 'MT5' ? 'MQL5 EXPERT ADVISOR' : 'PINE SCRIPT'}:\n${code}`;
  if (idle?.sim_code) {
    const counts = idle.counts && typeof idle.counts === 'object' && Object.keys(idle.counts).length
      ? Object.entries(idle.counts).slice(0, 30).map(([k, v]) => `${clip(k, 40)}: ${Number(v) || 0}`).join(', ')
      : 'none (ctx.count was never called)';
    const lines = Array.isArray(idle.log) ? idle.log.slice(0, 10).map((l) => `- ${clip(l, 300)}`).join('\n') : '';
    return `${task}\n\nYOUR PREVIOUS sim_code TOOK NO TRADES in ${Number(idle.bars) || 0} bars of this market (it never returned a buy or sell).\nCondition counts: ${counts}\n${lines ? `Simulator log:\n${lines}\n` : ''}A script like this normally trades over that many bars, so look for translation bugs first: the wrong clock (ctx.hour is server time, ctx.nyHour is New York time), off-by-one bar offsets (Pine's [1] is ctx.i - 1), conditions required on the same bar that the script allows on different bars, state that is never set or never reset, a daily limit that starts at zero, NaN from an indicator or a value read before it exists, comparisons the wrong way round. Fix every bug, keep the script's logic exactly, and call ctx.count at each entry stage. If the script as written truly cannot trade here, return the same logic and say which rule blocks it in the summary.\nPREVIOUS sim_code:\n${clip(idle.sim_code, 30000)}`;
  }
  if (!slow?.sim_code) return task;
  const progress = `${Number(slow.done) || 0} of ${Number(slow.total) || 0} bars in ${Number(slow.seconds) || 0}s`;
  return `${task}\n\nYOUR PREVIOUS sim_code WAS TOO SLOW (${slow.stuck ? 'stuck inside one bar' : progress}) and the test was stopped. Rewrite it so the logic stays exactly the same but every bar does a small, fixed amount of work, following the SPEED rules: no loops back to the start of the chart, no lists that grow forever, lookbacks of at most 300 bars, state updated incrementally in ctx.state.\nPREVIOUS sim_code:\n${clip(slow.sim_code, 30000)}`;
};

// The tester response, or null when the model returned no simulation
export function testerResult(report) {
  if (!report?.sim_code) return null;
  return {
    sim_code: String(report.sim_code),
    summary: String(report.summary || ''),
    rules: Array.isArray(report.rules) ? report.rules.map(String) : [],
    settings: { balance: BALANCE },
  };
}