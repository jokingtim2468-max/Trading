import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODELS, DEFAULT_MODELS, PROVIDERS } from '@/lib/models';
import ChartLoader from '@/components/quant/ChartLoader';

const FIELDS = [
  { provider: 'anthropic', field: 'default_claude_model' },
  { provider: 'google', field: 'default_gemini_model' },
];

export default function DefaultModelsCard() {
  const [user, setUser] = useState(null);
  const [saved, setSaved] = useState('');

  useEffect(() => { client.auth.me().then(setUser); }, []);

  const change = async (field, value) => {
    setUser((u) => ({ ...u, [field]: value }));
    setSaved('');
    await client.auth.updateMe({ [field]: value });
    setSaved(field);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="font-medium">Tester & converter default model</h3>
        <p className="text-xs text-muted-foreground">Your Claude model is used when an Anthropic key is linked; your Gemini model when only a Google key is linked.</p>
      </div>
      {!user ? <ChartLoader className="w-10 h-6" /> : FIELDS.map(({ provider, field }) => (
        <div key={field} className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {PROVIDERS[provider].family} model
            {saved === field && <span className="text-xs text-primary ml-2">Saved</span>}
          </span>
          <Select value={user[field] || DEFAULT_MODELS[provider]} onValueChange={(v) => change(field, v)}>
            <SelectTrigger className="w-52 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.filter((m) => m.provider === provider).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}