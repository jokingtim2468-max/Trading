import { Input } from '@/components/ui/input';
import Field from './Field';

export default function Mt5Fields({ form, set, servers, terminals }) {
  return (
    <>
      <Field label="Account number">
        <Input inputMode="numeric" value={form.login} onChange={(e) => set('login', e.target.value.replace(/\D/g, ''))} placeholder="12345678" />
      </Field>
      <Field label="Server" hint="Exactly as your broker shows it. Log in to it once in your normal MT5 so QuantBot can find it.">
        <Input list="mt5-servers" value={form.server} onChange={(e) => set('server', e.target.value)} placeholder="e.g. FTMO-Demo" />
        <datalist id="mt5-servers">{servers.map((s) => <option key={s} value={s} />)}</datalist>
      </Field>
      <Field label="MT5 terminal folder" hint={terminals.length ? 'QuantBot runs a private copy of this MT5 for the account' : 'The folder that contains terminal64.exe'}>
        <Input list="mt5-terminals" value={form.terminal_path} onChange={(e) => set('terminal_path', e.target.value)} placeholder="C:\Program Files\MetaTrader 5" />
        <datalist id="mt5-terminals">{terminals.map((t) => <option key={t.path} value={t.path}>{t.name}</option>)}</datalist>
      </Field>
      <Field label="Chart symbol" hint="Any symbol your broker lists. The copier runs on its chart.">
        <Input value={form.chart_symbol} onChange={(e) => set('chart_symbol', e.target.value)} />
      </Field>
    </>
  );
}