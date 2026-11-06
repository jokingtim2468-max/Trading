// Detecting this PC's hardware and picking + installing the right local coding model for it.
// GPU VRAM via nvidia-smi; falls back to system RAM when there's no NVIDIA card. The model is pulled through
// Ollama's own HTTP API (POST /api/pull, streamed) so it uses the address already set in Settings and needs no
// `ollama` binary on PATH. One pull runs at a time; the UI polls { action: 'pull_status' } for progress.
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ollamaBase } from './ollama.js';

// Coding models by the VRAM they need (Q4). Each is a real Ollama tag that's good at code (Pine / Python; MQL5 is
// harder for any small model). Bigger = better; we pick the largest that fits with ~1.5 GB headroom for context.
const LADDER = [
  { min: 15, model: 'qwen2.5-coder:14b', size_gb: 9, label: 'Qwen2.5-Coder 14B', note: 'Best code quality; needs a 16 GB card.' },
  { min: 5.5, model: 'qwen2.5-coder:7b', size_gb: 4.7, label: 'Qwen2.5-Coder 7B', note: 'The sweet spot for an 8 GB GPU — strongest 7B coder.' },
  { min: 3.5, model: 'qwen2.5-coder:3b', size_gb: 2, label: 'Qwen2.5-Coder 3B', note: 'Fits a 4 GB card; weaker but usable with the fix loop.' },
  { min: 0, model: 'qwen2.5-coder:1.5b', size_gb: 1, label: 'Qwen2.5-Coder 1.5B', note: 'Runs on CPU / tiny GPUs; expect many fix rounds.' },
];

// The largest model that fits: by GPU VRAM when there's an NVIDIA card, else a CPU-sized guess from system RAM
export function pickModel({ vram_gb = null, ram_gb = 0 } = {}) {
  const budget = vram_gb != null ? vram_gb : (ram_gb >= 16 ? 5.5 : ram_gb >= 8 ? 3.5 : 0);
  return LADDER.find((m) => budget >= m.min) || LADDER[LADDER.length - 1];
}

function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(cmd, args, { windowsHide: true }); } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout?.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(t); resolve({ code: -1, out: '' }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.trim() }); });
  });
}

// { gpu, vram_gb, ram_gb, cpu, pick } — pick is the LADDER entry chosen for this PC
export async function detectSpecs() {
  const g = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  let gpu = null;
  let vram = null;
  if (g.code === 0 && g.out) {
    const [name, mem] = g.out.split('\n')[0].split(',').map((x) => x.trim());
    gpu = name || null;
    vram = Number(mem) ? Math.round(Number(mem) / 102.4) / 10 : null;
  }
  const ram = Math.round(os.totalmem() / 1.074e9 * 10) / 10;
  const cpu = (os.cpus()[0]?.model || 'Unknown CPU').replace(/\s+/g, ' ').trim();
  const cores = os.cpus().length;
  // Pick by VRAM; with no NVIDIA GPU a small model runs on CPU if there's enough RAM, else the smallest.
  const pick = pickModel({ vram_gb: vram, ram_gb: ram });
  return { gpu, vram_gb: vram, ram_gb: ram, cpu, cores, pick, on_cpu: vram == null };
}

let pulling = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ollamaUp(base) {
  try { return (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

// Where the Windows installer puts ollama.exe (it isn't on this process's PATH right after installing)
const winExe = () => (process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe` : null);

async function findOllama() {
  for (const cmd of ['ollama', winExe()].filter(Boolean)) if ((await run(cmd, ['--version'])).code === 0) return cmd;
  return null;
}

async function waitUp(base, ms) {
  for (let t = 0; t < ms; t += 1000) { if (await ollamaUp(base)) return true; await sleep(1000); }
  return false;
}

// Make sure Ollama answers before pulling: start it if it's installed but stopped, and on Windows install it with
// winget (Ollama's official package) if it's missing. A remote address is never touched, only reported.
export async function ensureOllama(base, say = () => {}) {
  if (await ollamaUp(base)) return;
  // Never install or launch programs from CI or the test suite
  if (process.env.CI || process.env.QUANTBOT_NO_AUTOSTART) throw new Error(`Ollama is not running at ${base} (auto-start is off here).`);
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(base);
  if (!local) throw new Error(`Ollama isn't answering at ${base}. Start it on that machine, or set the address to http://127.0.0.1:11434.`);
  let exe = await findOllama();
  if (!exe) {
    if (process.platform !== 'win32') throw new Error('Ollama is not installed. Install it with: curl -fsSL https://ollama.com/install.sh | sh  — then press Install again.');
    say('installing Ollama (winget)…');
    const w = await run('winget', ['install', '-e', '--id', 'Ollama.Ollama', '--silent', '--accept-package-agreements', '--accept-source-agreements'], 600000);
    exe = await findOllama();
    if (!exe) throw new Error(`Couldn't install Ollama automatically${w.code === -1 ? ' (winget not found)' : ''}. Install it from https://ollama.com/download, then press Install again.`);
  }
  if (await waitUp(base, 5000)) return; // the Windows installer starts Ollama by itself
  say('starting Ollama…');
  const p = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', () => {});
  p.unref();
  if (!(await waitUp(base, 30000))) throw new Error('Ollama is installed but did not start. Open the Ollama app once, then press Install again.');
}

// Start downloading a model through Ollama's HTTP API; progress is streamed and kept for pull_status to read.
export function startPull(url, model) {
  if (pulling?.state === 'running') return { ...pulling };
  const name = String(model || '').trim();
  if (!name) throw new Error('No model to install');
  pulling = { state: 'running', model: name, status: 'starting…', percent: 0, started: Date.now() };
  (async () => {
    try {
      await ensureOllama(ollamaBase(url), (msg) => { pulling.status = msg; });
      pulling.status = 'downloading…';
      const res = await fetch(`${ollamaBase(url)}/api/pull`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: name, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}. Is it installed and running? Get it from ollama.com.`);
      let buf = '';
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let j;
          try { j = JSON.parse(line); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.status) pulling.status = j.status;
          if (j.total) pulling.percent = Math.min(100, Math.round((Number(j.completed || 0) / Number(j.total)) * 100));
          if (j.status === 'success') pulling.percent = 100;
        }
      }
      pulling.state = 'done';
      pulling.percent = 100;
      pulling.status = 'installed';
    } catch (e) {
      const msg = e.message === 'fetch failed' ? `Lost the connection to Ollama while downloading ${name}. Press Install again to resume.` : e.message;
      pulling = { state: 'error', model: name, status: msg, percent: pulling?.percent || 0 };
    }
  })();
  return { ...pulling };
}

export const pullStatus = () => (pulling ? { ...pulling } : { state: 'idle' });

// Import a fine-tuned GGUF (e.g. the RunPod training output) as an Ollama model with QuantBot's settings: 32k context,
// low temperature, and the Qwen2.5 chat template (copied from the installed base model, so tool calls keep working).
export async function importGguf(url, file, name = 'quant-coder') {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const gguf = String(file || '').trim().replace(/^"|"$/g, '');
  if (!/\.gguf$/i.test(gguf)) throw new Error('Pick the .gguf file from the training output (out/gguf/...Q4_K_M.gguf)');
  if (!fs.existsSync(gguf)) throw new Error(`No file at ${gguf}`);
  const model = String(name || '').trim().toLowerCase().replace(/[^a-z0-9._:-]/g, '-') || 'quant-coder';
  const base = ollamaBase(url);
  await ensureOllama(base);
  let template = '';
  try {
    const r = await fetch(`${base}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'qwen2.5-coder:7b' }) });
    if (r.ok) template = (await r.json()).template || '';
  } catch { /* base model not installed: Ollama reads the template from the GGUF */ }
  const mf = [`FROM ${JSON.stringify(gguf)}`, 'PARAMETER num_ctx 32768', 'PARAMETER temperature 0.2',
    ...(template ? [`TEMPLATE """${template}"""`] : [])].join('\n');
  const mfPath = path.join(path.dirname(gguf), 'Modelfile.quantbot');
  fs.writeFileSync(mfPath, mf);
  const exe = (await findOllama()) || 'ollama';
  const res = await new Promise((resolve) => {
    let out = '';
    const p = spawn(exe, ['create', model, '-f', mfPath], { windowsHide: true });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
    p.on('close', (code) => resolve({ code, out }));
  });
  if (res.code !== 0) throw new Error(`ollama create failed: ${res.out.trim().split('\n').pop() || res.code}`);
  return { model, modelfile: mfPath, template_copied: !!template };
}

// How much of each loaded model sits on the graphics card (Ollama's /api/ps): { name, gpu_pct, size_gb } per model
export async function gpuFit(url) {
  try {
    const r = await fetch(`${ollamaBase(url)}/api/ps`, { signal: AbortSignal.timeout(2500) });
    const ps = await r.json();
    return (ps.models || []).map((m) => ({ name: m.name, size_gb: Math.round((m.size / 1e9) * 10) / 10, gpu_pct: m.size ? Math.round((100 * (m.size_vram || 0)) / m.size) : 0, context: m.context_length || null }));
  } catch { return []; }
}

// The settings that make a 7B model with 32k context fit an 8 GB card: flash attention and an 8-bit KV cache (half the
// memory of the default). Saved for the Windows user (setx) so the Ollama tray app gets them too, then Ollama restarts.
export const OLLAMA_GPU_ENV = { OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' };
export async function gpuEnvSaved() {
  if (process.platform !== 'win32') return Object.entries(OLLAMA_GPU_ENV).every(([k, v]) => process.env[k] === v);
  for (const [k, v] of Object.entries(OLLAMA_GPU_ENV)) {
    const r = await run('reg', ['query', 'HKCU\\Environment', '/v', k]);
    if (r.code !== 0 || !r.out.includes(v)) return false;
  }
  return true;
}
export async function tuneOllama(url) {
  const base = ollamaBase(url);
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(base);
  if (!local) throw new Error('Ollama runs on another machine: set OLLAMA_FLASH_ATTENTION=1 and OLLAMA_KV_CACHE_TYPE=q8_0 there and restart it.');
  if (process.platform === 'win32') {
    for (const [k, v] of Object.entries(OLLAMA_GPU_ENV)) await run('setx', [k, v]);
    await run('taskkill', ['/F', '/IM', 'ollama app.exe']);
    await run('taskkill', ['/F', '/IM', 'ollama.exe']);
    await sleep(1500);
  }
  Object.assign(process.env, OLLAMA_GPU_ENV);
  const exe = await findOllama();
  if (!exe) throw new Error('Ollama is not installed');
  if (process.platform === 'win32' || !(await ollamaUp(base))) {
    const p = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...OLLAMA_GPU_ENV } });
    p.on('error', () => {});
    p.unref();
  }
  if (!(await waitUp(base, 30000))) throw new Error('Ollama did not come back after the restart. Open the Ollama app.');
  return { restarted: true, env: OLLAMA_GPU_ENV };
}
