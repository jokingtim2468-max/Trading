// Train page: fine-tunes a small open model with Unsloth inside Docker on this PC's NVIDIA GPU
// (train/unsloth/qb_train.py in Unsloth's own image). Each run is a folder under data/train/<id> holding config.json,
// the data file, events.jsonl (one JSON event per line from the script), the LoRA adapter and result.json.
// QUANTBOT_DOCKER points at another docker command (the tests use a fake one).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const IMAGE = 'unsloth/unsloth:core';
const HF_VOLUME = 'quantbot-hf-cache';
const SCRIPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'train', 'unsloth');
const KEEP_EVENTS = 400;

// Recommended for an 8 GB RTX 4060 (all checked on Hugging Face). vram: GB for LoRA training with short prompts.
export const MODELS = [
  { id: 'qwen3.5-2b', hf: 'unsloth/Qwen3.5-2B', name: 'Qwen3.5 2B', params: 2.3, four_bit: false, vram: 5, tag: 'Best fit', note: 'Newest Qwen, 16-bit LoRA (Unsloth advises against 4-bit for Qwen3.5): the default for an 8 GB card' },
  { id: 'qwen3.5-0.8b', hf: 'unsloth/Qwen3.5-0.8B', name: 'Qwen3.5 0.8B', params: 0.9, four_bit: false, vram: 3, tag: 'Quickest', note: 'Small and fast: good for a first test run' },
  { id: 'qwen3-1.7b-4bit', hf: 'unsloth/Qwen3-1.7B-unsloth-bnb-4bit', name: 'Qwen3 1.7B (4-bit)', params: 1.7, four_bit: true, vram: 3, tag: 'Light', note: 'Small Qwen3 in 4-bit: leaves room for big batches' },
  { id: 'llama3.2-3b-4bit', hf: 'unsloth/Llama-3.2-3B-Instruct-bnb-4bit', name: 'Llama 3.2 3B (4-bit)', params: 3.2, four_bit: true, vram: 5, tag: 'Good fit', note: "Meta's 3B instruct model in 4-bit" },
  { id: 'phi4-mini-4bit', hf: 'unsloth/Phi-4-mini-instruct-unsloth-bnb-4bit', name: 'Phi-4 mini 3.8B (4-bit)', params: 3.8, four_bit: true, vram: 6, tag: 'Good fit', note: "Microsoft's small model, strong at numbers and reasoning" },
  { id: 'qwen3-4b-4bit', hf: 'unsloth/Qwen3-4B-unsloth-bnb-4bit', name: 'Qwen3 4B (4-bit)', params: 4.0, four_bit: true, vram: 7.5, tag: 'Tight', note: 'The biggest that fits 8 GB: smaller batches' },
  { id: 'llama3.2-1b-4bit', hf: 'unsloth/Llama-3.2-1B-Instruct-bnb-4bit', name: 'Llama 3.2 1B (4-bit)', params: 1.2, four_bit: true, vram: 2.5, tag: 'Quickest', note: 'Tiny Llama: fastest runs' },
  { id: 'gemma3-1b-4bit', hf: 'unsloth/gemma-3-1b-it-unsloth-bnb-4bit', name: 'Gemma 3 1B (4-bit)', params: 1.0, four_bit: true, vram: 2.5, tag: 'Quickest', note: "Google's 1B text model" },
];
// GPU memory for LoRA training on short prompts: 4-bit weights ~0.75 GB per billion parameters, 16-bit ~2.1 GB, plus overhead
export const vramFor = (paramsB, fourBit) => Math.round(((fourBit ? 0.75 : 2.1) * paramsB + (fourBit ? 1.6 : 0.8)) * 10) / 10;
// Model file formats: which ones training can start from (Transformers weights) and which are run-only
export const FORMATS = {
  safetensors: { trainable: true, label: 'Safetensors' },
  bin: { trainable: true, label: 'PyTorch .bin' },
  pt: { trainable: false, label: 'PyTorch .pt/.pth checkpoint (needs the original Transformers repo)' },
  gguf: { trainable: false, label: 'GGUF (llama.cpp / Ollama: run-only, pick the original repo to train)' },
  onnx: { trainable: false, label: 'ONNX (run-only)' },
  mlx: { trainable: false, label: 'MLX (Apple only)' },
  exl2: { trainable: false, label: 'EXL2 / GPTQ / AWQ (run-only quantizations)' },
};
export function formatsOf(files) {
  const has = (re) => files.some((f) => re.test(f));
  const f = {
    safetensors: has(/\.safetensors$/i), bin: has(/(^|\/)pytorch_model[^/]*\.bin$/i), pt: has(/\.(pt|pth)$/i), gguf: has(/\.gguf$/i),
    onnx: has(/\.onnx$/i), mlx: has(/(^|\/)weights\.npz$|mlx/i), exl2: has(/\.(exl2)$|gptq|awq/i),
  };
  const config = has(/(^|\/)config\.json$/i);
  return { formats: Object.keys(f).filter((k) => f[k]), trainable: config && (f.safetensors || f.bin), config };
}
export const EXPORTS = [
  { id: 'adapter', label: 'LoRA adapter (safetensors, small)', always: true },
  { id: 'merged_16bit', label: 'Full model, 16-bit safetensors (Transformers, vLLM)' },
  { id: 'merged_4bit', label: 'Full model, 4-bit safetensors' },
  { id: 'gguf_q4_k_m', label: 'GGUF Q4_K_M (Ollama, llama.cpp, LM Studio: smallest)' },
  { id: 'gguf_q5_k_m', label: 'GGUF Q5_K_M' },
  { id: 'gguf_q8_0', label: 'GGUF Q8_0 (near full quality)' },
  { id: 'gguf_f16', label: 'GGUF F16 (full precision)' },
];
export const DEFAULTS = {
  auto: true, model_source: 'recommended', model: 'qwen3.5-2b', hf_model: '', local_model: '', method: 'auto',
  exports: ['adapter'], push_repo: '', push_private: true, source: 'builtin', symbol: 'XAUUSD', data_path: '',
  train_from: '2004-01-01', train_to: '2022-12-31', test_from: '2023-01-01', test_to: '2026-12-31',
  epochs: 2, learning_rate: 0.0002, lora_r: 16, batch_size: 4, grad_accum: 4, max_seq_length: 768,
};

const docker = () => process.env.QUANTBOT_DOCKER || 'docker';
// A docker stand-in written in JavaScript (the tests' fake) runs through Node: Windows can't start a .mjs file itself
const dockerCmd = (args) => (/\.(mjs|cjs|js)$/i.test(docker()) ? [process.execPath, [docker(), ...args]] : [docker(), args]);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Runs a short command and resolves with its exit code and output (never rejects)
function run(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let p;
    try { p = spawn(cmd, args, { windowsHide: true }); } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout?.on('data', (d) => { out += d; });
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
  });
}

// Settings picked for the GPU: the largest batch that leaves memory to spare (same effective batch of 16 either way),
// LoRA rank 16 with alpha 32 and 2e-4 (Unsloth's defaults), 2 epochs over ~4,700 days. The script then trims the
// sequence length to the longest real example and halves the batch by itself if the GPU still runs out of memory.
export function autoSettings(modelOrId, gpuGb) {
  const m = typeof modelOrId === 'object' && modelOrId ? modelOrId : MODELS.find((x) => x.id === modelOrId) || MODELS[0];
  const spare = gpuGb ? gpuGb - m.vram : 2;
  const batch = spare >= 3 ? 8 : spare >= 1.5 ? 4 : spare >= 0.5 ? 2 : 1;
  const why = gpuGb
    ? `${gpuGb} GB GPU, ${m.name} needs about ${m.vram} GB: batch ${batch} leaves ${Math.max(0, spare).toFixed(1)} GB to spare`
    : `No GPU reading: batch ${batch} to be safe`;
  return { settings: { epochs: 2, learning_rate: 0.0002, lora_r: 16, batch_size: batch, grad_accum: Math.max(1, Math.round(16 / batch)), max_seq_length: 1024 }, why };
}

export function validateConfig(input) {
  const c = { ...DEFAULTS, ...(input || {}) };
  const bad = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (c.model_source === 'recommended') { if (!MODELS.some((m) => m.id === c.model)) bad('Unknown model'); }
  else if (c.model_source === 'hf') { if (!/^[\w.-]+\/[\w.-]+$/.test(String(c.hf_model || '').trim())) bad('Enter a Hugging Face model as owner/name, e.g. unsloth/Qwen3.5-2B'); c.hf_model = c.hf_model.trim(); }
  else if (c.model_source === 'local') { if (!String(c.local_model || '').trim()) bad('Enter the folder of the model on this PC'); }
  else bad('Unknown model source');
  if (!['auto', 'lora', 'qlora'].includes(c.method)) bad('Method must be auto, lora (16-bit) or qlora (4-bit)');
  c.exports = [...new Set(['adapter', ...(Array.isArray(c.exports) ? c.exports : [])])];
  if (c.exports.some((e) => !EXPORTS.some((x) => x.id === e))) bad('Unknown export format');
  if (c.push_repo && !/^[\w.-]+\/[\w.-]+$/.test(String(c.push_repo).trim())) bad('Upload repo must be owner/name, e.g. yourname/gold-range-qwen');
  for (const k of ['train_from', 'train_to', 'test_from', 'test_to']) if (!isDate(c[k])) throw Object.assign(new Error(`${k} must be a date (YYYY-MM-DD)`), { status: 400 });
  if (c.train_from > c.train_to || c.test_from > c.test_to) throw Object.assign(new Error('Each range must start before it ends'), { status: 400 });
  if (c.test_from <= c.train_to) throw Object.assign(new Error('The test range must start after the training range ends, so the test is on days the model never saw'), { status: 400 });
  if (c.source === 'file' && !c.data_path) throw Object.assign(new Error('Choose the data file (an MT5 export)'), { status: 400 });
  if (c.source !== 'file' && c.source !== 'builtin') throw Object.assign(new Error('Unknown data source'), { status: 400 });
  const num = (k, lo, hi) => {
    const v = Number(c[k]);
    if (!(v >= lo && v <= hi)) throw Object.assign(new Error(`${k} must be between ${lo} and ${hi}`), { status: 400 });
    c[k] = v;
  };
  num('epochs', 0.1, 20); num('learning_rate', 1e-6, 1e-2); num('lora_r', 4, 128); num('batch_size', 1, 32);
  num('grad_accum', 1, 64); num('max_seq_length', 256, 4096);
  return c;
}

const hfBase = () => (process.env.QUANTBOT_HF_URL || 'https://huggingface.co').replace(/\/$/, '');

// Model files in a folder on this PC (walks two levels, enough for HF-style folders)
function localFiles(folder) {
  const out = [];
  const walk = (d, rel, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 2) walk(path.join(d, e.name), r, depth + 1); } else out.push(r);
    }
  };
  walk(folder, '', 0);
  return out;
}

export function createTrainer({ dataDir, market, cipher = null, log = () => {} }) {
  const root = path.join(dataDir, 'train');
  fs.mkdirSync(root, { recursive: true });
  const live = new Map(); // id -> { proc, state }
  let pulling = null;

  const dir = (id) => path.join(root, String(id).replace(/[^0-9a-z-]/gi, ''));
  const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
  const saveState = (id, st) => fs.writeFileSync(path.join(dir(id), 'state.json'), JSON.stringify(st));
  const events = (id) => {
    try { return fs.readFileSync(path.join(dir(id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-KEEP_EVENTS).map((l) => JSON.parse(l)); } catch { return []; }
  };

  function summary(id) {
    const st = readJson(path.join(dir(id), 'state.json'), null);
    if (!st) return null;
    const ev = events(id);
    const last = [...ev].reverse();
    return {
      ...st,
      progress: last.find((e) => e.type === 'progress') || null,
      losses: ev.filter((e) => e.type === 'progress' && e.loss != null).map((e) => [e.step, e.loss]),
      messages: ev.filter((e) => e.type === 'log' || e.type === 'error').slice(-30),
      result: readJson(path.join(dir(id), 'result.json'), null),
    };
  }

  // Writes the training data file: the chosen MT5 export, or the app's own hourly bars for the symbol
  async function dataFile(id, cfg, st) {
    const target = path.join(dir(id), 'data.csv');
    if (cfg.source === 'file') {
      if (!fs.existsSync(cfg.data_path)) throw new Error(`No file at ${cfg.data_path}`);
      fs.copyFileSync(cfg.data_path, target);
      return target;
    }
    st.phase = 'downloading data'; saveState(id, st);
    const to = new Date().toISOString().slice(0, 10);
    const from = cfg.train_from < '2004-01-01' ? '2004-01-01' : cfg.train_from;
    const bars = await market.bars(cfg.symbol, 'H1', from, to < cfg.test_to ? to : cfg.test_to);
    if (!bars.time.length) throw new Error('No market data came back for that range');
    const rows = ['time,open,high,low,close'];
    for (let i = 0; i < bars.time.length; i++) rows.push(`${new Date(bars.time[i]).toISOString()},${bars.open[i]},${bars.high[i]},${bars.low[i]},${bars.close[i]}`);
    fs.writeFileSync(target, rows.join('\n'));
    return target;
  }

  // ---------- Hugging Face: token (stored encrypted), search, model check
  const tokenFile = path.join(root, 'hf.json');
  const hfToken = () => {
    try { const t = readJson(tokenFile, {}).token; return t && cipher ? cipher.decrypt(t) : ''; } catch { return ''; }
  };
  const hfGet = async (p, token = hfToken()) => {
    const res = await fetch(`${hfBase()}${p}`, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Hugging Face refused: this model is gated or private. Add your token (and accept the model\'s license on its page)'), { status: 400 });
    if (res.status === 404) throw Object.assign(new Error('No such model on Hugging Face'), { status: 404 });
    if (!res.ok) throw Object.assign(new Error(`Hugging Face answered ${res.status}`), { status: 502 });
    return res.json();
  };
  async function hfAccount() {
    const token = hfToken();
    if (!token) return { connected: false };
    try { const me = await hfGet('/api/whoami-v2', token); return { connected: true, user: me.name, orgs: (me.orgs || []).map((o) => o.name) }; } catch (e) { return { connected: false, error: e.message, saved: true }; }
  }
  async function hfSave(token) {
    const t = String(token || '').trim();
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) throw Object.assign(new Error('That is not a Hugging Face token (they start with hf_)'), { status: 400 });
    if (!cipher) throw new Error('No key store');
    const me = await hfGet('/api/whoami-v2', t);
    fs.writeFileSync(tokenFile, JSON.stringify({ token: cipher.encrypt(t) }), { mode: 0o600 });
    log(`train: Hugging Face token saved for ${me.name}`);
    return { connected: true, user: me.name };
  }
  async function hfSearch(q) {
    const list = await hfGet(`/api/models?search=${encodeURIComponent(String(q || '').slice(0, 100))}&sort=downloads&direction=-1&limit=20&full=false`);
    return list.map((m) => ({ id: m.id || m.modelId, downloads: m.downloads || 0, likes: m.likes || 0, pipeline: m.pipeline_tag || '', gated: !!m.gated, gguf: /gguf/i.test(m.id || '') }));
  }
  // What a Hugging Face model holds, whether it can be trained, and the GPU memory it needs
  async function hfModel(id, gpu) {
    const m = await hfGet(`/api/models/${id}`);
    const files = (m.siblings || []).map((x) => x.rfilename);
    const f = formatsOf(files);
    const params = m.safetensors?.total ? m.safetensors.total / 1e9 : null;
    const prequant = /bnb-4bit|4bit/i.test(id);
    return describe({ id, gated: !!m.gated, pipeline: m.pipeline_tag || '', params, prequant, ...f }, gpu);
  }
  function localModel(folder, gpu) {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw Object.assign(new Error(`No folder at ${folder}`), { status: 400 });
    const files = localFiles(folder);
    const f = formatsOf(files);
    let params = null;
    try {
      const idx = readJson(path.join(folder, 'model.safetensors.index.json'), null);
      const bytes = idx?.metadata?.total_size || files.filter((x) => /\.(safetensors|bin)$/.test(x)).reduce((n, x) => n + fs.statSync(path.join(folder, x)).size, 0);
      if (bytes) params = bytes / 2e9; // 16-bit weights: 2 bytes per parameter
    } catch { /* unknown size */ }
    const prequant = /"load_in_4bit":\s*true|bitsandbytes/.test(fs.existsSync(path.join(folder, 'config.json')) ? fs.readFileSync(path.join(folder, 'config.json'), 'utf8') : '');
    return describe({ id: folder, local: true, params, prequant, ...f }, gpu);
  }
  function describe(m, gpu) {
    const v4 = m.params ? vramFor(m.params, true) : null, v16 = m.params ? vramFor(m.params, false) : null;
    const runOnly = m.formats.filter((k) => !FORMATS[k].trainable).map((k) => FORMATS[k].label);
    const why = m.trainable ? null : runOnly.length ? `Only run-only formats here (${runOnly.join('; ')}). Pick the original Transformers repo (safetensors) to train`
      : !m.config ? 'No config.json: not a Transformers model folder' : 'No model weights (.safetensors or .bin) found';
    const fits4 = !gpu || !v4 || v4 <= gpu - 0.3, fits16 = !gpu || !v16 || v16 <= gpu - 0.3;
    const suggested = m.prequant ? 'qlora' : fits16 ? 'lora' : 'qlora';
    return { ...m, vram_4bit: v4, vram_16bit: m.prequant ? null : v16, fits: m.prequant || suggested === 'qlora' ? fits4 : fits16, suggested_method: suggested, why_not: why,
      format_labels: m.formats.map((k) => FORMATS[k].label) };
  }

  async function gpuGb() {
    const g = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits']);
    return g.code === 0 ? Math.round(Number(g.out.split('\n')[0]) / 102.4) / 10 : null;
  }

  // Auto-train: read this PC, pick the model and settings that fit it, and say whether everything needed is in place
  // (Docker running, an NVIDIA GPU, Unsloth's image downloaded). Only a ready PC gets the Auto-train button.
  async function autoConfig() {
    const [v, g] = await Promise.all([
      run(...dockerCmd(['version', '--format', '{{.Server.Version}}'])),
      run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']),
    ]);
    const [gName, gMem] = g.code === 0 ? g.out.split('\n')[0].split(',').map((x) => x.trim()) : [];
    const gpu = gName ? Math.round(Number(gMem) / 102.4) / 10 : null;
    const img = v.code === 0 ? await run(...dockerCmd(['image', 'inspect', IMAGE, '--format', '{{.Size}}'])) : { code: 1 };
    // The biggest recommended model that fits with 1 GB of headroom (no GPU reading: the smallest)
    // Under 12 GB: the curated "Best fit" when it fits (proven on 8 GB cards); bigger cards: the largest that fits
    const fits = gpu ? MODELS.filter((m) => m.vram <= gpu - 1) : [];
    const best = fits.find((m) => m.tag === 'Best fit');
    const rec = best && gpu < 12 ? best
      : fits.length ? fits.reduce((a, b) => (b.params > a.params ? b : a)) : MODELS.reduce((a, b) => (b.vram < a.vram ? b : a));
    const { settings, why } = autoSettings(rec, gpu);
    // GGUF F16 / Q8_0 merge the full 16-bit model and crash small cards: offer Q4_K_M (what Ollama runs) under 12 GB
    const exports = gpu && gpu >= 12 ? ['adapter', 'gguf_q8_0'] : ['adapter', 'gguf_q4_k_m'];
    const blockers = [];
    // A closed Docker Desktop or a missing Unsloth image is handled by the run itself; only what can't be fixed blocks
    const notes = [];
    if (v.code !== 0) { if (dockerDesktop()) notes.push('Docker Desktop will be started for you'); else blockers.push('Docker Desktop is not installed: get it from docker.com'); }
    if (!gpu) blockers.push('No NVIDIA GPU found (nvidia-smi did not answer): Unsloth needs one');
    if (img.code !== 0) notes.push('Unsloth (several GB) will be downloaded on the first run');
    return {
      gpu: gName ? { name: gName, memory_gb: gpu } : null, docker: v.code === 0,
      unsloth: { installed: img.code === 0, size_gb: img.code === 0 ? Math.round(Number(img.out) / 1e8) / 10 : null, pulling: pulling ? { ...pulling } : null },
      recommended: { id: rec.id, name: rec.name, hf: rec.hf, vram: rec.vram, tag: rec.tag, note: rec.note },
      settings, why, exports, ready: blockers.length === 0, blockers, notes, gpu_gb: gpu,
      models: MODELS.map((m) => ({ id: m.id, name: m.name, vram: m.vram, tag: m.tag, note: m.note, fits: gpu ? m.vram <= gpu - 0.5 : false })),
    };
  }

  // One click: the clicked model (or the recommended one) with settings worked out for it and this GPU
  async function autoStart(body = {}) {
    const a = await autoConfig();
    if (!a.ready) throw Object.assign(new Error(a.blockers.join('; ')), { status: 400 });
    const m = MODELS.find((x) => x.id === (body.model || a.recommended.id));
    if (!m) throw Object.assign(new Error('Unknown model'), { status: 400 });
    if (a.gpu_gb && m.vram > a.gpu_gb - 0.5) throw Object.assign(new Error(`${m.name} needs about ${m.vram} GB: too big for this ${a.gpu_gb} GB GPU. Pick a smaller one.`), { status: 400 });
    const { settings } = autoSettings(m, a.gpu_gb);
    return start({ ...DEFAULTS, auto: true, model_source: 'recommended', model: m.id, ...settings, exports: a.exports });
  }

  // Downloads Unsloth's image (several GB) in the background
  function pullImage() {
    if (pulling?.state === 'running') return { ...pulling };
    pulling = { state: 'running', line: '', started: Date.now() };
    const p = spawn(...dockerCmd(['pull', IMAGE]), { windowsHide: true });
    const onData = (d) => { const l = String(d).trim().split('\n').pop(); if (l) pulling.line = l.slice(0, 200); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', (e) => Object.assign(pulling, { state: 'error', line: e.message }));
    p.on('close', (code) => { if (pulling.state === 'running') Object.assign(pulling, { state: code === 0 ? 'done' : 'error' }); log(`train: docker pull ${IMAGE} ${code === 0 ? 'done' : `failed (${code})`}`); });
    return { ...pulling };
  }

  // Start Docker Desktop if it's installed but closed, and wait for its engine (first start can take a minute)
  function dockerDesktop() {
    if (process.env.QUANTBOT_DOCKER || process.env.CI || process.env.QUANTBOT_NO_AUTOSTART) return null; // never launch apps from CI or tests
    if (process.platform === 'win32') {
      const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
      return fs.existsSync(exe) ? [exe, []] : null;
    }
    if (process.platform === 'darwin') return fs.existsSync('/Applications/Docker.app') ? ['open', ['-a', 'Docker']] : null;
    return ['systemctl', ['--user', 'start', 'docker-desktop']];
  }
  const dockerUp = async () => (await run(...dockerCmd(['version', '--format', '{{.Server.Version}}']))).code === 0;
  async function ensureDocker(say) {
    if (await dockerUp()) return;
    const app = dockerDesktop();
    if (!app) throw new Error('Docker is not running and Docker Desktop was not found: install it from https://www.docker.com/products/docker-desktop/');
    say('starting Docker Desktop…');
    try { const p = spawn(app[0], app[1], { detached: true, stdio: 'ignore', windowsHide: true }); p.on('error', () => {}); p.unref(); } catch { /* reported below */ }
    for (let t = 0; t < 180; t += 3) { if (await dockerUp()) return; await new Promise((r) => setTimeout(r, 3000)); }
    throw new Error('Docker Desktop did not start within 3 minutes. Open it once by hand (it may need you to accept its terms), then start the run again.');
  }
  // Download Unsloth's image if it's missing, and wait for it
  async function ensureImage(say) {
    if ((await run(...dockerCmd(['image', 'inspect', IMAGE, '--format', '{{.Size}}']))).code === 0) return;
    pullImage();
    while (pulling?.state === 'running') { say(`downloading Unsloth (one time, several GB): ${pulling.line || 'starting'}`.slice(0, 160)); await new Promise((r) => setTimeout(r, 2000)); }
    if (pulling?.state !== 'done') throw new Error(`Couldn't download Unsloth's image: ${pulling?.line || 'unknown error'}`);
  }

  async function start(input) {
    if ([...live.values()].some((x) => x.state.status === 'running')) throw Object.assign(new Error('A training run is already going: stop it or wait for it to finish'), { status: 409 });
    let cfg = validateConfig(input);
    const gpu = await gpuGb();
    // Which weights to load, in 4-bit or 16-bit, and how much GPU memory that takes
    let model;
    if (cfg.model_source === 'recommended') {
      const r = MODELS.find((m) => m.id === cfg.model);
      model = { hf_id: r.hf, name: r.name, four_bit: r.four_bit, vram: r.vram };
    } else {
      const info = cfg.model_source === 'hf' ? await hfModel(cfg.hf_model, gpu) : localModel(cfg.local_model, gpu);
      if (!info.trainable) throw Object.assign(new Error(info.why_not), { status: 400 });
      const four = info.prequant || (cfg.method === 'auto' ? info.suggested_method === 'qlora' : cfg.method === 'qlora');
      model = { hf_id: cfg.model_source === 'hf' ? info.id : '/workspace/model', name: cfg.model_source === 'hf' ? info.id : path.basename(cfg.local_model), four_bit: four, vram: (four ? info.vram_4bit : info.vram_16bit) || 6 };
    }
    if (cfg.method !== 'auto' && cfg.model_source === 'recommended') model.four_bit = cfg.method === 'qlora' || model.four_bit;
    cfg = { ...cfg, hf_id: model.hf_id, model_name: model.name, load_in_4bit: model.four_bit };
    if (cfg.auto) {
      const a = autoSettings(model, gpu);
      cfg = { ...cfg, ...a.settings, auto_reason: a.why };
    }
    if (cfg.push_repo && !hfToken()) throw Object.assign(new Error('Uploading to Hugging Face needs your token (Hugging Face card above)'), { status: 400 });
    const id = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
    fs.mkdirSync(dir(id), { recursive: true });
    const st = { id, status: 'running', phase: 'starting', config: cfg, started: new Date().toISOString(), ended: null, error: null };
    saveState(id, st);
    const entry = { proc: null, state: st };
    live.set(id, entry);
    (async () => {
      try {
        // Bring up whatever the run needs: Docker Desktop if it's closed, Unsloth's image if it's missing
        const say = (phase) => { st.phase = phase; saveState(id, st); };
        await ensureDocker(say);
        await ensureImage(say);
        if (entry.stopped) throw new Error('Stopped');
        st.phase = 'starting'; saveState(id, st);
        await dataFile(id, cfg, st);
        fs.writeFileSync(path.join(dir(id), 'config.json'), JSON.stringify({ ...cfg, data_file: '/workspace/job/data.csv' }, null, 1));
        st.phase = 'training'; saveState(id, st);
        if (entry.stopped) throw new Error('Stopped');
        const args = ['run', '--rm', '--name', `quantbot-train-${id}`, '--gpus', 'all', '--ipc=host',
          '-v', `${dir(id)}:/workspace/job`, '-v', `${SCRIPT_DIR}:/workspace/code:ro`, '-v', `${HF_VOLUME}:/root/.cache/huggingface`,
          ...(cfg.model_source === 'local' ? ['-v', `${path.resolve(cfg.local_model)}:/workspace/model:ro`] : []),
          ...(hfToken() ? ['-e', 'HF_TOKEN'] : []), // the value comes from this process's environment, never the command line
          IMAGE, 'python', '/workspace/code/qb_train.py', '/workspace/job'];
        const evFile = fs.createWriteStream(path.join(dir(id), 'events.jsonl'), { flags: 'a' });
        const logFile = fs.createWriteStream(path.join(dir(id), 'output.log'), { flags: 'a' });
        const proc = spawn(...dockerCmd(args), { windowsHide: true, env: { ...process.env, ...(hfToken() ? { HF_TOKEN: hfToken() } : {}) } });
        entry.proc = proc;
        let buf = '';
        const onOut = (d) => {
          logFile.write(d);
          buf += d;
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (line.startsWith('{')) { try { JSON.parse(line); evFile.write(`${line}\n`); } catch { /* not an event */ } }
          }
        };
        proc.stdout.on('data', onOut);
        proc.stderr.on('data', (d) => logFile.write(d));
        const code = await new Promise((resolve) => { proc.on('error', (e) => { logFile.write(String(e)); resolve(-1); }); proc.on('close', resolve); });
        await Promise.all([evFile, logFile].map((f) => new Promise((r) => f.end(r))));
        const err = events(id).reverse().find((e) => e.type === 'error');
        if (entry.stopped) throw new Error('Stopped');
        if (code !== 0) {
          // Show the real cause: the last lines the container printed, not just a pointer to the file
          let tail = '';
          try { tail = fs.readFileSync(path.join(dir(id), 'output.log'), 'utf8').trim().split('\n').filter((l) => !l.startsWith('{')).slice(-4).join(' | ').slice(-500); } catch { /* no log */ }
          throw new Error(err?.message || `Docker exited with code ${code}${tail ? `: ${tail}` : ''} (full log: output.log in ${dir(id)})`);
        }
        Object.assign(st, { status: 'done', phase: 'done' });
      } catch (e) {
        Object.assign(st, { status: entry.stopped ? 'stopped' : 'error', phase: entry.stopped ? 'stopped' : 'error', error: entry.stopped ? null : e.message });
        if (!entry.stopped) log(`train ${id}: ${e.message}`);
      } finally {
        st.ended = new Date().toISOString();
        saveState(id, st);
        live.delete(id);
      }
    })();
    if (cfg.auto_reason) fs.appendFileSync(path.join(dir(id), 'events.jsonl'), `${JSON.stringify({ type: 'log', time: Date.now() / 1000, message: `Auto settings: ${cfg.auto_reason}` })}\n`);
    log(`train ${id}: started ${cfg.model} on ${cfg.source === 'file' ? path.basename(cfg.data_path) : cfg.symbol}`);
    return { id };
  }

  async function stop(id) {
    const entry = live.get(id);
    if (!entry) return { ok: false };
    entry.stopped = true;
    try { fs.writeFileSync(path.join(dir(id), 'STOP'), ''); } catch { /* folder gone */ }
    await run(...dockerCmd(['stop', '-t', '20', `quantbot-train-${id}`]), 30000);
    entry.proc?.kill();
    return { ok: true };
  }

  return {
    models: MODELS,
    defaults: DEFAULTS,
    image: IMAGE,
    // What this PC has: Docker, its engine, the NVIDIA GPU, and whether Unsloth's image is downloaded
    async status() {
      const v = await run(...dockerCmd(['version', '--format', '{{.Server.Version}}']));
      const gpu = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
      const img = v.code === 0 ? await run(...dockerCmd(['image', 'inspect', IMAGE, '--format', '{{.Size}}'])) : { code: 1 };
      const [gName, gMem] = gpu.code === 0 ? gpu.out.split('\n')[0].split(',').map((x) => x.trim()) : [];
      return {
        docker: v.code === 0, docker_version: v.code === 0 ? v.out : null,
        docker_error: v.code === 0 ? null : (v.err || 'Docker is not installed or not running'),
        gpu: gName ? { name: gName, memory_gb: Math.round(Number(gMem) / 102.4) / 10 } : null,
        image: img.code === 0, image_size_gb: img.code === 0 ? Math.round(Number(img.out) / 1e8) / 10 : null,
        pulling: pulling ? { ...pulling } : null,
      };
    },
    pull: pullImage,
    start,
    stop,
    runs() {
      return fs.readdirSync(root).map(summary).filter(Boolean).sort((a, b) => b.started.localeCompare(a.started));
    },
    run: (id) => summary(id),
    auto: async (model) => autoSettings(model, await gpuGb()),
    autoConfig,
    autoStart,
    exportsList: EXPORTS,
    hf: { account: hfAccount, save: hfSave, remove: () => { fs.rmSync(tokenFile, { force: true }); return { connected: false }; }, search: hfSearch,
      model: async (id) => hfModel(id, await gpuGb()) },
    local: async (folder) => localModel(folder, await gpuGb()),
    // The Unsloth Studio recipe the run wrote (config YAML + dataset), for Upload in Studio
    recipe(id) {
      const f = path.join(dir(id), 'unsloth_studio');
      return fs.existsSync(f) ? fs.readdirSync(f).map((name) => ({ name, size: fs.statSync(path.join(f, name)).size })) : [];
    },
    recipeFile(id, name) {
      const f = path.join(dir(id), 'unsloth_studio', path.basename(name));
      return fs.existsSync(f) ? f : null;
    },
    remove(id) {
      if (live.has(id)) throw Object.assign(new Error('Stop the run first'), { status: 409 });
      fs.rmSync(dir(id), { recursive: true, force: true });
      return { ok: true };
    },
    folder: (id) => dir(id),
  };
}
