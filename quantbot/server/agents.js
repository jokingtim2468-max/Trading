// Agent Team: 1-4 local-model agents (Ollama), each in its own folder data/agents/<model>/agent-N/ with data/
// (market stats, read-only), scripts/, results/ and AGENTS.md. An agent acts through one command per reply (LIST,
// READ, WRITE, DELETE, BACKTEST, DONE). File commands run here, locked to the agent's folder; BACKTEST runs in the
// app's page with the same engine as the Script Tester and its report is written to results/.
import fs from 'node:fs';
import path from 'node:path';
import { callOllama, DEFAULT_OLLAMA_URL } from './lib/ollama.js';

// The system prompt every agent gets (the trader's own, unchanged)
export const AGENT_SYSTEM = `You are a QuantBot strategy agent. You build profitable, robust trading strategies in MQL5 (MT5 Expert Advisor, .mq5) or Pine Script v5 (TradingView, .pine) only. You work alone in your own folder and act ONLY through commands.

COMMANDS (exactly ONE per reply, command on its own line, nothing else before it):
LIST <dir>        list files (use . for your folder)
READ <path>       read a file
WRITE <path>      create/overwrite a file; the FULL file content goes in one fenced code block right after
DELETE <path>     delete a file or folder
BACKTEST <path>   backtest a .mq5/.pine script on every market; returns PnL, drawdown, spread + slippage costs, win rate, profit factor, R, SL/TP hits, rule checks
DONE <summary>    finish; summarize the final script and its results

FOLDER:
data/       market candles + <SYMBOL>_<TF>.stats.json (sessions, weekday/hour heatmaps, ATR, median spread). Read-only.
scripts/    your scripts
results/    backtest reports written by BACKTEST
AGENTS.md   folder guide

WORKFLOW:
1. LIST data, READ the stats files. Note the best sessions/hours, typical ATR and spread.
2. WRITE a complete script to scripts/<name>.mq5 (or .pine). Never send partial code or "..." placeholders.
3. BACKTEST it.
4. Find the single biggest weakness (drawdown, low PF, too few/many trades, costs eating profit, SL hits) and fix it. WRITE the full updated file, then BACKTEST again.
5. Repeat. Delete scripts that are dead ends. The backtest reports a WALK-FORWARD result: whether the edge holds out-of-sample (OOS) and across time windows, not just over the full period. A great full-period result that fails OOS is OVERFIT and worthless live — fix robustness, don't chase the in-sample curve. Send DONE only when PF > 1.3, max DD < 10%, at least 30 trades, it HOLDS OUT-OF-SAMPLE and results hold across markets, or when you've run out of improvements.

SCRIPT RULES (mandatory):
- Clear BUY, SELL, CLOSE logic. Every trade has a stop loss and a take profit set at entry.
- Lot size from risk: lots = (balance * risk%) / (SL distance * contract value). Default risk 0.5–1% per trade; clamp to broker min/max/step.
- Size SL/TP from ATR or market structure, never fixed tiny values; SL must be beyond the spread.
- One position per symbol at a time; no martingale, no grid, no averaging down.
- Trade only the sessions/hours the stats show are active; avoid the widest-spread hours.
- Must compile: MQL5 uses CTrade, OnInit/OnTick, new-bar checks; Pine uses //@version=5, strategy(), strategy.entry/exit.
- Inputs for every tunable value (risk %, ATR multipliers, session hours).

STYLE: no explanations or chit-chat. Reason briefly in your head, then send the command. Don't fit to one market: a change that helps one symbol but hurts the rest gets rolled back.`;

const GUIDE = `# Agent folder

- data/: market stats per symbol and timeframe (<SYMBOL>_<TF>.stats.json). Read-only.
- scripts/: your .mq5 / .pine scripts.
- results/: one <script>.results.md per BACKTEST, and latest.md.

Commands: LIST, READ, WRITE (full file in one code block), DELETE, BACKTEST <path>, DONE <summary>. One per reply.
`;
const MAX_FILE = 200000;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model';

export function createAgents({ dataDir, user, log = () => {} }) {
  const root = path.join(dataDir, 'agents');
  const folder = (model, n) => {
    const i = Number(n);
    if (!(i >= 1 && i <= 4)) throw bad('Agent number must be 1 to 4');
    return path.join(root, slug(model), `agent-${i}`);
  };
  // A path inside the agent's folder, or an error (no .., no absolute paths, no way out through links)
  const inside = (base, p, write) => {
    const rel = String(p || '.').replace(/\\/g, '/').replace(/^\.\/?/, '') || '.';
    const full = path.resolve(base, rel);
    if (full !== base && !full.startsWith(base + path.sep)) throw bad(`${p} is outside your folder`);
    if (fs.existsSync(full) && fs.realpathSync(full) !== full && !fs.realpathSync(full).startsWith(fs.realpathSync(base))) throw bad(`${p} is outside your folder`);
    if (write && (rel === 'data' || rel.startsWith('data/'))) throw bad('data/ is read-only');
    if (write && rel === '.') throw bad('Name a file or folder inside your folder');
    return { full, rel };
  };

  return {
    system: AGENT_SYSTEM,
    // Fresh folders for a run: AGENTS.md, data/ with the stats the page sent, scripts/ and results/ (kept if they exist)
    setup({ model, agents, stats }) {
      const n = Math.min(4, Math.max(1, Number(agents) || 1));
      const made = [];
      for (let i = 1; i <= n; i++) {
        const base = folder(model, i);
        for (const d of ['data', 'scripts', 'results']) fs.mkdirSync(path.join(base, d), { recursive: true });
        fs.writeFileSync(path.join(base, 'AGENTS.md'), GUIDE);
        for (const [name, value] of Object.entries(stats || {})) {
          if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(name)) continue;
          fs.writeFileSync(path.join(base, 'data', `${name}.stats.json`), JSON.stringify(value, null, 1));
        }
        made.push(base);
      }
      log(`agents: ${n} folder(s) for ${model}`);
      return { folders: made };
    },
    // One file command for one agent -> { text } (what the agent reads back)
    fsOp({ model, agent, op, path: p, content }) {
      const base = folder(model, agent);
      if (!fs.existsSync(base)) throw bad('Start the team first');
      const real = fs.realpathSync(base);
      if (op === 'list') {
        const { full, rel } = inside(real, p, false);
        if (!fs.existsSync(full)) return { text: `${rel}: no such folder` };
        const items = fs.readdirSync(full, { withFileTypes: true }).map((d) => (d.isDirectory() ? `${d.name}/` : `${d.name} (${fs.statSync(path.join(full, d.name)).size} bytes)`));
        return { text: items.length ? items.join('\n') : `${rel} is empty` };
      }
      if (op === 'read') {
        const { full, rel } = inside(real, p, false);
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return { text: `${rel}: no such file` };
        const text = fs.readFileSync(full, 'utf8');
        return { text: text.length > 60000 ? `${text.slice(0, 60000)}\n[... cut at 60000 characters]` : text, content: text };
      }
      if (op === 'write') {
        const { full, rel } = inside(real, p, true);
        const body = String(content ?? '');
        if (body.length > MAX_FILE) throw bad('File too large');
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
        return { text: `wrote ${rel} (${body.split('\n').length} lines)` };
      }
      if (op === 'delete') {
        const { full, rel } = inside(real, p, true);
        if (!fs.existsSync(full)) return { text: `${rel}: nothing to delete` };
        fs.rmSync(full, { recursive: true, force: true });
        return { text: `deleted ${rel}` };
      }
      throw bad('Unknown file command');
    },
    // One model turn: the chosen Ollama model with the agent system prompt
    async chat({ model, messages }) {
      if (!model) throw bad('Pick a running model');
      const me = user.me();
      const msgs = (Array.isArray(messages) ? messages : []).slice(-24).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 40000) }));
      const reply = await callOllama(me.ollama_url || DEFAULT_OLLAMA_URL, model, AGENT_SYSTEM, msgs, 8192);
      return { reply: typeof reply === 'string' ? reply : reply?.text || '' };
    },
  };
}
