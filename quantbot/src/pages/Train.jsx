import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Play, Square, Trash2, Cpu, Container, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ChartLoader from '@/components/quant/ChartLoader';

const api = (p, body, method = 'POST') => fetch(p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });

// Status, runs, and polling while something is running
function useTrain() {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState(null);
  const load = useCallback(async () => {
    const [s, r] = await Promise.all([api('/api/train/status', undefined, 'GET'), api('/api/train/runs', undefined, 'GET')]);
    setStatus(s); setRuns(r.runs);
  }, []);
  const busy = runs?.some((r) => r.status === 'running') || status?.pulling?.state === 'running';
  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => { const t = setInterval(() => load().catch(() => {}), busy ? 2000 : 10000); return () => clearInterval(t); }, [load, busy]);
  return { status, runs, load };
}

const Check = ({ ok, children }) => (
  <div className="flex items-start gap-2 text-sm">
    {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
    <div>{children}</div>
  </div>
);

function SetupCard({ status, onPull }) {
  const pulling = status.pulling?.state === 'running';
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3" data-testid="train-setup">
      <div className="flex items-center gap-2"><Container className="w-4 h-4 text-primary" /><h3 className="font-medium">This PC</h3></div>
      <Check ok={status.docker}>
        {status.docker ? <>Docker {status.docker_version}</> : <>Docker isn&apos;t running. Install <a className="text-primary hover:underline" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">Docker Desktop</a> (it uses WSL 2 on Windows), start it, then reload this page.</>}
      </Check>
      <Check ok={!!status.gpu}>
        {status.gpu ? <>{status.gpu.name}, {status.gpu.memory_gb} GB</> : <>No NVIDIA GPU found. Install the latest NVIDIA driver (it includes WSL 2 GPU support).</>}
      </Check>
      <Check ok={status.image}>
        {status.image ? <>Unsloth image downloaded ({status.image_size_gb} GB)</> : <>Unsloth&apos;s image ({status.image_name}) isn&apos;t downloaded yet: about 10 GB, once.</>}
      </Check>
      {!status.image && status.docker && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onPull} disabled={pulling} data-testid="train-pull"><Download className="w-3.5 h-3.5 mr-1" />{pulling ? 'Downloading…' : 'Download Unsloth'}</Button>
          {status.pulling?.line && <span className="text-[11px] text-muted-foreground font-mono truncate max-w-md">{status.pulling.line}</span>}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Training runs in Unsloth&apos;s own Docker container on your GPU; models download once into a Docker volume (quantbot-hf-cache) and are reused.</p>
    </div>
  );
}

const Field = ({ label, children, hint }) => (
  <label className="block space-y-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
  </label>
);

function NewRunCard({ status, onStarted }) {
  const [c, setC] = useState(status.defaults);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [auto, setAuto] = useState(null);
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  useEffect(() => { api(`/api/train/auto?model=${c.model}`, undefined, 'GET').then(setAuto).catch(() => setAuto(null)); }, [c.model]);
  const model = status.models.find((m) => m.id === c.model);
  const tight = status.gpu && model && model.vram > status.gpu.memory_gb - 0.5;
  const ready = status.docker && status.image;
  const start = async () => {
    setError(''); setStarting(true);
    try { await api('/api/train/start', c); onStarted(); } catch (e) { setError(e.message); } finally { setStarting(false); }
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4" data-testid="train-new">
      <div className="flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" /><h3 className="font-medium">New training run</h3></div>
      <p className="text-xs text-muted-foreground">
        Teaches the model to predict each day&apos;s high and low (as % from the open) from the 10 days before it. It trains on one date range
        and is then tested on a later range it never saw, against a simple guess (open ± half the 20-day average range).
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Data">
          <Select value={c.source} onValueChange={(v) => set('source', v)}>
            <SelectTrigger data-testid="train-source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="builtin">Built-in XAUUSD (hourly, 2004 to today)</SelectItem>
              <SelectItem value="file">An MT5 export on this PC</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {c.source === 'file' ? (
          <Field label="MT5 export file" hint="Full path, e.g. C:\Users\you\Downloads\XAUUSD_M5_200406110715_202610152120.csv">
            <Input value={c.data_path} onChange={(e) => set('data_path', e.target.value)} placeholder="C:\…\XAUUSD_M5_….csv" data-testid="train-path" />
          </Field>
        ) : <div />}
        <Field label="Model">
          <Select value={c.model} onValueChange={(v) => set('model', v)}>
            <SelectTrigger data-testid="train-model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {status.models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}: ~{m.vram} GB</SelectItem>)}
            </SelectContent>
          </Select>
          <span className={`block text-[11px] ${tight ? 'text-amber-400' : 'text-muted-foreground'}`}>{model?.note}{tight ? ` Your GPU has ${status.gpu.memory_gb} GB: it may run out of memory.` : ''}</span>
        </Field>
        <div />
        <Field label="Train on">
          <div className="flex items-center gap-2">
            <Input type="date" value={c.train_from} onChange={(e) => set('train_from', e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={c.train_to} onChange={(e) => set('train_to', e.target.value)} />
          </div>
        </Field>
        <Field label="Test on (days it never saw)">
          <div className="flex items-center gap-2">
            <Input type="date" value={c.test_from} onChange={(e) => set('test_from', e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={c.test_to} onChange={(e) => set('test_to', e.target.value)} />
          </div>
        </Field>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-border p-3">
        <Switch checked={c.auto} onCheckedChange={(v) => set('auto', v)} data-testid="train-auto" />
        <div className="space-y-1">
          <div className="text-sm">Pick the training settings for my GPU</div>
          {c.auto && auto && (
            <div className="text-[11px] text-muted-foreground" data-testid="train-auto-why">
              {auto.why}. Batch {auto.settings.batch_size} × accumulation {auto.settings.grad_accum}, {auto.settings.epochs} epochs, learning rate {auto.settings.learning_rate}, LoRA rank {auto.settings.lora_r};
              {' '}sequence length is trimmed to the longest real example, and the batch halves by itself if the GPU runs out of memory.
            </div>
          )}
          {!c.auto && <button type="button" onClick={() => setMore((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${more ? 'rotate-180' : ''}`} />Training settings
          </button>}
        </div>
      </div>
      {!c.auto && more && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-in fade-in-0 slide-in-from-top-1 duration-pop calm:animate-none">
          <Field label="Epochs"><Input type="number" step="0.5" value={c.epochs} onChange={(e) => set('epochs', e.target.value)} /></Field>
          <Field label="Learning rate"><Input type="number" step="0.00005" value={c.learning_rate} onChange={(e) => set('learning_rate', e.target.value)} /></Field>
          <Field label="LoRA rank"><Input type="number" value={c.lora_r} onChange={(e) => set('lora_r', e.target.value)} /></Field>
          <Field label="Batch size" hint="Lower it if you run out of GPU memory"><Input type="number" value={c.batch_size} onChange={(e) => set('batch_size', e.target.value)} /></Field>
          <Field label="Gradient accumulation"><Input type="number" value={c.grad_accum} onChange={(e) => set('grad_accum', e.target.value)} /></Field>
          <Field label="Max sequence length"><Input type="number" step="64" value={c.max_seq_length} onChange={(e) => set('max_seq_length', e.target.value)} /></Field>
        </div>
      )}
      {error && <p className="text-xs text-destructive" data-testid="train-error">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button onClick={start} disabled={!ready || starting} data-testid="train-start"><Play className="w-3.5 h-3.5 mr-1" />{starting ? 'Starting…' : 'Start training'}</Button>
        {!ready && <span className="text-[11px] text-muted-foreground">Needs Docker and the Unsloth image (above).</span>}
      </div>
    </div>
  );
}

function LossChart({ losses }) {
  if (losses.length < 2) return null;
  const w = 320, h = 64, xs = losses.map((l) => l[0]), ys = losses.map((l) => l[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys) || 1;
  const pts = losses.map(([x, y]) => `${((x - x0) / (x1 - x0 || 1)) * w},${h - ((y - y0) / (y1 - y0 || 1)) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-sm h-16" aria-label="Training loss">
      <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const STATUS = { running: 'text-primary border-primary/40', done: 'text-emerald-400 border-emerald-500/40', error: 'text-destructive border-destructive/40', stopped: 'text-muted-foreground border-border' };

function Verdict({ r }) {
  if (r.model_error_pct == null) return <p className="text-xs text-destructive">The model&apos;s answers couldn&apos;t be read ({r.unreadable} of {r.days} days).</p>;
  const b = r.better_than_guess_pct;
  const text = b >= 15 ? 'Clearly better than the simple guess on unseen days.' : b > 3 ? 'A little better than the simple guess: backtest trades on it before using it live.' : 'No better than the simple guess: this model has no edge yet.';
  return <p className={`text-xs ${b >= 15 ? 'text-emerald-400' : b > 3 ? 'text-amber-400' : 'text-muted-foreground'}`}>{text}</p>;
}

function Recipe({ id, status }) {
  const [files, setFiles] = useState([]);
  useEffect(() => { api(`/api/train/runs/${id}/recipe`, undefined, 'GET').then((r) => setFiles(r.files)).catch(() => {}); }, [id, status]);
  if (!files.length) return null;
  return (
    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="train-recipe">
      <span>Unsloth Studio recipe (Upload the YAML on Studio&apos;s training page, then pick the dataset):</span>
      {files.map((f) => (
        <a key={f.name} href={`/api/train/runs/${id}/recipe/${encodeURIComponent(f.name)}`} download className="text-primary hover:underline inline-flex items-center gap-1">
          <Download className="w-3 h-3" />{f.name}
        </a>
      ))}
    </div>
  );
}

function RunCard({ run, models, onChange }) {
  const p = run.progress;
  const pct = p?.total ? Math.round((100 * p.step) / p.total) : 0;
  const r = run.result;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-pop calm:animate-none" data-testid="train-run">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{models.find((m) => m.id === run.config.model)?.name || run.config.model}</h3>
        <span className={`text-[11px] rounded-full border px-2 py-0.5 ${STATUS[run.status] || ''}`}>{run.status === 'running' ? run.phase : run.status}</span>
        <span className="text-[11px] text-muted-foreground">{new Date(run.started).toLocaleString()} · trains {run.config.train_from}–{run.config.train_to}, tests {run.config.test_from}–{run.config.test_to}</span>
        <div className="ml-auto flex gap-2">
          {run.status === 'running'
            ? <Button size="sm" variant="outline" onClick={() => api(`/api/train/runs/${run.id}/stop`, {}).then(onChange)}><Square className="w-3.5 h-3.5 mr-1" />Stop</Button>
            : <Button size="sm" variant="ghost" onClick={() => window.confirm('Delete this run and its trained adapter?') && api(`/api/train/runs/${run.id}`, undefined, 'DELETE').then(onChange)}><Trash2 className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>
      {run.status === 'running' && p && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-accent overflow-hidden"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
          <div className="text-[11px] text-muted-foreground">
            {p.phase === 'evaluate' ? `Testing: day ${p.step} of ${p.total}` : `Step ${p.step} of ${p.total} · loss ${p.loss} · epoch ${p.epoch}${p.vram_gb ? ` · ${p.vram_gb} GB GPU memory` : ''}`}
          </div>
        </div>
      )}
      <LossChart losses={run.losses} />
      {r && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[['Model error', r.model_error_pct != null ? `${r.model_error_pct.toFixed(3)}%` : '–'], ['Simple guess error', r.guess_error_pct != null ? `${r.guess_error_pct.toFixed(3)}%` : '–'],
              ['Better than guess', r.better_than_guess_pct != null ? `${r.better_than_guess_pct.toFixed(1)}%` : '–'], ['Test days', `${r.days - r.unreadable} / ${r.days}`]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border p-3"><div className="text-[11px] text-muted-foreground">{k}</div><div className="font-heading text-xl">{v}</div></div>
            ))}
          </div>
          <Verdict r={r} />
        </div>
      )}
      {run.error && <p className="text-xs text-destructive">{run.error}</p>}
      <Recipe id={run.id} status={run.status} />
      {run.messages.length > 0 && (
        <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">Log</summary>
          <div className="mt-1 font-mono space-y-0.5 max-h-40 overflow-auto">{run.messages.map((m, i) => <div key={i}>{m.message}</div>)}</div>
        </details>
      )}
    </div>
  );
}

export default function Train() {
  const { status, runs, load } = useTrain();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Train</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Fine-tune a small model on your market data with Unsloth, on this PC&apos;s GPU</span>
      </header>
      {!status || !runs ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
          <SetupCard status={status} onPull={() => api('/api/train/pull', {}).then(load)} />
          <NewRunCard status={status} onStarted={load} />
          {runs.map((r) => <RunCard key={r.id} run={r} models={status.models} onChange={load} />)}
        </div>
      )}
    </div>
  );
}
