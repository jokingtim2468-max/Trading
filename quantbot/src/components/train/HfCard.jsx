import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const call = (method, body) => fetch('/api/train/hf', { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });

// Hugging Face account: the token (stored encrypted on this PC) for gated models and uploads
export default function HfCard({ onChange }) {
  const [acc, setAcc] = useState(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const load = () => fetch('/api/train/hf').then((r) => r.json()).then((a) => { setAcc(a); onChange?.(a); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    setError('');
    try { await call('POST', { token }); setToken(''); load(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3" data-testid="train-hf">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary" /><h3 className="font-medium">Hugging Face</h3>
        <span className={`text-[11px] rounded-full border px-2 py-0.5 ${acc?.connected ? 'border-emerald-500/40 text-emerald-400' : 'border-border text-muted-foreground'}`} data-testid="train-hf-status">
          {acc?.connected ? `Signed in as ${acc.user}` : acc?.saved ? 'Token saved but not working' : 'No token: public models only'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Public models need no account. A token lets you train gated models (Llama, Gemma: accept the license on the model&apos;s page first)
        and upload your trained model. Make one at <a className="text-primary hover:underline" href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">huggingface.co/settings/tokens</a> (&ldquo;Write&rdquo; to upload).
        It&apos;s stored encrypted on this PC and only handed to the training container.
      </p>
      {acc?.connected ? (
        <Button size="sm" variant="outline" onClick={() => call('DELETE').then(load)}>Remove token</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="hf_…" className="max-w-xs" data-testid="train-hf-token" />
          <Button size="sm" onClick={save} disabled={!token} data-testid="train-hf-save">Save token</Button>
        </div>
      )}
      {(error || acc?.error) && <p className="text-xs text-destructive">{error || acc.error}</p>}
    </div>
  );
}
