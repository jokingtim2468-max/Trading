// Loop-fix: one local model lives in its workspace folder, backtests the script it is improving, reads the result,
// writes a better version, and does it again on a timer (default every 10 minutes) until the script stops getting
// better. Runs in the page (the backtest engine is the browser's), as a module singleton so it survives navigating
// between pages; it stops when the app is closed. Started from the chat with /loopfix.
import { client } from '@/api/client';
import { scriptFromMessage } from '@/lib/chatScript';
import { agentMarkets, backtestScript } from '@/lib/agents/backtest';
import { scoreOf } from '@/lib/agents/loopfixScore';
export { scoreOf };

const AGENT = 1; // loop-fix uses the first agent folder of the chosen model
const PLATEAU_ROUNDS = 3; // stop after this many rounds with no improvement ("as good as it can be")
const post = (p, b) => fetch(`/api/agents/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
const slug = (s) => String(s || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'script';
const ext = (lang) => (lang === 'MT5' ? 'mq5' : 'pine');

function reportFor(name, code, results, errors) {
  const lines = (results || []).map((r) => {
    const m = r.metrics || {};
    return `- ${r.symbol}: PF ${Number(m.profitFactor || 0).toFixed(2)}, net ${Math.round(m.net || 0)}, max DD ${Number(m.maxDDPct || 0).toFixed(1)}%, ${m.trades || 0} trades, ${Number(m.winRate || 0).toFixed(0)}% win`;
  });
  return `# ${name} backtest\n\n${lines.join('\n') || '(no trades)'}\n${errors?.length ? `\nErrors:\n${errors.join('\n')}` : ''}`;
}

const state = {
  running: false, scriptId: null, name: '', language: 'Pine', model: '', translator: 'builtin',
  intervalMs: 600000, round: 0, phase: 'idle', current: null, best: null, history: [], log: [], nextAt: 0, error: '',
};
let timer = null;
let markets = null;
const subs = new Set();
const emit = () => subs.forEach((cb) => cb({ ...state, history: [...state.history], log: [...state.log] }));
export const getState = () => ({ ...state, history: [...state.history], log: [...state.log] });
export const subscribe = (cb) => { subs.add(cb); cb(getState()); return () => subs.delete(cb); };
const addLog = (text) => { state.log = [...state.log, { at: Date.now(), text }].slice(-80); };

async function fsWrite(path, content) { return post('fs', { model: state.model, agent: AGENT, op: 'write', path, content }); }

// One pass: backtest the live script, keep it if it's the best so far (else roll back to the best), then ask the
// model for a better version and save that as the new live script.
async function round() {
  if (!state.running) return;
  const file = `scripts/${slug(state.name)}.${ext(state.language)}`;
  try {
    state.round += 1;
    state.phase = 'testing';
    emit();
    await fsWrite(file, state.current.code);
    const { results, errors } = await backtestScript({ code: state.current.code, language: state.language, model: state.translator, markets });
    const sc = scoreOf(results);
    const report = reportFor(state.name, state.current.code, results, errors);
    await fsWrite(`results/${slug(state.name)}.results.md`, report);
    await fsWrite('results/latest.md', report);
    state.current = { ...state.current, ...sc, report };
    state.history = [...state.history, { round: state.round, ...sc }].slice(-200);

    const improved = !state.best || sc.score > state.best.score + 1e-6;
    if (improved) {
      state.best = { code: state.current.code, report, ...sc, round: state.round };
      await fsWrite('results/best.md', `${report}\n\n<!-- best so far, round ${state.round}, score ${sc.score} -->`);
      addLog(`Round ${state.round}: new best — PF ${sc.pf}, DD ${sc.ddPct}%, net ${sc.net}, ${sc.trades} trades`);
    } else {
      addLog(`Round ${state.round}: no better (PF ${sc.pf}, score ${sc.score} vs best ${state.best.score}) — kept the best`);
      state.current = { ...state.current, code: state.best.code }; // roll the live script back to the best
    }

    // Stop when the best hasn't moved for a while: it's as good as this model can make it.
    const sinceBest = state.round - state.best.round;
    if (sinceBest >= PLATEAU_ROUNDS) {
      await commitBest(`Loop-fix finished: no improvement in ${PLATEAU_ROUNDS} rounds. Best PF ${state.best.pf}, DD ${state.best.ddPct}%, net ${state.best.net}.`);
      finish('done');
      return;
    }

    // Ask the model to improve it, using the result it just saw
    state.phase = 'fixing';
    emit();
    const kickoff = `WRITE ${file}\nThis is "${state.name}" (${state.language}). Its latest backtest on XAUUSD, US100 and NQ (${markets[0]?.tf || 'M5'}, 180 days):\n\n${report}\n\nHere is the current full script:\n\n\`\`\`${state.language === 'MT5' ? 'mql5' : 'pine'}\n${state.current.code}\n\`\`\`\n\nFind its single biggest weakness from the result above (drawdown, low profit factor, too few/many trades, costs, SL hits) and fix exactly that. Reply with WRITE ${file} and the FULL improved script in one code block — no partial code, no placeholders.`;
    const { reply } = await post('chat', { model: state.model, messages: [{ role: 'user', content: kickoff }] });
    const next = scriptFromMessage(reply || '');
    if (next && next.code && next.code.length > 40) {
      state.current = { code: next.code };
      state.language = next.language || state.language;
      await client.entities.Script.update(state.scriptId, { code: next.code, language: state.language });
      addLog(`Round ${state.round}: wrote a new version (${next.code.split('\n').length} lines)`);
    } else {
      addLog(`Round ${state.round}: the model didn't return a full script — testing the same one again`);
    }
  } catch (e) {
    state.error = e.message;
    addLog(`Round ${state.round}: ${e.message}`);
  }
  if (!state.running) return;
  state.phase = 'waiting';
  state.nextAt = Date.now() + state.intervalMs;
  emit();
  timer = setTimeout(round, state.intervalMs);
}

// Put the best version back on the live script (we may have left a regressed attempt as "current")
async function commitBest(note) {
  if (!state.best) return;
  state.current = { ...state.current, code: state.best.code };
  try { await client.entities.Script.update(state.scriptId, { code: state.best.code, language: state.language }); } catch { /* script deleted */ }
  if (note) addLog(note);
}

function finish(phase) {
  state.running = false;
  state.phase = phase;
  state.nextAt = 0;
  clearTimeout(timer);
  timer = null;
  emit();
}

// Start loop-fixing one script with a local model. intervalMinutes defaults to 10.
export async function start({ scriptId, model, translator, intervalMinutes = 10 }) {
  if (state.running) throw new Error('Loop-fix is already running — stop it first.');
  const script = await client.entities.Script.get(scriptId);
  if (!script?.code) throw new Error(`"${script?.name || 'That script'}" has no code yet — write a first version, then run /loopfix.`);
  Object.assign(state, {
    running: true, scriptId, name: script.name, language: script.language || 'Pine', model, translator,
    intervalMs: Math.max(1, Number(intervalMinutes) || 10) * 60000, round: 0, phase: 'starting',
    current: { code: script.code }, best: null, history: [], log: [], nextAt: 0, error: '',
  });
  emit();
  if (!markets) { addLog('Loading market data…'); markets = await agentMarkets({ tf: 'M5' }); }
  const stats = Object.fromEntries(markets.map((m) => [`${m.ds.symbol}_${m.tf}`, m.stats]));
  await post('setup', { model, agents: 1, stats });
  addLog(`Loop-fixing "${script.name}" every ${state.intervalMs / 60000} min with ${model}. Keep QuantBot open.`);
  emit();
  round();
}

export async function stop() {
  if (!state.running && state.phase === 'idle') return;
  await commitBest('Stopped. The best version is on the script.');
  finish('stopped');
}
