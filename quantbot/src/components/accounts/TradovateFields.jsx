import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TRADOVATE_SERVERS } from '@/lib/accounts';
import Field from './Field';

export default function TradovateFields({ form, set }) {
  return (
    <Field label="Tradovate server" hint="Prop-firm and evaluation accounts (Lucid included) run on Demo">
      <Select value={form.environment || 'demo'} onValueChange={(v) => set('environment', v)}>
        <SelectTrigger aria-label="Tradovate server"><SelectValue /></SelectTrigger>
        <SelectContent>
          {TRADOVATE_SERVERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}
