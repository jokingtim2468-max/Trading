import { useEffect, useState } from 'react';
import { Plug, Trash2, FlaskConical } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';

const call = (body) => client.functions.invoke('mcpServers', body).then((r) => r.data);
const EMPTY = { name: '', transport: 'stdio', command: '', args: '', url: '', env: '' };
const toEnv = (text) => Object.fromEntries(String(text || '').split('\n').map((l) => l.split('=')).filter(([k, v]) => k?.trim() && v !== undefined).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const field = 'w-full h-9 rounded-md border border-border bg-background px-2 text-sm';

// Settings > MCP servers: tools the local model can call (Model Context Protocol). stdio servers are started by
// QuantBot (npx / uvx / node / python); HTTP servers are reached by URL. Their tools join the chat's own tools.
export default function McpServersCard() {
  const [servers, setServers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { call({ action: 'list' }).then((r) => setServers(r.servers)).catch((e) => setMsg(e.message)); }, []);

  const server = () => ({ name: form.name, transport: form.transport, command: form.command, args: form.args, url: form.url, env: toEnv(form.env) });
  const run = async (fn) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg(e.message); } setBusy(false); };
  const test = () => run(async () => { const r = await call({ action: 'test', server: server() }); setMsg(`Connected: ${r.tools.length} tool${r.tools.length === 1 ? '' : 's'} (${r.tools.slice(0, 8).map((t) => t.name).join(', ')}${r.tools.length > 8 ? '…' : ''})`); });
  const save = () => run(async () => { const r = await call({ action: 'save', server: server() }); setServers(r.servers); setForm(EMPTY); setMsg('Saved. Its tools are now in the chat (/tools to turn any off).'); });
  const remove = (name) => run(async () => { const r = await call({ action: 'remove', name }); setServers(r.servers); });
  const toggle = (s) => run(async () => { const r = await call({ action: 'save', server: { ...s, enabled: !s.enabled } }); setServers(r.servers); });

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4" data-testid="mcp-card">
      <div className="flex items-center gap-2">
        <Plug className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">MCP servers</h3>
        <span className="text-xs text-muted-foreground">Tools for the local model: run code, files, docs, data</span>
      </div>
      {servers.length > 0 && (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.name} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${s.status?.connected ? 'bg-emerald-500' : s.status?.error ? 'bg-destructive' : 'bg-muted-foreground'}`} />
              <b className="shrink-0">{s.name}</b>
              <span className="text-xs text-muted-foreground truncate">{s.transport === 'http' ? s.url : `${s.command} ${(s.args || []).join(' ')}`}</span>
              <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">{s.status?.connected ? `${s.status.tools} tool${s.status.tools === 1 ? '' : 's'}` : s.status?.error || (s.enabled ? 'not started' : 'off')}</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(s)}>{s.enabled ? 'Turn off' : 'Turn on'}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(s.name)} aria-label={`Remove ${s.name}`}><Trash2 className="w-4 h-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Name</span>
          <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="python" data-testid="mcp-name" /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Type</span>
          <select className={field} value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
            <option value="stdio">Local command (stdio)</option><option value="http">URL (HTTP)</option>
          </select></label>
        {form.transport === 'stdio' ? (
          <>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Command</span>
              <input className={field} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx" data-testid="mcp-command" /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Arguments</span>
              <input className={field} value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="-y @modelcontextprotocol/server-filesystem C:/Users/you/gold-bot" data-testid="mcp-args" /></label>
            <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Environment variables (one NAME=value per line, optional)</span>
              <textarea className={`${field} h-16 py-1`} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} /></label>
          </>
        ) : (
          <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">URL</span>
            <input className={field} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:8000/mcp" /></label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy || !form.name} onClick={test}><FlaskConical className="w-4 h-4 mr-1" />Test</Button>
        <Button size="sm" disabled={busy || !form.name} onClick={save} data-testid="mcp-save">Save</Button>
        {msg && <span className="text-xs text-muted-foreground" data-testid="mcp-msg">{msg}</span>}
      </div>
      <p className="text-xs text-muted-foreground">Keep the list short: a 7B model with 32k context picks tools best when it sees about 5-15 of them. Turn off tools you don't need with /tools in the chat.</p>
    </div>
  );
}
