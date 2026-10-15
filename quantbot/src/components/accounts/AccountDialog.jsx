import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { client } from '@/api/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PLATFORMS, detectPlatform, familyOf } from '@/lib/accounts';
import Field from './Field';
import Mt5Fields from './Mt5Fields';
import TradovateFields from './TradovateFields';

const BLANK = { label: '', login: '', server: '', environment: 'demo', firm: '', copy_qty: 1 };

// Add or edit an account. The platform is detected from the account number / name; pick it by hand to override.
export default function AccountDialog({ account, servers, groups, onClose, onSaved }) {
  const [form, setForm] = useState({ ...BLANK, ...account });
  const [picked, setPicked] = useState(account?.platform || null); // chosen by hand
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const detected = detectPlatform(form);
  const platform = picked || detected?.platform || null;
  const isMt5 = platform === 'MT5';
  const missing = !form.label?.trim() || !form.login?.trim() || !platform || (isMt5 && !form.server?.trim());

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = {
        platform, label: form.label.trim(), login: form.login.trim(), copy_qty: Math.max(1, Number(form.copy_qty) || 1),
        firm: (form.firm || detected?.firm || '').trim(),
        ...(isMt5 ? { server: form.server.trim(), environment: '' } : { server: '', environment: form.environment || 'demo' }),
      };
      // An account can't stay in a group of the other family (MT5 vs futures)
      const group = groups.find((g) => g.id === account?.group_id);
      if (group && (group.platform === 'MT5' ? 'MT5' : 'Futures') !== familyOf(platform)) data.group_id = '';
      const { TradingAccount } = client.entities;
      if (account) await TradingAccount.update(account.id, data);
      else await TradingAccount.create({ ...data, group_id: '' });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${account.label}? Its journal trades stay.`)) return;
    setBusy(true);
    await client.entities.TradingAccount.delete(account.id);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'Add account'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Lucid 50K #1" /></Field>
          <Field label="Account number or name" hint="MT5: the login number. Tradovate / TradingView: the account name, e.g. LTT04821">
            <Input value={form.login} onChange={(e) => set('login', e.target.value)} placeholder="e.g. LTT04821 or 5100123" />
          </Field>
          <Field label="Platform">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Platform">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id} type="button" role="radio" aria-checked={platform === p.id} onClick={() => setPicked(p.id)}
                  className={`px-3 py-1.5 rounded-lg border text-sm ${platform === p.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
                >
                  {p.title}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1" data-testid="platform-hint">
              {!picked && detected ? <><Wand2 className="w-3 h-3 text-primary" />Detected {platformOfTitle(detected.platform)}: {detected.reason}. Trade it in TradingView? Pick TradingView.</>
                : !platform ? 'Type the account number or name and QuantBot picks the platform, or choose it here.'
                  : picked && detected && detected.platform !== picked && familyOf(detected.platform) !== familyOf(picked) ? `Set by hand (it looks like ${platformOfTitle(detected.platform)}).` : 'Set by hand.'}
            </p>
          </Field>
          {platform && (isMt5 ? <Mt5Fields form={form} set={set} servers={servers} /> : <TradovateFields form={form} set={set} />)}
          {platform && !isMt5 && (
            <Field label="Prop firm (optional)">
              <Input value={form.firm || detected?.firm || ''} onChange={(e) => set('firm', e.target.value)} placeholder="e.g. Lucid Trading" />
            </Field>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            {account && <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={remove} disabled={busy}>Remove</Button>}
            <Button type="submit" disabled={busy || missing}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const platformOfTitle = (id) => PLATFORMS.find((p) => p.id === id)?.title || id;
