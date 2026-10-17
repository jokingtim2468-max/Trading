import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FIRMS, STAGE_LABELS } from '@/lib/copy';
import Field from './Field';

const money = (v) => `$${Number(v).toLocaleString('en-US')}`;

// Prop firm account: its stage (evaluation / FTMO Challenge / Verification / funded), and for funded accounts the
// payout split and automatic withdrawals on the firm's schedule
export default function PropFields({ form, plan, onStage, set, limitError }) {
  if (!plan.stages) return null;
  const firm = FIRMS[plan.firm] || {};
  const funded = form.stage === 'funded';
  return (
    <div className="space-y-3" data-testid="prop-fields">
      <Field label="Stage" hint={plan.firm === 'FTMO'
        ? `Challenge +10%, Verification +5%, then funded. Fails at a ${money(plan.dailyLoss)} daily loss (Prague day) or ${money(plan.maxLoss)} below the start.`
        : `Evaluation to +${money(plan.target)}, then funded. Lucid allows ${firm.maxFunded} funded accounts per person.`}>
        <Select value={form.stage || Object.keys(plan.stages)[0]} onValueChange={onStage}>
          <SelectTrigger aria-label="Stage"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.keys(plan.stages).map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {limitError && <p className="text-[11px] text-destructive" data-testid="firm-limit">{limitError}</p>}
      {funded && (
        <div className="rounded-lg border border-border/70 p-2.5 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!form.auto_withdraw} onCheckedChange={(v) => set('auto_withdraw', v)} aria-label="Withdraw automatically" />
            Withdraw profit automatically{firm.payoutDays ? ` every ${firm.payoutDays} days` : ''}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Your split %"><Input type="number" min={1} max={100} value={Math.round((Number(form.split) || firm.split || 0.8) * 100)} onChange={(e) => set('split', Number(e.target.value) / 100)} aria-label="Profit split" /></Field>
            <Field label="Every (days)"><Input type="number" min={1} value={form.payout_days || firm.payoutDays || 14} onChange={(e) => set('payout_days', Number(e.target.value))} aria-label="Payout days" /></Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            On schedule, when the account is flat and in profit, QuantBot takes the profit out, logs your share and starts the account
            again from its starting balance. {plan.firm === 'FTMO' ? "Then request that amount in FTMO's Client Area: FTMO has no API for payout requests, so the click is yours." : 'Then request it in the firm\'s dashboard.'}
          </p>
        </div>
      )}
    </div>
  );
}
