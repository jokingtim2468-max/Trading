// Stand-ins for the Claude API and Ollama, so the end-to-end run costs nothing and gives the same answers every time.
// They answer the three QuantBot jobs: chat (an EA in a code block), the converter and the script tester (JSON).
import http from 'node:http';

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

export const EA = `// Script: Gold Breakout
#property strict
#include <Trade\\Trade.mqh>
input double RiskPercent = 1.0;
CTrade trade;
int OnInit() { trade.SetExpertMagicNumber(4821); return INIT_SUCCEEDED; }
void OnTick() { /* breakout logic */ }`;

function reply(system) {
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
    return JSON.stringify({ sim_code: SIM_CODE, summary: 'Breakout on ATR with time exit.', rules: ['Enter every 20 bars', 'SL and TP 1.5 ATR', 'Close after 12 bars'] });
  }
  return `Here is the EA.\n\n\`\`\`mql5\n${EA}\n\`\`\`\n\nBacktest it before going live.`;
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
        calls.push({ kind: 'claude', model: b.model, fallbacks: b.fallbacks, headers: req.headers });
        return setTimeout(() => json(res, { content: [{ type: 'text', text: reply(b.system) }], stop_reason: 'end_turn' }), delayMs);
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}
