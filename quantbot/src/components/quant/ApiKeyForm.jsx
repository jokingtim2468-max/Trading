import { useState } from 'react';
import { Eye, EyeOff, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { saveKey } from '@/lib/quantApi';
import { PROVIDERS } from '@/lib/models';

export default function ApiKeyForm({ provider, onSaved, buttonLabel = 'Save key' }) {
  const { short, prefix } = PROVIDERS[provider];
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const key = value.trim();
    if (!key.startsWith(prefix)) return setError(`${short} keys start with "${prefix}".`);
    setSaving(true);
    setError('');
    try {
      const status = await saveKey(provider, key);
      setValue('');
      onSaved(status);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the key.');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={`${prefix}...`}
            className="w-full h-10 rounded-lg bg-background border border-input pl-9 pr-10 text-sm font-mono outline-none focus:border-primary"
          />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <Button onClick={save} disabled={saving || !value.trim()} className="h-10">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : buttonLabel}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}