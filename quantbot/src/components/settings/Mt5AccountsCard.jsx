import { useCallback, useEffect, useState } from 'react';
import { Plus, Upload, KeyRound } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { logSetup } from '@/lib/copy';

const BLANK = { broker_name: '', account_number: '', password: '', server: '', capital: '', terminal_path: '' };
const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
};
const STATE = {
  connected: ['Connected', 'text-emerald-400 border-emerald-500/40'], connecting: ['Logging in', 'text-chart-4 border-chart-4/40'],
  error: ['Error', 'text-red-400 border-red-500/40'], stopped: ['Stopped', 'text-muted-foreground border-border'],
};
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function F({ label, children }) {
  return <div className="space-y-1 min-w-0"><Label className="text-xs">{label}</Label>{children}</div>;
}

// Multi-broker MT5 accounts the daemon keeps logged in: add one, paste many, and see each one's live state
export default function Mt5AccountsCard() {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({});
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setAccounts((await client.entities.TradingAccount.filter({ platform: 'MT5' }, { sort: 'created_date', limit: 500 })).items);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const add = async (body) => {
    setBusy(true);
    setResults(null);
    try {
      const { results: r } = await post('/api/mt5/accounts', body);
      setResults(r);
      const ok = r.filter((x) => x.action !== 'error');
      if (ok.length) await logSetup(`MT5 accounts: ${ok.filter((x) => x.action === 'added').length} added, ${ok.filter((x) => x.action === 'updated').length} updated for the daemon`);
      if (body.bulk != null && !r.some((x) => x.action === 'error')) setBulk('');
      if (body.accounts && ok.length) setForm(BLANK);
      await load();
    } catch (e) { setResults([{ action: 'error', error: e.message }]); }
    setBusy(false);
  };
  const toggle = async (a) => {
    await client.entities.TradingAccount.update(a.id, { enabled: a.enabled === false });
    await logSetup(`${a.label}: daemon auto-login ${a.enabled === false ? 'on' : 'off'}`, { account_id: a.id });
    load();
  };
  const savePw = async (a) => {
    await post('/api/mt5/password', { id: a.id, password: pw[a.id] });
    setPw((p) => ({ ...p, [a.id]: undefined }));
    await logSetup(`${a.label}: MT5 password changed`, { account_id: a.id });
    load();
  };
  const formOk = form.broker_name.trim() && /^\d{3,15}$/.test(form.account_number) && form.password && form.server.trim();

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4" data-testid="mt5-accounts">
      <div>
        <h3 className="font-medium">Multi-broker MT5 accounts</h3>
        <p className="text-xs text-muted-foreground">Any MT5 broker or prop firm (FTMO, FundedNext, FOREX.com...). The daemon keeps every enabled account logged in. Passwords are encrypted (AES-256-GCM) on this PC and only handed to the daemon here.</p>
      </div>
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); add({ accounts: [form] }); }} aria-label="Add MT5 account">
        <F label="Broker / prop firm"><Input value={form.broker_name} onChange={(e) => set('broker_name', e.target.value)} placeholder="FTMO / FundedNext / FOREX.com" aria-label="Broker" /></F>
        <F label="Account number"><Input inputMode="numeric" value={form.account_number} onChange={(e) => set('account_number', e.target.value.replace(/\D/g, ''))} placeholder="12345678" aria-label="Account number" /></F>
        <F label="Password"><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Password" aria-label="Password" /></F>
        <F label="MT5 server"><Input value={form.server} onChange={(e) => set('server', e.target.value)} placeholder="FTMO-Server" aria-label="MT5 server" /></F>
        <F label="Capital"><Input type="number" min={0} value={form.capital} onChange={(e) => set('capital', e.target.value)} placeholder="100000" aria-label="Capital" /></F>
        <F label="Terminal (terminal64.exe)"><Input value={form.terminal_path} onChange={(e) => set('terminal_path', e.target.value)} placeholder="C:\MT5\FTMO1\terminal64.exe" aria-label="Terminal path" /></F>
        <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!formOk || busy}><Plus className="w-3.5 h-3.5 mr-1" />Add account to daemon</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowBulk((v) => !v)}><Upload className="w-3.5 h-3.5 mr-1" />Add many at once</Button>
          <span className="text-[11px] text-muted-foreground">The same number on the same server updates that account.</span>
        </div>
      </form>
      {showBulk && (
        <div className="space-y-2">
          <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} className="font-mono text-xs" aria-label="Accounts, one per line"
            placeholder={'broker, account number, password, server, capital, terminal path\nFTMO, 5100901, ••••••, FTMO-Server, 100000, C:\\MT5\\FTMO1\\terminal64.exe\nFundedNext, 7001234, ••••••, FundedNext-Server, 50000, C:\\MT5\\FN1\\terminal64.exe'} />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!bulk.trim() || busy} onClick={() => add({ bulk })}>Add these accounts</Button>
            <span className="text-[11px] text-muted-foreground">One per line, comma, semicolon or tab separated; capital and terminal path optional. Paste from a spreadsheet works.</span>
          </div>
        </div>
      )}
      {results && (
        <ul className="text-xs space-y-0.5" data-testid="mt5-add-results">
          {results.map((r, k) => (
            <li key={k} className={r.action === 'error' ? 'text-red-400' : 'text-emerald-400'}>
              {r.line ? `Line ${r.line}: ` : ''}{r.action === 'error' ? r.error : `${r.action} ${r.account?.label}`}
            </li>
          ))}
        </ul>
      )}
      {accounts.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="text-[11px] text-muted-foreground text-left">
              <tr><th className="font-normal px-3 py-1.5">Account</th><th className="font-normal px-2">Daemon</th><th className="font-normal px-2 text-right">Balance / equity</th><th className="font-normal px-2">Auto-login</th><th className="font-normal px-3">Password</th></tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const [label, cls] = !a.has_password ? ['Needs its password', 'text-chart-4 border-chart-4/40'] : a.enabled === false ? ['Auto-login off', 'text-muted-foreground border-border']
                  : STATE[a.daemon_state] || ['Waiting for the daemon', 'text-muted-foreground border-border'];
                const stale = a.daemon_seen_at && Date.now() - Date.parse(a.daemon_seen_at) > 120000;
                return (
                  <tr key={a.id} className="border-t border-border/50 align-top" data-mt5={a.login}>
                    <td className="px-3 py-1.5"><span className="font-medium">{a.firm || 'MT5'} {a.login}</span>{a.capital ? <span className="text-muted-foreground"> · ${Number(a.capital).toLocaleString('en-US')}</span> : ''}
                      <div className="text-[10px] text-muted-foreground truncate max-w-[220px]" title={`${a.server} · ${a.terminal_path || ''}`}>{a.server} · {a.terminal_path || 'default MT5 terminal'}</div></td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${stale && a.has_password ? 'text-muted-foreground border-border' : cls}`} data-testid="daemon-state">{stale && a.has_password && a.enabled !== false ? `Last seen ${ago(a.daemon_seen_at)}` : label}</span>
                      {a.algo_trading === false && a.daemon_state === 'connected' && <div className="text-[10px] text-chart-4 mt-0.5">Algo Trading is off in this terminal</div>}
                      {a.daemon_error && a.daemon_state === 'error' && <div className="text-[10px] text-red-400 mt-0.5 max-w-[260px] whitespace-normal">{a.daemon_error}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.broker_balance != null ? `${a.broker_balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${Number(a.broker_equity ?? a.broker_balance).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${a.broker_currency || ''}` : '-'}</td>
                    <td className="px-2 py-1.5"><Switch checked={a.enabled !== false} onCheckedChange={() => toggle(a)} aria-label={`Auto-login ${a.login}`} /></td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <Input type="password" autoComplete="new-password" value={pw[a.id] || ''} onChange={(e) => setPw((p) => ({ ...p, [a.id]: e.target.value }))} placeholder={a.has_password ? 'Saved' : 'Needed'} aria-label={`Password for ${a.login}`} className="h-7 w-24 text-xs" />
                        <Button size="sm" variant="outline" className="h-7 px-2" disabled={!pw[a.id]} onClick={() => savePw(a)} aria-label={`Save password for ${a.login}`}><KeyRound className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
