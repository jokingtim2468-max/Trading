// Settings > "Check everything": runs every part the local model depends on, for real, and reports pass / fail with
// the fix. Nothing here is mocked: it asks Ollama, makes the model call a tool, runs Python, searches the web.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listOllamaModels, ollamaBase, callOllama } from './ollama.js';
import { gpuFit, gpuEnvSaved } from './ollamaSpecs.js';
import { runPython } from './chatTools.js';

const same = (a, b) => a === b || a === `${b}:latest` || `${a}:latest` === b;

export async function selfTest({ me, chatTools, skills, mcp }) {
  const out = [];
  const add = (name, ok, detail, fix = '') => out.push({ name, ok, detail, fix });
  const url = me.ollama_url;
  const model = me.ollama_model || '';
  let models = [];
  try { models = await listOllamaModels(url); add('Ollama is running', true, `${models.length} models installed`); } catch (e) {
    add('Ollama is running', false, e.message, 'Open the Ollama app (ollama.com).');
    return out;
  }
  const installed = models.some((m) => same(m, model));
  add('Chat model installed', installed, model || 'no model set', installed ? '' : 'Settings > Local model: Import your .gguf or pick an installed model, then Save.');
  if (!installed) return out;

  let caps = [];
  try { caps = (await (await fetch(`${ollamaBase(url)}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) })).json()).capabilities || []; } catch { /* old Ollama */ }
  const toolsOk = !caps.length || caps.includes('tools');
  add('Model supports tool calls', toolsOk, caps.length ? `capabilities: ${caps.join(', ')}` : 'not reported by this Ollama version',
    toolsOk ? '' : 'Install qwen2.5-coder:7b (ollama pull qwen2.5-coder:7b), then Import your .gguf again: it copies the tool template.');

  // The model really calls a tool and uses its answer
  const calls = [];
  const calc = chatTools.defs.find((d) => d.name === 'calculate');
  try {
    const t0 = Date.now();
    const reply = await callOllama(url, model, 'You are a test. Use your tools.', [{ role: 'user', content: 'Use the calculate tool to work out 17*23, then reply with only the number.' }], 200,
      { defs: [calc], run: async (n, a) => { calls.push(n); return chatTools.run(n, a); } });
    const ok = calls.includes('calculate') && /391/.test(reply);
    add('Model calls a tool and uses the result', ok, `${calls.length ? `called ${calls.join(', ')}` : 'called no tool'}; replied "${reply.slice(0, 80)}" in ${Math.round((Date.now() - t0) / 1000)} s`,
      ok ? '' : calls.length ? 'It called the tool but ignored the answer: a weak fine-tune. Compare with qwen2.5-coder:7b.' : 'Import the .gguf again with qwen2.5-coder:7b installed (tool template), or use qwen2.5-coder:7b.');
  } catch (e) { add('Model calls a tool and uses the result', false, e.message, 'Check Ollama and the model above.'); }

  const fit = (await gpuFit(url)).find((m) => same(m.name, model));
  const env = await gpuEnvSaved();
  add('Model fits the graphics card', !!fit && fit.gpu_pct >= 100, fit ? `${fit.gpu_pct}% on GPU (${fit.size_gb} GB${fit.context ? `, ${fit.context} context` : ''})${env ? '' : '; GPU memory settings off'}` : 'not loaded',
    fit && fit.gpu_pct >= 100 ? '' : 'Press Fit on my GPU; if still under 100%, set Context to 24k.');

  if (skills) {
    const list = skills.list();
    const ok = list.length > 0 && /NEXT bar|next bar/i.test(skills.load('backtest-rules'));
    add('Skills load', ok, `${list.length} skills: ${list.map((s) => s.name).join(', ')}`);
  }

  if (mcp) {
    await mcp.ensure().catch(() => {});
    const st = mcp.status();
    if (!st.length) add('MCP servers', true, 'none added (optional: Settings > Tools & skills)');
    for (const s of st) add(`MCP server ${s.name}`, s.connected, s.connected ? `${s.tools} tools` : s.error || 'not connected', s.connected ? '' : 'Check its command / URL in Settings > Tools & skills and press Test.');
    if (st.some((s) => s.name === 'mt5' && s.connected)) {
      const r = String(await mcp.run('mcp_mt5_account_info', {}).catch((e) => `Tool error: ${e.message}`));
      let acc = null; try { acc = JSON.parse(r); } catch { /* error text */ }
      add('MT5 terminal (mt5 MCP)', !!acc, acc ? `account ${acc.login} on ${acc.server}, balance ${acc.balance} ${acc.currency}; ${acc.trading_tools}` : r.slice(0, 200),
        acc ? '' : /MetaTrader5 Python package/.test(r) ? 'Run: pip install MetaTrader5' : 'Open MT5, log in to your demo account and turn Algo Trading on.');
    }
  }

  const dir = me.mt5_data_dir || '';
  const csv = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(csv|txt)$/i.test(f)) : [];
  add('MT5 data folder', csv.length > 0, dir ? (fs.existsSync(dir) ? `${csv.length} data files in ${dir}` : `${dir} does not exist`) : 'not set',
    csv.length ? '' : 'Settings > Tools & skills > MT5 data folder: the folder with your MT5 CSV exports.');

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-selftest-'));
  try {
    const r = await runPython({ workspace: ws, dataDir: dir }, 'import sys; print("py", sys.version.split()[0], 2+2)', 'selftest');
    const ok = r.exit_code === 0 && /py .* 4/.test(r.output);
    add('Python runs (run_python)', ok, ok ? r.output.trim() : r.output.slice(-200), ok ? '' : 'Install Python 3 from python.org (tick "Add to PATH"), plus: pip install pandas numpy');
    if (ok) {
      const p = await runPython({ workspace: ws, dataDir: dir }, 'import pandas, numpy; print("pandas", pandas.__version__)', 'selftest2');
      add('pandas + numpy installed', p.exit_code === 0, p.output.trim().slice(-120), p.exit_code === 0 ? '' : 'Run: pip install pandas numpy');
    }
  } catch (e) { add('Python runs (run_python)', false, e.message, 'Install Python 3 from python.org (tick "Add to PATH").'); } finally { fs.rmSync(ws, { recursive: true, force: true }); }

  try {
    const r = JSON.parse(await chatTools.run('web_search', { query: 'MQL5 OrderSend documentation', max_results: 3 }));
    const n = (r.results || []).length;
    add('Internet (web_search)', n > 0, n ? `${n} results, first: ${r.results[0].title || r.results[0].url}` : r.error || 'no results', n ? '' : 'Check the internet connection; an Ollama web search key (Settings) makes it more reliable.');
  } catch (e) { add('Internet (web_search)', false, e.message); }
  return out;
}
