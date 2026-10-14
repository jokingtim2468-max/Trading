import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TRADOVATE_SERVERS } from '@/lib/accounts';
import Field from './Field';

export default function TradovateFields({ form, set }) {
  return (
    <>
      <Field label="Tradovate username" hint="The login your TradingView futures account trades through">
        <Input value={form.login} onChange={(e) => set('login', e.target.value)} />
      </Field>
      <Field label="Server" hint="Prop-firm evaluation accounts usually run on Demo">
        <Select value={form.environment || 'demo'} onValueChange={(v) => set('environment', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRADOVATE_SERVERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Account name (optional)" hint="Leave empty to use the first account on this login">
        <Input value={form.account_spec} onChange={(e) => set('account_spec', e.target.value)} placeholder="e.g. LTT04821" />
      </Field>
    </>
  );
}