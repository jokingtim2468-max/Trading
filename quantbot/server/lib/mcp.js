// MCP (Model Context Protocol) client: QuantBot connects to the MCP servers set in Settings and hands their tools to the
// local model, so it can use them like its built-in tools. Two transports:
//   stdio: QuantBot starts the server (command + args) and talks JSON-RPC over its stdin / stdout, one message per line
//   http:  Streamable HTTP, JSON-RPC POSTed to the server's URL (the answer is JSON or a short SSE stream)
// Only tools are used (no prompts / resources). A server is started on first use and kept running until QuantBot quits.
import { spawn } from 'node:child_process';
import path from 'node:path';

const PROTOCOL = '2025-06-18';
const CALL_TIMEOUT = 120000;
const MAX_RESULT = 30000; // characters of one tool result sent back to the model
export const MCP_PREFIX = 'mcp_';

// Ollama / OpenAI tool names: letters, digits, _ and -, at most 64 characters
export const toolName = (server, tool) => `${MCP_PREFIX}${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

// A server's settings as saved in Settings: { name, transport: 'stdio' | 'http', command, args[], env{}, url, headers{}, enabled }
export function cleanServer(s) {
  const name = String(s?.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 24);
  if (!name) throw new Error('Give the MCP server a short name (letters, numbers, - or _)');
  const transport = s.transport === 'http' ? 'http' : 'stdio';
  const out = { name, transport, enabled: s.enabled !== false };
  if (transport === 'stdio') {
    out.command = String(s.command || '').trim();
    if (!out.command) throw new Error('Command is required (e.g. npx, uvx, node, python)');
    out.args = Array.isArray(s.args) ? s.args.map(String) : String(s.args || '').split(/\s+/).filter(Boolean);
    out.env = s.env && typeof s.env === 'object' ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [String(k), String(v)])) : {};
  } else {
    out.url = String(s.url || '').trim();
    if (!/^https?:\/\//.test(out.url)) throw new Error('URL must start with http:// or https://');
    out.headers = s.headers && typeof s.headers === 'object' ? Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [String(k), String(v)])) : {};
  }
  return out;
}

function stdioConnection(cfg, log) {
  // Windows needs a shell for npx / uvx (.cmd files), but a full path to an .exe runs directly (a shell would split
  // "C:\Program Files\..." at the space); with a shell, arguments holding spaces are quoted
  const win = process.platform === 'win32';
  const direct = !win || /\.exe$/i.test(cfg.command) || path.isAbsolute(cfg.command);
  const q = (s) => (direct || !/[\s"]/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
  const child = spawn(direct ? cfg.command : q(cfg.command), (cfg.args || []).map(q), {
    env: { ...process.env, ...(cfg.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: !direct,
  });
  const pending = new Map(); let buf = ''; let closed = null; let stderr = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); p(msg); }
    }
  });
  child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-2000); });
  const fail = (why) => { closed = why; for (const [, p] of pending) p({ error: { message: why } }); pending.clear(); };
  child.on('error', (e) => fail(`could not start "${cfg.command}": ${e.message}`));
  child.on('exit', (code) => fail(`the server stopped (exit ${code})${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`));
  return {
    send(msg) {
      if (closed) return Promise.resolve({ error: { message: closed } });
      child.stdin.write(`${JSON.stringify(msg)}\n`);
      if (msg.id == null) return Promise.resolve(null);
      return new Promise((resolve) => {
        const t = setTimeout(() => { pending.delete(msg.id); resolve({ error: { message: 'timed out' } }); }, CALL_TIMEOUT);
        pending.set(msg.id, (m) => { clearTimeout(t); resolve(m); });
      });
    },
    close() { try { child.kill(); } catch { /* already gone */ } },
    get closed() { return closed; },
  };
}

function httpConnection(cfg, fetchImpl) {
  let session = null;
  return {
    async send(msg) {
      const res = await fetchImpl(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...(session ? { 'mcp-session-id': session } : {}), ...(cfg.headers || {}) },
        body: JSON.stringify(msg), signal: AbortSignal.timeout(CALL_TIMEOUT),
      });
      session = res.headers.get('mcp-session-id') || session;
      if (msg.id == null) return null;
      if (!res.ok) return { error: { message: `HTTP ${res.status}` } };
      const text = await res.text();
      if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
        // the answer is one of the "data:" lines of the stream
        for (const line of text.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try { const m = JSON.parse(line.slice(5)); if (m.id === msg.id) return m; } catch { /* not JSON */ }
        }
        return { error: { message: 'no answer in the event stream' } };
      }
      try { return JSON.parse(text); } catch { return { error: { message: 'the server did not answer with JSON' } }; }
    },
    close() {},
    closed: null,
  };
}

// servers(): the saved list. Returns { tools(): [{ name, description, parameters, server }], run(name, args), test(cfg), close() }
export function createMcp({ servers, log = () => {}, fetchImpl = fetch } = {}) {
  const live = new Map(); // server name -> { cfg, conn, tools, error }
  let nextId = 1;

  async function rpc(conn, method, params) {
    const r = await conn.send({ jsonrpc: '2.0', id: nextId++, method, params });
    if (r?.error) throw new Error(r.error.message || 'MCP error');
    return r?.result;
  }

  async function connect(cfg) {
    const conn = cfg.transport === 'http' ? httpConnection(cfg, fetchImpl) : stdioConnection(cfg, log);
    try {
      await rpc(conn, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'QuantBot', version: '1.0.0' } });
      await conn.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const tools = [];
      let cursor;
      do {
        const page = await rpc(conn, 'tools/list', cursor ? { cursor } : {});
        tools.push(...(page?.tools || []));
        cursor = page?.nextCursor;
      } while (cursor && tools.length < 500);
      return { cfg, conn, tools, error: null };
    } catch (e) {
      conn.close();
      throw new Error(`${cfg.name}: ${e.message}`);
    }
  }

  // Connects every enabled server that is not running yet; a failing server is skipped and its error kept
  async function ensure() {
    const want = (servers() || []).filter((s) => s.enabled !== false);
    for (const [name, s] of live) {
      const cfg = want.find((w) => w.name === name);
      if (!cfg || JSON.stringify(cfg) !== JSON.stringify(s.cfg) || s.conn?.closed) { s.conn?.close(); live.delete(name); }
    }
    for (const cfg of want) {
      if (live.has(cfg.name)) continue;
      try { live.set(cfg.name, await connect(cfg)); log(`mcp ${cfg.name}: ${live.get(cfg.name).tools.length} tools`); } catch (e) {
        live.set(cfg.name, { cfg, conn: null, tools: [], error: e.message }); log(`mcp ${e.message}`);
      }
    }
  }

  async function tools() {
    await ensure();
    const out = [];
    for (const [server, s] of live) {
      for (const t of s.tools) {
        out.push({ name: toolName(server, t.name), server, tool: t.name, description: `[${server}] ${String(t.description || '').slice(0, 600)}`, parameters: t.inputSchema || { type: 'object', properties: {} } });
      }
    }
    return out;
  }

  // name: the tool name as given to the model (mcp_<server>_<tool>); args: object or JSON text
  async function run(name, args) {
    const list = await tools();
    const t = list.find((x) => x.name === name);
    if (!t) return JSON.stringify({ error: `Unknown MCP tool ${name}` });
    const s = live.get(t.server);
    try {
      const input = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {});
      const r = await rpc(s.conn, 'tools/call', { name: t.tool, arguments: input });
      const text = (r?.content || []).map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : JSON.stringify(c))).join('\n') || JSON.stringify(r?.structuredContent ?? r ?? {});
      const out = r?.isError ? `Tool error: ${text}` : text;
      return out.length > MAX_RESULT ? `${out.slice(0, MAX_RESULT)}... [cut: ask for less]` : out;
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  }

  // Settings "Test": connects one server once and lists its tools
  async function test(cfg) {
    const s = await connect(cleanServer(cfg));
    s.conn.close();
    return { tools: s.tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 200) })) };
  }

  function status() {
    return [...live.values()].map((s) => ({ name: s.cfg.name, connected: !!s.conn && !s.conn.closed, tools: s.tools.length, error: s.error }));
  }

  function close() { for (const s of live.values()) s.conn?.close(); live.clear(); }
  process.once('exit', close); // never leave MCP server processes running after QuantBot quits

  return { tools, run, test, status, close, ensure };
}
