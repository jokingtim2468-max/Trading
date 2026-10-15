import { Input } from '@/components/ui/input';
import Field from './Field';

export default function Mt5Fields({ form, set, servers }) {
  return (
    <Field label="Server" hint="Exactly as your broker shows it, e.g. FTMO-Demo">
      <Input list="mt5-servers" value={form.server} onChange={(e) => set('server', e.target.value)} placeholder="e.g. FTMO-Demo" />
      <datalist id="mt5-servers">{servers.map((s) => <option key={s} value={s} />)}</datalist>
    </Field>
  );
}
