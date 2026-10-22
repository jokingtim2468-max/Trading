import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TRADOVATE_SERVERS } from '@/lib/accounts';
import Field from './Field';

const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });

// Server, plus (on a saved account) the Tradovate API login: with "Trade through Tradovate" on, orders from the
// chart and scripts go straight to the account. The login is kept encrypted on this PC.
export default function TradovateFields({ form, set, account = null }) {
  const [login, setLogin] = useState({ name: '', password: '', cid: '', sec: '' });
  const [msg, setMsg] = useState({ text: '', error: false });
  const go = async (fn) => { setMsg({ text: '', error: false }); try { setMsg({ text: await fn(), error: false }); } catch (e) { setMsg({ text: e.message, error: true }); } };
  return (
    <>
      <Field label="Tradovate server" hint="Prop-firm and evaluation accounts (Lucid included) run on Demo">
        <Select value={form.environment || 'demo'} onValueChange={(v) => set('environment', v)}>
          <SelectTrigger aria-label="Tradovate server"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRADOVATE_SERVERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {account?.id ? (
        <Field label="Trade through Tradovate" hint="Needs Tradovate API access (Application Settings > API Access: it gives the CID and secret). Stop / target moves aren't sent yet.">
          <div className="space-y-2" data-testid="tradovate-login">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary w-4 h-4" checked={!!form.tradovate_on} onChange={(e) => set('tradovate_on', e.target.checked)} data-testid="tradovate-on" />Send this account's trades to Tradovate</label>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Tradovate username" value={login.name} onChange={(e) => setLogin({ ...login, name: e.target.value })} aria-label="Tradovate username" />
              <Input type="password" placeholder="Password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} aria-label="Tradovate password" />
              <Input placeholder="API CID" value={login.cid} onChange={(e) => setLogin({ ...login, cid: e.target.value })} aria-label="Tradovate CID" />
              <Input type="password" placeholder="API secret" value={login.sec} onChange={(e) => setLogin({ ...login, sec: e.target.value })} aria-label="Tradovate secret" />
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => go(async () => { await post('/api/tradovate/login', { account_id: account.id, ...login }); return 'Login saved (encrypted on this PC)'; })}>Save login</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => go(async () => `Connected: ${(await post('/api/tradovate/test', { account_id: account.id })).account}`)}>Test</Button>
            </div>
            {msg.text && <p className={`text-xs ${msg.error ? 'text-destructive' : 'text-emerald-400'}`}>{msg.text}</p>}
          </div>
        </Field>
      ) : <p className="text-xs text-muted-foreground">Save the account first, then open it again to connect its Tradovate login.</p>}
    </>
  );
}
