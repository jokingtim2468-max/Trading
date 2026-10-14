import { useEffect, useState } from 'react';
import { Cpu, Loader2 } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ChartLoader from '@/components/quant/ChartLoader';

const DEFAULT_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5-coder:7b';
const local = async (payload) => (await client.functions.invoke('localModel', payload)).data;

// A free model on this PC through Ollama. Pick "Local model (Ollama)" in the chat or testers to use it.
export default function LocalModelCard() {
  const [form, setForm] = useState(null);
  const [installed, setInstalled] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ text: '', error: false });

  useEffect(() => {
    client.auth.me().then((me) => setForm({ url: me.ollama_url || DEFAULT_URL, model: me.ollama_model || DEFAULT_MODEL, saved: me.ollama_model || '' }));
  }, []);

  const run = async (kind, fn) => {
    setBusy(kind);
    setMessage({ text: '', error: false });
    try { await fn(); } catch (e) { setMessage({ text: e.response?.data?.error || e.message, error: true }); }
    setBusy('');
  };

  const test = () => run('test', async () => {
    const { models } = await local({ action: 'test', url: form.url });
    setInstalled(models);
    setMessage({ text: models.length ? `Connected. Installed: ${models.join(', ')}` : 'Connected, but no models are installed yet.', error: false });
  });

  const save = () => run('save', async () => {
    const me = await local({ action: 'save', url: form.url, model: form.model });
    setForm((f) => ({ ...f, url: me.ollama_url, saved: me.ollama_model }));
    setMessage({ text: me.ollama_model ? 'Saved. Pick "Local model (Ollama)" in the chat or testers.' : 'Local model turned off.', error: false });
  });

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" />Local model (Ollama)</h3>
          <p className="text-xs text-muted-foreground">
            Free and offline, on your own graphics card. A 7B coding model fits an 8 GB GPU; expect weaker MQL5 than Claude and more fix rounds.
            Install from ollama.com, then run <code>ollama pull {DEFAULT_MODEL}</code>.
          </p>
        </div>
        {form?.saved && <span className="text-xs text-primary bg-primary/10 border border-primary/30 rounded-full px-2.5 py-1 shrink-0">On · {form.saved}</span>}
      </div>
      {!form ? <ChartLoader className="w-10 h-6" /> : (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input aria-label="Ollama address" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={DEFAULT_URL} />
            <Input aria-label="Local model name" list="ollama-models" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={DEFAULT_MODEL} />
            <datalist id="ollama-models">{(installed || []).map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={test} disabled={!!busy}>{busy === 'test' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Test connection</Button>
            <Button size="sm" onClick={save} disabled={!!busy}>{busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save</Button>
          </div>
          {message.text && <p className={`text-xs ${message.error ? 'text-destructive' : 'text-muted-foreground'}`}>{message.text}</p>}
        </>
      )}
    </div>
  );
}
