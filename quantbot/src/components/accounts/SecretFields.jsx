import { Input } from '@/components/ui/input';
import Field from './Field';

// Passwords and API secrets go straight to the desktop app, which encrypts them on this PC
export default function SecretFields({ platform, secret, setSecret, saved, disabled }) {
  const input = (key, label, type = 'password') => (
    <Field key={key} label={label}>
      <Input type={type} value={secret[key]} onChange={(e) => setSecret(key, e.target.value)} disabled={disabled} placeholder={saved ? '••••••••' : ''} autoComplete="off" />
    </Field>
  );
  const hint = disabled
    ? 'Entered in the QuantBot desktop app and never leaves that PC.'
    : saved ? 'Saved encrypted on this PC. Type to replace.' : 'Saved encrypted on this PC only.';
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      {input('password', 'Password')}
      {platform === 'Tradovate' && input('cid', 'API key ID (cid)', 'text')}
      {platform === 'Tradovate' && input('sec', 'API secret')}
      <p className="text-[11px] text-muted-foreground">
        {hint}{platform === 'Tradovate' && ' API keys come from Tradovate\'s API Access settings (needs their API add-on).'}
      </p>
    </div>
  );
}