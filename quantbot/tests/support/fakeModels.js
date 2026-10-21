// Stand-ins for the Claude API and Ollama, so the end-to-end run costs nothing and gives the same answers every time.
// They answer the three QuantBot jobs: chat (an EA in a code block), the converter and the script tester (JSON).
import http from 'node:http';
import { ICT_PINE, ICT_SIM_CODE } from './ictSim.js';
import { BASIC_PINE, BASIC_SIM_CODE } from './basicPine.js';

// A strategy the simulator can run that fires BUY, SELL, CLOSE, TP and SL
export const SIM_CODE = `
const c = ctx.close[ctx.i];
const atr = ctx.ta.atr(14);
if (!(atr > 0)) return null;
ctx.state.n = (ctx.state.n || 0) + 1;
const p = ctx.position;
if (p) return p.barsOpen >= 12 ? { action: 'close' } : null;
if (ctx.state.n % 20 !== 0) return null;
const buy = (ctx.state.n / 20) % 2 === 1;
const lots = Math.max(0.01, Math.floor((ctx.balance * 0.01) / (1.5 * atr * ctx.contractSize) * 100) / 100);
return buy
  ? { action: 'buy', lots, sl: c - 1.5 * atr, tp: c + 1.5 * atr }
  : { action: 'sell', lots, sl: c + 1.5 * atr, tp: c - 1.5 * atr };`;

// What a model writes for an ICT script when it rescans the whole chart on every bar: far too slow on months of M15
export const SLOW_SIM_CODE = `
let top = -Infinity;
for (let k = 0; k <= ctx.i; k++) for (let m = 0; m < 4000; m++) top = Math.max(top, ctx.high[k] - m * 1e-9);
return null;`;

export const SLOW_PINE = `// Script: Slow ICT
//@version=5
strategy("Slow ICT", overlay=true)
// order blocks and fair value gaps over the whole chart`;

// Test code with a translation bug: the sweep never fires, so it takes no trades until it is checked
export const QUIET_SIM_CODE = `
ctx.count('in session');
if (ctx.high[ctx.i] < 0) ctx.count('bull sweep');
return null;`;

export const QUIET_PINE = `// Script: Quiet ICT
//@version=5
strategy("Quiet ICT", overlay=true)
// sweep + fair value gap entries in the New York killzone`;

export const EA = `// Script: Gold Breakout
#property strict
#include <Trade\\Trade.mqh>
input double RiskPercent = 1.0;
CTrade trade;
int OnInit() { trade.SetExpertMagicNumber(4821); return INIT_SUCCEEDED; }
void OnTick() { /* breakout logic */ }`;

function reply(system, last = '') {
  // Chat naming: a stable title from the first words, so tests can find the chat
  if (system.startsWith('You name chats')) return last.split(/\s+/).slice(0, 4).join(' ');
  if (/long ea/i.test(last)) return longReply();
  if (/basic pine/i.test(last) && !system.startsWith("You are QuantBot's strategy tester")) {
    return `Here is a basic EMA cross strategy.\n\n\`\`\`pine\n${BASIC_PINE}\n\`\`\``;
  }
  if (/live ict/i.test(last) && !system.startsWith("You are QuantBot's strategy tester")) {
    return `Here is the ICT strategy.\n\n\`\`\`pine\n${ICT_PINE}\n\`\`\``;
  }
  if (/quiet ict/i.test(last) && !system.startsWith("You are QuantBot's strategy tester")) {
    return `Here is the ICT strategy.\n\n\`\`\`pine\n${QUIET_PINE}\n\`\`\``;
  }
  if (/slow ict/i.test(last) && !system.startsWith("You are QuantBot's strategy tester")) {
    return `Here is the ICT strategy.\n\n\`\`\`pine\n${SLOW_PINE}\n\`\`\``;
  }
  if (system.startsWith("You are QuantBot's strategy converter")) {
    return JSON.stringify({
      code: EA, sim_code: SIM_CODE, summary: 'ATR breakout with fixed 1.5 ATR stop and target.',
      results: [
        { rule: 'Max risk 1% per trade', status: 'pass', detail: 'Lots sized from 1% of balance.' },
        { rule: 'Every trade has a stop loss', status: 'pass', detail: 'SL on every order.' },
      ],
    });
  }
  if (system.startsWith("You are QuantBot's strategy tester")) {
    if (last.includes('Script: Basic EMA Cross')) {
      return JSON.stringify({ sim_code: BASIC_SIM_CODE, summary: 'EMA 9/21 cross with a 1.5 ATR stop and 2R target, closed on the opposite cross.', rules: ['Long on EMA 9 crossing above EMA 21, short on the cross below, only when flat', 'Stop 1.5 x ATR(14), target 2 x the stop', 'Opposite cross closes the trade', 'Risk 1% of balance per trade'] });
    }
    if (last.includes('Script: Live ICT')) {
      return JSON.stringify({ sim_code: ICT_SIM_CODE, summary: 'ICT sweep + FVG in the New York killzone.', rules: ['13 rules as in the script'] });
    }
    // The quiet script first comes back with a bug that never trades; checked with the counts, it comes back fixed
    if (last.includes('Script: Quiet ICT') && !last.includes('TOOK NO TRADES')) {
      return JSON.stringify({ sim_code: QUIET_SIM_CODE, summary: 'ICT sweep and FVG.', rules: ['Sweep then FVG in the killzone'] });
    }
    // The slow script first comes back slow; asked again with the speed note, it comes back fast
    if (last.includes('Script: Slow ICT') && !last.includes('WAS TOO SLOW')) {
      return JSON.stringify({ sim_code: SLOW_SIM_CODE, summary: 'ICT order blocks.', rules: ['Order blocks from the whole chart'] });
    }
    return JSON.stringify({ sim_code: SIM_CODE, summary: 'Breakout on ATR with time exit.', rules: ['Enter every 20 bars', 'SL and TP 1.5 ATR', 'Close after 12 bars'] });
  }
  return `Here is the EA.\n\n\`\`\`mql5\n${EA}\n\`\`\`\n\nBacktest it before going live.`;
}

// A 60-line EA, for the chat's collapsed code blocks
export const LONG_EA = [EA, ...Array.from({ length: 53 }, (_, k) => `// filler line ${k + 1}`)].join('\n');
function longReply() {
  return `Full EA below.\n\n\`\`\`mql5\n${LONG_EA}\n\`\`\``;
}

// Chat with data tools: "check my tests" makes the fake call list_tests and market_stats, then answer from the results
function chatWithTools(b) {
  const last = b.messages[b.messages.length - 1];
  if (typeof last.content === 'string' && /check my tests/i.test(last.content)) {
    return {
      content: [
        { type: 'text', text: 'Reading your tests and gold volatility.' },
        { type: 'tool_use', id: 'tu_1', name: 'list_tests', input: { bot_name: 'E2E Bot' } },
        { type: 'tool_use', id: 'tu_2', name: 'market_stats', input: { symbol: 'XAUUSD', timeframe: 'M15', from: '2024-03-04', to: '2024-03-08' } },
      ],
      stop_reason: 'tool_use',
    };
  }
  if (Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result')) {
    const [tests, stats] = last.content.map((c) => JSON.parse(c.content));
    const runs = tests.tests.flatMap((t) => t.runs);
    const text = `I read ${runs.length} tests of E2E Bot (best net ${Math.max(...runs.map((r) => r.net)).toFixed(2)}). XAUUSD M15 median ATR(14) that week: ${stats.atr14.median}.\n\n\`\`\`mql5\n${EA}\n\`\`\``;
    return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
  }
  return null;
}

const json = (res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

export async function startFakeModels({ delayMs = 800 } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : {};
      if (req.url === '/api/tags') return json(res, { models: [{ name: 'qwen2.5-coder:7b' }] });
      if (req.url === '/api/chat') {
        calls.push({ kind: 'ollama', model: b.model, headers: req.headers });
        const system = b.messages[0].content;
        return setTimeout(() => json(res, { message: { role: 'assistant', content: `(local) ${reply(system)}` } }), delayMs);
      }
      if (req.url === '/v1/messages') {
        calls.push({ kind: 'claude', model: b.model, fallbacks: b.fallbacks, headers: req.headers, system: b.system, tools: (b.tools || []).map((t) => t.name), messages: b.messages });
        const lastUser = [...b.messages].reverse().find((m) => m.role === 'user');
        const answer = (b.tools && chatWithTools(b)) || { content: [{ type: 'text', text: reply(b.system, typeof lastUser?.content === 'string' ? lastUser.content : '') }], stop_reason: 'end_turn' };
        return setTimeout(() => json(res, answer), delayMs);
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}
