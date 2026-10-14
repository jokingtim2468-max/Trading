import { useState } from 'react';
import { client } from '@/api/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Field from './Field';
import Mt5Fields from './Mt5Fields';
import TradovateFields from './TradovateFields';
import SecretFields from './SecretFields';

const PICK = { MT5: ['label', 'login', 'server', 'terminal_path', 'chart_symbol'], Tradovate: ['label', 'login', 'environment', 'account_spec'] };
const BLANK = { label: '', login: '', server: '', chart_symbol: 'EURUSD', environment: 'demo', account_spec: '' };

export default function AccountDialog({ platform, account, copier, servers, onClose, onSaved }) {
  const isMt5 = platform === 'MT5';
  const { bridge } = copier;
  const [form, setForm] = useState({ ...BLANK, terminal_path: copier.terminals[0]?.path || '', ...account });
  const [secret, setSecret] = useState({ password: '', cid: '', sec: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const needsSecret = !!bridge && !account;
  const missing = !form.label?.trim() || !form.login?.trim() || (isMt5 && !form.server?.trim())
    || (needsSecret && (!secret.password || (!isMt5 && (!secret.cid || !secret.sec))));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = Object.fromEntries(PICK[platform].map((k) => [k, (form[k] || '').trim()]));
      const { TradingAccount } = client.entities;
      const id = account ? (await TradingAccount.update(account.id, data), account.id) : (await TradingAccount.create({ ...data, platform, group_id: '' })).id;
      if (bridge && (secret.password || secret.cid || secret.sec)) await bridge.invoke('saveSecret', id, secret);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${account.label}? Its saved password is deleted from this PC.`)) return;
    setBusy(true);
    if (bridge) await bridge.invoke('forget', account.id);
    await client.entities.TradingAccount.delete(account.id);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{account ? 'Edit' : 'Add'} {isMt5 ? 'MT5' : 'Tradovate'} account</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder={isMt5 ? 'e.g. FTMO 100K' : 'e.g. Lucid 50K #1'} /></Field>
          {isMt5 ? <Mt5Fields form={form} set={set} servers={servers} terminals={copier.terminals} /> : <TradovateFields form={form} set={set} />}
          <SecretFields platform={platform} secret={secret} setSecret={(k, v) => setSecret((s) => ({ ...s, [k]: v }))} saved={!!account && copier.secrets[account.id]} disabled={!bridge} />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <DialogFooter className="gap-2">
            {account && <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={remove} disabled={busy}>Remove</Button>}
            <Button type="submit" disabled={busy || missing}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}