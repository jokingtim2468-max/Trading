import { useState } from 'react';
import { Wand2, Dices } from 'lucide-react';
import { client } from '@/api/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PLATFORMS, detectPlatform, familyOf } from '@/lib/accounts';
import { PLANS, planRisk, randomName, randomSeed, logSetup } from '@/lib/copy';
import RankAvatar from '@/components/copy/RankAvatar';
import Field from './Field';
import Mt5Fields from './Mt5Fields';
import TradovateFields from './TradovateFields';

const BLANK = { label: '', login: '', server: '', environment: 'demo', firm: '', copy_qty: 1, plan: 'lucid50', forward_url: '' };
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// Add or edit an account. The platform is detected from the account number / name; pick it by hand to override.
export default function AccountDialog({ account, servers, groups, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const f = { ...BLANK, ...account };
    if (!f.display_name) f.display_name = randomName();
    if (!f.avatar_seed) f.avatar_seed = randomSeed();
    if (!account) Object.assign(f, planFields('lucid50'));
    return f;
  });
  const [picked, setPicked] = useState(account?.platform || null); // chosen by hand
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const detected = detectPlatform(form);
  const platform = picked || detected?.platform || null;
  const isMt5 = platform === 'MT5';
  // TradingView accounts trade on paper here, so they need no login
  const missing = !form.label?.trim() || (!form.login?.trim() && platform !== 'TradingView') || !platform || (isMt5 && !form.server?.trim());
  const pickPlan = (id) => setForm((f) => ({ ...f, ...planFields(id) }));
  const plan = PLANS[form.plan] || PLANS.none;

  const save = async (e, startOver = false) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const start = num(form.start_balance) ?? plan.start;
      const data = {
        platform, label: form.label.trim(), login: (form.login || '').trim(), copy_qty: Math.max(1, Number(form.copy_qty) || 1),
        firm: (form.firm || detected?.firm || '').trim(),
        ...(isMt5 ? { server: form.server.trim(), environment: '' } : { server: '', environment: form.environment || 'demo' }),
        display_name: form.display_name.trim() || randomName(), avatar_seed: form.avatar_seed,
        plan: form.plan, start_balance: start, target: num(form.target), max_loss: num(form.max_loss), trailing: !!form.trailing,
        risk_usd: num(form.risk_usd), forward_url: (form.forward_url || '').trim(),
      };
      // A new account, a new plan or starting over begins again from the starting balance
      if (!account || startOver || account.plan !== data.plan || account.start_balance !== start) {
        Object.assign(data, { balance: start, peak_eod: start, floor: null, day_key: '', status: 'active' });
      }
      // An account can't stay in a group of the other family (MT5 vs futures)
      const group = groups.find((g) => g.id === account?.group_id);
      if (group && (group.platform === 'MT5' ? 'MT5' : 'Futures') !== familyOf(platform)) data.group_id = '';
      const { TradingAccount } = client.entities;
      const rules = `${PLANS[data.plan]?.label || data.plan}, start $${start.toLocaleString()}${data.risk_usd ? `, risk $${data.risk_usd}/trade` : ''}${data.forward_url ? ', order URL set' : ''}`;
      if (account) {
        await TradingAccount.update(account.id, data);
        const reset = data.balance != null ? `${startOver ? 'started over' : 'reset by new rules'} at $${start.toLocaleString()} (was $${Number(account.balance ?? start).toLocaleString()}, ${account.status || 'active'})` : '';
        const changed = ['plan', 'risk_usd', 'forward_url', 'target', 'max_loss'].filter((k) => (account[k] ?? null) !== (data[k] ?? null));
        if (reset || changed.length) await logSetup(`${data.display_name}: ${[reset, changed.length ? `changed ${changed.join(', ')} (${rules})` : ''].filter(Boolean).join('; ')}`, { account_id: account.id, group_id: account.group_id || '' }, { rules: data });
      } else {
        const made = await TradingAccount.create({ ...data, group_id: '' });
        await logSetup(`${data.display_name} added: ${data.label} on ${platform} (${rules})`, { account_id: made.id });
      }
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
    await logSetup(`${account.display_name || account.label} removed (balance $${Number(account.balance ?? 0).toLocaleString()}, ${account.status || 'active'})`, { account_id: account.id });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'Add account'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="flex items-center gap-3">
            <RankAvatar seed={form.avatar_seed} xp={form.xp || 0} size={56} label={form.display_name} />
            <div className="flex-1 space-y-1.5">
              <Field label="Trader name">
                <div className="flex gap-1.5">
                  <Input value={form.display_name} onChange={(e) => set('display_name', e.target.value)} aria-label="Trader name" />
                  <Button type="button" variant="outline" size="icon" aria-label="New random name" title="New random name and picture"
                    onClick={() => setForm((f) => ({ ...f, display_name: randomName(), avatar_seed: randomSeed() }))}><Dices className="w-4 h-4" /></Button>
                </div>
              </Field>
            </div>
          </div>
          <Field label="Name"><Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Lucid 50K #1" /></Field>
          <Field label="Account number or name" hint="MT5: the login number. Tradovate: the account name, e.g. LTT04821. Optional for TradingView.">
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
          {platform && (
            <div className="rounded-xl border border-border p-3 space-y-3">
              <p className="text-xs font-medium">Copy trading</p>
              <Field label="Account rules" hint={plan.target ? `Passes at +$${plan.target.toLocaleString()}, fails at -$${plan.maxLoss.toLocaleString()}${plan.trailing ? ' (trails the best end-of-day balance, locks at start + $100)' : ''}.` : 'No target or max loss: the account just tracks its trades.'}>
                <Select value={form.plan} onValueChange={pickPlan}>
                  <SelectTrigger aria-label="Account rules"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PLANS).map(([id, p]) => <SelectItem key={id} value={id}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {form.plan === 'custom' && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Start $"><Input type="number" value={form.start_balance ?? ''} onChange={(e) => set('start_balance', e.target.value)} aria-label="Starting balance" /></Field>
                  <Field label="Target $"><Input type="number" value={form.target ?? ''} onChange={(e) => set('target', e.target.value)} aria-label="Profit target" /></Field>
                  <Field label="Max loss $"><Input type="number" value={form.max_loss ?? ''} onChange={(e) => set('max_loss', e.target.value)} aria-label="Max loss" /></Field>
                </div>
              )}
              <Field label="Risk per trade ($)" hint="Each copied trade is sized so its stop loses about this much. Empty: the script's quantity x this account's Qty.">
                <Input type="number" min={0} value={form.risk_usd ?? ''} onChange={(e) => set('risk_usd', e.target.value)} aria-label="Risk per trade" placeholder="e.g. 300" />
              </Field>
              <Field label="Order URL (optional)" hint="Trades are copied on paper at the alert price. Add a TradersPost (or similar) webhook to place them on the real account too.">
                <Input value={form.forward_url || ''} onChange={(e) => set('forward_url', e.target.value)} aria-label="Order URL" placeholder="https://webhooks.traderspost.io/…" />
              </Field>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            {account && <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={remove} disabled={busy}>Remove</Button>}
            {account && account.balance != null && <Button type="button" variant="outline" disabled={busy || missing}
              onClick={() => window.confirm('Start this account over from its starting balance? Its rank stays.') && save(null, true)}>Start over</Button>}
            <Button type="submit" disabled={busy || missing}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const platformOfTitle = (id) => PLATFORMS.find((p) => p.id === id)?.title || id;

// Form fields for an account rules preset
function planFields(id) {
  const p = PLANS[id] || PLANS.none;
  return { plan: id, start_balance: p.start, target: p.target, max_loss: p.maxLoss, trailing: p.trailing, risk_usd: planRisk(p) };
}
