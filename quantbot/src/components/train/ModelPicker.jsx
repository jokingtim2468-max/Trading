import { useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const get = (p) => fetch(p).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
const TABS = [['recommended', 'Recommended'], ['hf', 'Hugging Face'], ['local', 'Folder on this PC']];
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// What a Hugging Face model or local folder holds, and whether it fits this GPU
function ModelInfo({ info, gpu }) {
  if (!info) return null;
  const vram = info.suggested_method === 'qlora' || info.prequant ? info.vram_4bit : info.vram_16bit;
  return (
    <div className="rounded-xl border border-border p-3 text-xs space-y-1 animate-in fade-in-0 slide-in-from-top-1 duration-pop calm:animate-none" data-testid="train-model-info">
      <div className="font-medium text-sm break-all">{info.id}</div>
      <div className="text-muted-foreground">
        {info.params ? `${info.params.toFixed(1)}B parameters` : 'Size unknown'}{info.pipeline ? ` · ${info.pipeline}` : ''}{info.gated ? ' · gated (needs your token)' : ''}
      </div>
      <div className="text-muted-foreground">Files: {info.format_labels.length ? info.format_labels.join(', ') : 'no model weights found'}</div>
      {info.trainable ? (
        <div className={info.fits ? 'text-emerald-400' : 'text-amber-400'}>
          Trainable · {info.prequant ? 'already 4-bit' : info.suggested_method === 'qlora' ? '4-bit (QLoRA) suggested' : '16-bit LoRA suggested'}
          {vram ? ` · about ${vram} GB GPU memory` : ''}{!info.fits && gpu ? ` · more than your ${gpu} GB GPU: pick a smaller model` : ''}
        </div>
      ) : <div className="text-destructive">{info.why_not}</div>}
    </div>
  );
}

export default function ModelPicker({ c, set, status }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const gpu = status.gpu?.memory_gb;

  // Search Hugging Face as you type (debounced)
  useEffect(() => {
    if (c.model_source !== 'hf' || q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => get(`/api/train/hf/search?q=${encodeURIComponent(q)}`).then((r) => setResults(r.models)).catch((e) => setError(e.message)), 350);
    return () => clearTimeout(t);
  }, [q, c.model_source]);
  // Check the chosen model or folder
  useEffect(() => {
    setInfo(null); setError('');
    const target = c.model_source === 'hf' ? c.hf_model : c.model_source === 'local' ? c.local_model : '';
    if (!target) return undefined;
    const t = setTimeout(() => get(c.model_source === 'hf' ? `/api/train/hf/model?id=${encodeURIComponent(target)}` : `/api/train/local?path=${encodeURIComponent(target)}`)
      .then(setInfo).catch((e) => setError(e.message)), 400);
    return () => clearTimeout(t);
  }, [c.model_source, c.hf_model, c.local_model]);

  const rec = status.models.find((m) => m.id === c.model);
  return (
    <div className="space-y-3 sm:col-span-2" data-testid="train-model-picker">
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => set('model_source', id)} data-testid={`train-tab-${id}`}
            className={`px-3 py-1 rounded-md text-xs transition-colors ${c.model_source === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {c.model_source === 'recommended' && (
        <div className="grid sm:grid-cols-2 gap-2" data-testid="train-recommended">
          {status.models.map((m) => {
            const fits = !gpu || m.vram <= gpu - 0.3;
            return (
              <button key={m.id} type="button" onClick={() => set('model', m.id)} data-testid={`train-rec-${m.id}`}
                className={`text-left rounded-xl border p-3 transition-colors ${c.model === m.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {m.id === status.defaults.model && <Star className="w-3.5 h-3.5 text-primary" />}{m.name}
                  <span className={`ml-auto text-[10px] rounded-full border px-1.5 py-0.5 ${fits ? 'border-border text-muted-foreground' : 'border-amber-500/40 text-amber-400'}`}>{m.tag} · ~{m.vram} GB</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">{m.note}</div>
                <div className="text-[10px] text-muted-foreground/80 mt-1 font-mono break-all">{m.hf}</div>
              </button>
            );
          })}
          {rec && gpu && rec.vram > gpu - 0.3 && <p className="text-[11px] text-amber-400 sm:col-span-2">{rec.name} needs about {rec.vram} GB; your GPU has {gpu} GB.</p>}
        </div>
      )}
      {c.model_source === 'hf' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Hugging Face, e.g. qwen 4b, llama 3.2, phi-4" className="pl-8" data-testid="train-hf-search" />
          </div>
          {results.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-xl border border-border divide-y divide-border">
              {results.map((m) => (
                <button key={m.id} type="button" onClick={() => { set('hf_model', m.id); setResults([]); setQ(''); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" data-testid="train-hf-result">
                  <span className="font-mono break-all">{m.id}</span>
                  <span className="ml-auto text-muted-foreground whitespace-nowrap">{m.gguf ? 'GGUF · ' : ''}{m.gated ? 'gated · ' : ''}{fmt(m.downloads)} downloads</span>
                </button>
              ))}
            </div>
          )}
          <Input value={c.hf_model} onChange={(e) => set('hf_model', e.target.value.trim())} placeholder="or type owner/name, e.g. unsloth/Qwen3.5-2B" data-testid="train-hf-model" />
        </div>
      )}
      {c.model_source === 'local' && (
        <Input value={c.local_model} onChange={(e) => set('local_model', e.target.value)} placeholder="C:\models\Qwen3.5-2B (a folder with config.json and .safetensors or .bin weights)" data-testid="train-local-model" />
      )}
      {c.model_source !== 'recommended' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Method</span>
          <Select value={c.method} onValueChange={(v) => set('method', v)}>
            <SelectTrigger className="w-64" data-testid="train-method"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (16-bit if it fits, else 4-bit)</SelectItem>
              <SelectItem value="lora">LoRA, 16-bit (best quality)</SelectItem>
              <SelectItem value="qlora">QLoRA, 4-bit (least memory)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <ModelInfo info={info} gpu={gpu} />
      {error && <p className="text-xs text-destructive" data-testid="train-model-error">{error}</p>}
    </div>
  );
}
