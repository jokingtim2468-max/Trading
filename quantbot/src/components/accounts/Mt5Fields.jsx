import { Input } from '@/components/ui/input';
import Field from './Field';

// MT5 login details: the server, plus the password and terminal the auto-login daemon uses (Settings > MT5 & deployment)
export default function Mt5Fields({ form, set, servers }) {
  return (
    <>
      <Field label="Server" hint="Exactly as your broker shows it, e.g. FTMO-Demo">
        <Input list="mt5-servers" value={form.server} onChange={(e) => set('server', e.target.value)} placeholder="e.g. FTMO-Demo" />
        <datalist id="mt5-servers">{servers.map((s) => <option key={s} value={s} />)}</datalist>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Password (optional)" hint="For the 24/7 auto-login daemon; stored encrypted.">
          <Input type="password" autoComplete="new-password" value={form.password || ''} onChange={(e) => set('password', e.target.value)} placeholder={form.has_password ? 'Saved' : 'MT5 password'} aria-label="MT5 password" />
        </Field>
        <Field label="Terminal (optional)" hint="This account's own terminal64.exe.">
          <Input value={form.terminal_path || ''} onChange={(e) => set('terminal_path', e.target.value)} placeholder="C:\MT5\FTMO1\terminal64.exe" aria-label="Terminal path" />
        </Field>
      </div>
    </>
  );
}
