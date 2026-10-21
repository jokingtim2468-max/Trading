import { useEffect, useRef, useState } from 'react';
import { Cpu, Loader2, Sparkles, Download, Check } from 'lucide-react';
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
  const [specs, setSpecs] = useState(null); // { gpu, vram_gb, ram_gb, cpu, pick, on_cpu }
  const [pull, setPull] = useState(null); // { state, model, percent, status }
  const poll = useRef(null);

  useEffect(() => {
    client.auth.me().then((me) => setForm({ url: me.ollama_url || DEFAULT_URL, model: me.ollama_model || DEFAULT_MODEL, saved: me.ollama_model || '' }));
    return () => clearInterval(poll.current);
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

  const save = (modelName) => run('save', async () => {
    const me = await local({ action: 'save', url: form.url, model: modelName ?? form.model });
    setForm((f) => ({ ...f, model: me.ollama_model || f.model, url: me.ollama_url, saved: me.ollama_model }));
    setMessage({ text: me.ollama_model ? `Saved. "${me.ollama_model}" is your local model — pick "Local model (Ollama)" in the chat or testers.` : 'Local model turned off.', error: false });
  });

  // Look at this PC and recommend the model that fits it
  const recommend = () => run('recommend', async () => {
    const s = await local({ action: 'recommend' });
    setSpecs(s);
    setForm((f) => ({ ...f, model: s.pick.model }));
  });

  // One-click install of the recommended model, then poll Ollama's download progress and save it when done
  const install = (modelName) => {
    const name = modelName || specs?.pick.model || form.model;
    setMessage({ text: '', error: false });
    clearInterval(poll.current);
    local({ action: 'install', url: form.url, model: name }).then((p) => setPull(p)).catch((e) => setMessage({ text: e.response?.data?.error || e.message, error: true }));
    poll.current = setInterval(async () => {
      try {
        const p = await local({ action: 'pull_status' });
        setPull(p);
        if (p.state === 'done') { clearInterval(poll.current); await save(name); test(); }
        if (p.state === 'error') { clearInterval(poll.current); setMessage({ text: p.status, error: true }); }
      } catch { /* keep polling */ }
    }, 1200);
  };

  const pulling = pull && pull.state === 'running';

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" />Local model (Ollama)</h3>
          <p className="text-xs text-muted-foreground">
            Free and offline, on your own graphics card. Better at Pine and Python than MQL5, so expect a few fix rounds — the agent team handles that loop for you.
            Install Ollama from <a className="underline" href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com</a>, then let QuantBot pick and download the right model below.
          </p>
        </div>
        {form?.saved && <span className="text-xs text-primary bg-primary/10 border border-primary/30 rounded-full px-2.5 py-1 shrink-0">Using {form.saved}</span>}
      </div>

      {!form ? <ChartLoader className="w-10 h-6" /> : (
        <>
          {/* One-click: detect this PC and install the best-fitting model */}
          <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2" data-testid="model-setup">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-chart-4" />Set up a model for my PC</span>
              <Button size="sm" variant="outline" onClick={recommend} disabled={!!busy || pulling} data-testid="model-detect">
                {busy === 'recommend' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Check my specs
              </Button>
            </div>
            {specs && (
              <div className="text-xs text-muted-foreground space-y-1.5" data-testid="model-specs">
                <p>
                  {specs.gpu ? <><b className="text-foreground">{specs.gpu}</b> · {specs.vram_gb} GB VRAM</> : <b className="text-foreground">No NVIDIA GPU found</b>}
                  {' · '}{specs.cpu} ({specs.cores} cores) · {specs.ram_gb} GB RAM
                </p>
                <p>
                  Recommended: <b className="text-foreground">{specs.pick.label}</b> <code>{specs.pick.model}</code> (~{specs.pick.size_gb} GB). {specs.pick.note}
                  {specs.on_cpu && ' It will run on your CPU — slower, but it works.'}
                </p>
                <Button size="sm" onClick={() => install(specs.pick.model)} disabled={!!busy || pulling} data-testid="model-install">
                  {pulling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
                  Install {specs.pick.label}
                </Button>
              </div>
            )}
            {pull && pull.state !== 'idle' && (
              <div className="space-y-1" data-testid="model-progress">
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div className={`h-full ${pull.state === 'error' ? 'bg-destructive' : 'bg-primary'} transition-all`} style={{ width: `${pull.percent || 0}%` }} />
                </div>
                <p className={`text-[11px] ${pull.state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {pull.state === 'done' ? <span className="flex items-center gap-1 text-chart-2"><Check className="w-3 h-3" />{pull.model} installed and selected</span>
                    : pull.state === 'error' ? pull.status
                    : `Downloading ${pull.model}… ${pull.percent || 0}% (${pull.status})`}
                </p>
              </div>
            )}
          </div>

          {/* Manual: address, model name, test and save */}
          <div className="grid sm:grid-cols-2 gap-2">
            <Input aria-label="Ollama address" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={DEFAULT_URL} />
            <Input aria-label="Local model name" list="ollama-models" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={DEFAULT_MODEL} />
            <datalist id="ollama-models">{(installed || []).map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={test} disabled={!!busy}>{busy === 'test' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Test connection</Button>
            <Button size="sm" onClick={() => save()} disabled={!!busy}>{busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save</Button>
          </div>
          {message.text && <p className={`text-xs ${message.error ? 'text-destructive' : 'text-muted-foreground'}`}>{message.text}</p>}
        </>
      )}
    </div>
  );
}
