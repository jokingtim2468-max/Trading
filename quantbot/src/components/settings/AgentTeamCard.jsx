import { useEffect, useRef, useState } from 'react';
import { Bot, Play, Square } from 'lucide-react';
import { client } from '@/api/client';
import * as api from '@/lib/quantApi';
import { defaultModel, describeOllama, useLocalModels } from '@/lib/models';
import { Button } from '@/components/ui/button';
import { parseCommand } from '@/lib/agents/parse';
import { detectLanguage } from '@/lib/chatScript';
import { reportText } from '@/lib/agents/report';
import { agentMarkets, backtestScript } from '@/lib/agents/backtest';

const post = (p, b) => fetch(`/api/agents/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
const short = (t, n = 220) => (String(t).length > n ? `${String(t).slice(0, n)}…` : String(t));
const langOf = (p) => (/\.mq5$/i.test(p) ? 'MT5' : /\.pine$/i.test(p) ? 'Pine' : null);

// One agent's loop: ask the model, run its one command, send the result back, until DONE, the step limit or Stop
async function runAgent(n, { model, translator, steps, markets, signal, onLog }) {
  const kickoff = `Start. You are agent ${n}. Your workspace is the folder data/agents/${model}/agent-${n}/ in QuantBot's data folder: every path in your commands is relative to it (scripts/, results/, data/, AGENTS.md), and you can't leave it. BACKTEST <path> runs your script on ${markets.map((m) => m.ds.symbol).join(', ')} ${markets[0]?.tf} from ${markets[0]?.from} to ${markets[0]?.to} and writes the report to results/. Send your first command.`;
  const msgs = [{ role: 'user', content: kickoff }];
  const fsOp = (op, path, content) => post('fs', { model, agent: n, op, path, content });
  for (let step = 1; step <= steps; step++) {
    if (signal.aborted) return onLog(n, { step, cmd: 'STOP', text: 'Stopped' }, 'stopped');
    onLog(n, null, 'thinking');
    let reply;
    try { reply = (await post('chat', { model, messages: msgs })).reply; } catch (e) { return onLog(n, { step, cmd: 'ERROR', text: e.message }, 'error'); }
    msgs.push({ role: 'assistant', content: reply });
    const c = parseCommand(reply);
    let result;
    try {
      if (!c) result = 'No command found. Reply with exactly one command on its own line: LIST, READ, WRITE, DELETE, BACKTEST or DONE.';
      else if (c.cmd === 'DONE') return onLog(n, { step, cmd: 'DONE', text: c.arg || 'done' }, 'done');
      else if (c.cmd === 'LIST') result = (await fsOp('list', c.arg || '.')).text;
      else if (c.cmd === 'READ') result = (await fsOp('read', c.arg)).text;
      else if (c.cmd === 'DELETE') result = (await fsOp('delete', c.arg)).text;
      else if (c.cmd === 'WRITE') result = c.code == null ? 'WRITE needs the FULL file in one fenced code block right after the command.' : (await fsOp('write', c.arg, c.code)).text;
      else if (c.cmd === 'BACKTEST') {
        // Detect the script type from the file name, falling back to the code itself (//@version=5 -> Pine,
        // OnTick/#property -> MT5), so the right engine is used even if the extension is wrong or missing.
        const file = c.arg ? await fsOp('read', c.arg) : { content: null, text: 'BACKTEST takes a file path.' };
        const lang = langOf(c.arg) || (file.content ? detectLanguage(file.content) : null);
        if (file.content == null) result = file.text;
        else if (!lang) result = "Couldn't tell if that's Pine or MQL5. Make sure the file is a real strategy (Pine has //@version=5 and strategy(); MQL5 has OnTick and CTrade).";
        else {
          onLog(n, { step, cmd: 'BACKTEST', text: `${c.arg}: testing…` }, 'testing');
          const { results, errors } = await backtestScript({ code: file.content, language: lang, model: translator, markets, signal });
          const name = c.arg.split('/').pop().replace(/\.(mq5|pine)$/i, '');
          result = reportText(name, results, errors);
          await fsOp('write', `results/${name}.results.md`, result);
          await fsOp('write', 'results/latest.md', result);
        }
      }
    } catch (e) { result = `ERROR: ${e.message}`; }
    msgs.push({ role: 'user', content: `RESULT of ${c?.cmd || 'your reply'}${c?.arg ? ` ${c.arg.split('\n')[0]}` : ''}:\n${result}` });
    onLog(n, { step, cmd: c ? `${c.cmd} ${c.arg.split('\n')[0]}`.trim() : '(no command)', text: result }, 'working');
  }
  onLog(n, { step: steps, cmd: 'LIMIT', text: `Stopped at the ${steps}-step limit` }, 'limit');
}

// Settings > Agent team: a running Ollama model and 1-4 agents, each in its own folder, writing and backtesting
// scripts until it's satisfied or reaches the step limit
export default function AgentTeamCard() {
  const named = useLocalModels();
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [translator, setTranslator] = useState('builtin');
  const [count, setCount] = useState(2);
  const [tf, setTf] = useState('M5');
  const [steps, setSteps] = useState(40);
  const [agents, setAgents] = useState([]);
  const [phase, setPhase] = useState('');
  const [err, setErr] = useState('');
  const stopper = useRef(null);

  useEffect(() => {
    Promise.all([client.auth.me(), api.getKeyStatus()]).then(async ([me, status]) => {
      setTranslator(defaultModel(status, me));
      try {
        const list = (await client.functions.invoke('localModel', { action: 'test', url: me.ollama_url })).data.models || [];
        setModels(list);
        setModel((m) => m || me.ollama_model || list[0] || '');
      } catch { setModels([]); }
    });
  }, []);

  const onLog = (n, entry, status) => setAgents((list) => list.map((a) => (a.n === n ? { ...a, status, log: entry ? [...a.log, entry].slice(-200) : a.log } : a)));
  const start = async () => {
    setErr('');
    const ctl = new AbortController();
    stopper.current = ctl;
    setAgents(Array.from({ length: count }, (_, i) => ({ n: i + 1, status: 'starting', log: [] })));
    try {
      setPhase('Loading market data…');
      const markets = await agentMarkets({ tf }, setPhase);
      const stats = Object.fromEntries(markets.map((m) => [`${m.ds.symbol}_${m.tf}`, m.stats]));
      await post('setup', { model, agents: count, stats });
      setPhase('Running');
      await Promise.all(Array.from({ length: count }, (_, i) => runAgent(i + 1, { model, translator, steps: Number(steps) || 40, markets, signal: ctl.signal, onLog })));
    } catch (e) { setErr(e.message); }
    setPhase('');
    stopper.current = null;
  };
  const running = !!phase;
  const STATUS = { thinking: 'text-primary', testing: 'text-chart-4', done: 'text-chart-2', error: 'text-destructive', limit: 'text-muted-foreground', stopped: 'text-muted-foreground' };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4" data-testid="agent-team">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Agent team</h3>
        <span className="text-xs text-muted-foreground">Local agents write and backtest MQL5 / Pine scripts in their own folders</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Running model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running} className="w-full h-9 rounded-md border border-border bg-background px-2" data-testid="agent-model">
            {!models.length && <option value="">No Ollama models found</option>}
            {models.map((m) => <option key={m} value={m}>{describeOllama(m)} ({m})</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Agents</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={running} className="w-full h-9 rounded-md border border-border bg-background px-2" data-testid="agent-count">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Timeframe</span>
          <select value={tf} onChange={(e) => setTf(e.target.value)} disabled={running} className="w-full h-9 rounded-md border border-border bg-background px-2" data-testid="agent-tf">
            {['M5', 'M15', 'M30', 'H1', 'H4'].map((t) => <option key={t} value={t}>{t}{t === 'M5' ? ' (most accurate)' : ''}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Step limit per agent</span>
          <input value={steps} onChange={(e) => setSteps(e.target.value)} disabled={running} inputMode="numeric" className="w-full h-9 rounded-md border border-border bg-background px-2" />
        </label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Backtest translator</span>
          <select value={named.some((m) => m.id === translator) ? translator : named[0]?.id} onChange={(e) => setTranslator(e.target.value)} disabled={running} className="w-full h-9 rounded-md border border-border bg-background px-2">
            {named.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Each agent works in data/agents/&lt;model&gt;/agent-N and can only list, read, write and delete files there (data/ is read-only); BACKTEST runs the Script Tester on XAUUSD, US100 and NQ ({tf}, last 180 days — M5 is the most candle-accurate). Keep this page open while they run. For agents to work at the same time, start Ollama with <code>OLLAMA_NUM_PARALLEL={count}</code>; otherwise they take turns.</p>
      <div className="flex items-center gap-2">
        {!running
          ? <Button onClick={start} disabled={!model} data-testid="agent-start"><Play className="w-4 h-4 mr-1.5" />Start {count} agent{count > 1 ? 's' : ''}</Button>
          : <Button variant="destructive" onClick={() => stopper.current?.abort()} data-testid="agent-stop"><Square className="w-4 h-4 mr-1.5" />Stop</Button>}
        {phase && <span className="text-xs text-muted-foreground">{phase}</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
      {agents.length > 0 && (
        <div className={`grid gap-3 ${agents.length > 1 ? 'md:grid-cols-2' : ''}`}>
          {agents.map((a) => (
            <div key={a.n} className="rounded-xl border border-border bg-background/40 p-3" data-testid="agent-log">
              <div className="flex items-center justify-between text-sm mb-2"><b>Agent {a.n}</b><span className={`text-xs ${STATUS[a.status] || 'text-muted-foreground'}`}>{a.status}</span></div>
              <ol className="max-h-72 overflow-y-auto space-y-1.5 text-xs">
                {a.log.map((e, i) => (
                  <li key={i}><span className="font-mono text-primary">{e.step}. {short(e.cmd, 80)}</span><span className="block text-muted-foreground whitespace-pre-wrap">{short(e.text)}</span></li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
