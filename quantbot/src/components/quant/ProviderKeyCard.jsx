import { useState } from 'react';
import { ShieldCheck, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ApiKeyForm from './ApiKeyForm';
import ChartLoader from './ChartLoader';
import { removeKey } from '@/lib/quantApi';
import { PROVIDERS } from '@/lib/models';

export default function ProviderKeyCard({ provider, status, onChange }) {
  const [removing, setRemoving] = useState(false);
  const meta = PROVIDERS[provider];
  const s = status?.[provider];

  const remove = async () => {
    if (!window.confirm(`Remove your ${meta.short} API key?`)) return;
    setRemoving(true);
    onChange(await removeKey(provider));
    setRemoving(false);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">{meta.name}</h3>
          <p className="text-xs text-muted-foreground">Used when you pick a {meta.family} model in the chat or tester.</p>
        </div>
        {!s ? <ChartLoader className="w-10 h-6" /> : s.linked ? (
          <span className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 border border-primary/30 rounded-full px-2.5 py-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Linked ···· {s.last4}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground border border-border rounded-full px-2.5 py-1">Not linked</span>
        )}
      </div>
      {s && <ApiKeyForm provider={provider} onSaved={onChange} buttonLabel={s.linked ? 'Replace' : 'Save key'} />}
      {s?.linked && (
        <Button variant="outline" size="sm" onClick={remove} disabled={removing} className="bg-transparent text-destructive border-destructive/40 hover:text-destructive">
          {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove key
        </Button>
      )}
    </div>
  );
}