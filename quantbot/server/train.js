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

export const MODELS = [
  { id: 'qwen3.5-2b', name: 'Qwen3.5 2B', vram: 5, note: 'Recommended for an 8 GB RTX 4060: fits with room to spare' },
  { id: 'qwen3.5-0.8b', name: 'Qwen3.5 0.8B', vram: 3, note: 'Quickest: good for a first test run' },
  { id: 'qwen3-4b-4bit', name: 'Qwen3 4B (4-bit)', vram: 8, note: 'Bigger model in 4-bit: tight on 8 GB' },
];
export const DEFAULTS = {
  auto: true, model: 'qwen3.5-2b', source: 'builtin', symbol: 'XAUUSD', data_path: '',
  train_from: '2004-01-01', train_to: '2022-12-31', test_from: '2023-01-01', test_to: '2026-12-31',
  epochs: 2, learning_rate: 0.0002, lora_r: 16, batch_size: 4, grad_accum: 4, max_seq_length: 768,
};

const docker = () => process.env.QUANTBOT_DOCKER || 'docker';
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
export function autoSettings(modelId, gpuGb) {
  const m = MODELS.find((x) => x.id === modelId) || MODELS[0];
  const spare = gpuGb ? gpuGb - m.vram : 2;
  const batch = spare >= 3 ? 8 : spare >= 1.5 ? 4 : spare >= 0.5 ? 2 : 1;
  const why = gpuGb
    ? `${gpuGb} GB GPU, ${m.name} needs about ${m.vram} GB: batch ${batch} leaves ${Math.max(0, spare).toFixed(1)} GB to spare`
    : `No GPU reading: batch ${batch} to be safe`;
  return { settings: { epochs: 2, learning_rate: 0.0002, lora_r: 16, batch_size: batch, grad_accum: Math.max(1, Math.round(16 / batch)), max_seq_length: 1024 }, why };
}

export function validateConfig(input) {
  const c = { ...DEFAULTS, ...(input || {}) };
  if (!MODELS.some((m) => m.id === c.model)) throw Object.assign(new Error('Unknown model'), { status: 400 });
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

export function createTrainer({ dataDir, market, log = () => {} }) {
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

  async function gpuGb() {
    const g = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits']);
    return g.code === 0 ? Math.round(Number(g.out.split('\n')[0]) / 102.4) / 10 : null;
  }

  async function start(input) {
    if ([...live.values()].some((x) => x.state.status === 'running')) throw Object.assign(new Error('A training run is already going: stop it or wait for it to finish'), { status: 409 });
    let cfg = validateConfig(input);
    if (cfg.auto) {
      const a = autoSettings(cfg.model, await gpuGb());
      cfg = { ...cfg, ...a.settings, auto_reason: a.why };
    }
    const id = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
    fs.mkdirSync(dir(id), { recursive: true });
    const st = { id, status: 'running', phase: 'starting', config: cfg, started: new Date().toISOString(), ended: null, error: null };
    saveState(id, st);
    const entry = { proc: null, state: st };
    live.set(id, entry);
    (async () => {
      try {
        await dataFile(id, cfg, st);
        fs.writeFileSync(path.join(dir(id), 'config.json'), JSON.stringify({ ...cfg, data_file: '/workspace/job/data.csv' }, null, 1));
        st.phase = 'training'; saveState(id, st);
        if (entry.stopped) throw new Error('Stopped');
        const args = ['run', '--rm', '--name', `quantbot-train-${id}`, '--gpus', 'all', '--ipc=host',
          '-v', `${dir(id)}:/workspace/job`, '-v', `${SCRIPT_DIR}:/workspace/code:ro`, '-v', `${HF_VOLUME}:/root/.cache/huggingface`,
          IMAGE, 'python', '/workspace/code/qb_train.py', '/workspace/job'];
        const evFile = fs.createWriteStream(path.join(dir(id), 'events.jsonl'), { flags: 'a' });
        const logFile = fs.createWriteStream(path.join(dir(id), 'output.log'), { flags: 'a' });
        const proc = spawn(docker(), args, { windowsHide: true });
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
        if (code !== 0) throw new Error(err?.message || `Docker exited with code ${code}: see output.log in ${dir(id)}`);
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
    await run(docker(), ['stop', '-t', '20', `quantbot-train-${id}`], 30000);
    entry.proc?.kill();
    return { ok: true };
  }

  return {
    models: MODELS,
    defaults: DEFAULTS,
    image: IMAGE,
    // What this PC has: Docker, its engine, the NVIDIA GPU, and whether Unsloth's image is downloaded
    async status() {
      const v = await run(docker(), ['version', '--format', '{{.Server.Version}}']);
      const gpu = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
      const img = v.code === 0 ? await run(docker(), ['image', 'inspect', IMAGE, '--format', '{{.Size}}']) : { code: 1 };
      const [gName, gMem] = gpu.code === 0 ? gpu.out.split('\n')[0].split(',').map((x) => x.trim()) : [];
      return {
        docker: v.code === 0, docker_version: v.code === 0 ? v.out : null,
        docker_error: v.code === 0 ? null : (v.err || 'Docker is not installed or not running'),
        gpu: gName ? { name: gName, memory_gb: Math.round(Number(gMem) / 102.4) / 10 } : null,
        image: img.code === 0, image_size_gb: img.code === 0 ? Math.round(Number(img.out) / 1e8) / 10 : null,
        pulling: pulling ? { ...pulling } : null,
      };
    },
    // Downloads Unsloth's image (several GB) in the background
    pull() {
      if (pulling?.state === 'running') return { ...pulling };
      pulling = { state: 'running', line: '', started: Date.now() };
      const p = spawn(docker(), ['pull', IMAGE], { windowsHide: true });
      const onData = (d) => { const l = String(d).trim().split('\n').pop(); if (l) pulling.line = l.slice(0, 200); };
      p.stdout.on('data', onData); p.stderr.on('data', onData);
      p.on('error', (e) => Object.assign(pulling, { state: 'error', line: e.message }));
      p.on('close', (code) => { if (pulling.state === 'running') Object.assign(pulling, { state: code === 0 ? 'done' : 'error' }); log(`train: docker pull ${IMAGE} ${code === 0 ? 'done' : `failed (${code})`}`); });
      return { ...pulling };
    },
    start,
    stop,
    runs() {
      return fs.readdirSync(root).map(summary).filter(Boolean).sort((a, b) => b.started.localeCompare(a.started));
    },
    run: (id) => summary(id),
    auto: async (model) => autoSettings(model, await gpuGb()),
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
