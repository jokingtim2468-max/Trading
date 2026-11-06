import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { selfTest } from '../../server/lib/selfTest.js';
import { callOllama } from '../../server/lib/ollama.js';
import { createChatTools } from '../../server/lib/chatTools.js';
import { toolsBrief } from '../../server/lib/chatPrompt.js';

// A fake Ollama: "good" calls the calculate tool and uses the result; "notools" has no tool template
function fakeOllama() {
  return http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const j = body ? JSON.parse(body) : {};
    const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/tags') return send({ models: [{ name: 'good:latest' }, { name: 'notools:latest' }] });
    if (req.url === '/api/show') return send({ capabilities: j.model === 'notools' ? ['completion'] : ['completion', 'tools'] });
    if (req.url === '/api/ps') return send({ models: [{ name: 'good:latest', size: 5e9, size_vram: 5e9, context_length: 32768 }] });
    if (req.url === '/api/chat') {
      if (j.tools && j.model === 'notools') return send({ error: 'registry.ollama.ai/library/notools does not support tools' }, 400);
      const last = j.messages[j.messages.length - 1];
      if (j.tools && last.role === 'user') return send({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'calculate', arguments: { expression: '17*23' } } }] } });
      return send({ message: { role: 'assistant', content: last.role === 'tool' ? String(JSON.parse(last.content).result ?? last.content) : 'Hello' } });
    }
    send({ error: 'nope' }, 404);
  });
}

test('a model without tool support says so in its reply instead of silently answering without tools', async () => {
  const s = fakeOllama(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  const tools = createChatTools({ db: null, market: null });
  const reply = await callOllama(url, 'notools', 'sys', [{ role: 'user', content: 'hi' }], 50, tools);
  assert.match(reply, /^Hello/);
  assert.match(reply, /can't call tools in Ollama/);
  assert.doesNotMatch(await callOllama(url, 'good', 'sys', [{ role: 'user', content: 'hi' }], 50, tools), /can't call tools/);
  s.close();
});

test('Check everything: runs the model tool call, GPU fit, skills, MCP and Python, with a fix for each failure', async () => {
  const s = fakeOllama(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  const chatTools = createChatTools({ db: null, market: null });
  const skills = { list: () => [{ name: 'backtest-rules' }], load: () => "Enter on the NEXT bar's OPEN" };
  const mcp = { ensure: async () => {}, status: () => [] };
  const good = await selfTest({ me: { ollama_url: url, ollama_model: 'good' }, chatTools, skills, mcp });
  const by = (list, n) => list.find((c) => c.name === n);
  assert.equal(by(good, 'Ollama is running').ok, true);
  assert.equal(by(good, 'Model supports tool calls').ok, true);
  assert.equal(by(good, 'Model calls a tool and uses the result').ok, true, by(good, 'Model calls a tool and uses the result').detail);
  assert.equal(by(good, 'Model fits the graphics card').ok, true);
  assert.equal(by(good, 'Skills load').ok, true);
  assert.equal(by(good, 'MT5 data folder').ok, false);
  assert.match(by(good, 'MT5 data folder').fix, /MT5 data folder/);
  assert.ok(by(good, 'Python runs (run_python)'), 'python is checked');
  const bad = await selfTest({ me: { ollama_url: url, ollama_model: 'notools' }, chatTools, skills, mcp });
  assert.equal(by(bad, 'Model supports tool calls').ok, false);
  assert.match(by(bad, 'Model supports tool calls').fix, /Import your \.gguf again/);
  assert.equal(by(bad, 'Model calls a tool and uses the result').ok, false);
  s.close();
});

test('the system prompt tells the model which tools it has, that it has the internet, and what MCP means', () => {
  const t = toolsBrief({ tools: [{ name: 'web_search', description: 'Search the web. More.' }, { name: 'run_python', description: 'Run Python.' }], mcp: [] });
  assert.match(t, /YOUR TOOLS/);
  assert.match(t, /- web_search: Search the web\./);
  assert.match(t, /you DO have the internet/);
  assert.match(t, /MCP means Model Context Protocol/);
  assert.match(t, /Connected now: none/);
  assert.match(t, /never place trades/);
});
