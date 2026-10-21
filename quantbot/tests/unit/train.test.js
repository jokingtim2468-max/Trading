// Train page: config checks and a full run through the server with a stand-in docker (real data step, fake GPU)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { validateConfig, autoSettings, formatsOf, vramFor } from '../../server/train.js';
import { startServer } from '../../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quantbot-train-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// An MT5-style M5 export: 420 weekdays of a random walk starting 2020-01-01
function mt5File(dir) {
  const lines = ['<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>'];
  let p = 1500, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const d = new Date(Date.UTC(2020, 0, 1));
  for (let n = 0; n < 420;) {
    if (d.getUTCDay() % 6 !== 0) {
      for (let m = 0; m < 24 * 60; m += 60) {
        const o = p; p = Math.max(100, p + rnd() * 8); const h = Math.max(o, p) + Math.abs(rnd()) * 3, l = Math.min(o, p) - Math.abs(rnd()) * 3;
        const ds = d.toISOString().slice(0, 10).replace(/-/g, '.'), t = `${String(m / 60).padStart(2, '0')}:00:00`;
        lines.push(`${ds}\t${t}\t${o.toFixed(2)}\t${h.toFixed(2)}\t${l.toFixed(2)}\t${p.toFixed(2)}\t10\t0\t20`);
      }
      n++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const f = path.join(dir, 'XAUUSD_M5_test.csv');
  fs.writeFileSync(f, lines.join('\n'));
  return f;
}

describe('Train config', () => {
  test('defaults, ranges and limits', () => {
    const c = validateConfig({});
    assert.equal(c.model, 'qwen3.5-2b');
    assert.throws(() => validateConfig({ model: 'gpt' }), /Unknown model/);
    assert.throws(() => validateConfig({ test_from: '2022-06-01' }), /never saw/);
    assert.throws(() => validateConfig({ train_from: 'soon' }), /date/);
    assert.throws(() => validateConfig({ epochs: 100 }), /epochs/);
    assert.throws(() => validateConfig({ source: 'file' }), /data file/);
    assert.equal(validateConfig({ epochs: '3' }).epochs, 3);
  });
  test('auto settings fit the GPU and keep the effective batch', () => {
    const a = autoSettings('qwen3.5-2b', 8);
    assert.equal(a.settings.batch_size, 8);
    assert.equal(a.settings.batch_size * a.settings.grad_accum, 16);
    assert.match(a.why, /8 GB GPU/);
    assert.equal(autoSettings('qwen3-4b-4bit', 8).settings.batch_size, 2, 'tight model: small batch');
    assert.equal(autoSettings('qwen3.5-2b', 6).settings.batch_size, 2);
  });
});

describe('Model formats', () => {
  test('which files can be trained from', () => {
    assert.equal(formatsOf(['config.json', 'model-00001-of-00002.safetensors']).trainable, true);
    assert.equal(formatsOf(['config.json', 'pytorch_model.bin']).trainable, true);
    assert.equal(formatsOf(['model.Q4_K_M.gguf']).trainable, false);
    assert.deepEqual(formatsOf(['config.json', 'model.onnx', 'x.gguf']).formats, ['gguf', 'onnx']);
    assert.equal(vramFor(2.3, false), 5.6);
    assert.equal(vramFor(4, true), 4.6);
    assert.throws(() => validateConfig({ model_source: 'hf', hf_model: 'nope' }), /owner\/name/);
    assert.throws(() => validateConfig({ exports: ['zip'] }), /export format/);
    assert.deepEqual(validateConfig({ exports: ['gguf_q4_k_m'] }).exports, ['adapter', 'gguf_q4_k_m']);
  });
});

// Stand-in for huggingface.co: whoami, search and model pages
function fakeHf() {
  const models = {
    'acme/tiny-llm': { id: 'acme/tiny-llm', pipeline_tag: 'text-generation', safetensors: { total: 1.5e9 }, siblings: [{ rfilename: 'config.json' }, { rfilename: 'model.safetensors' }] },
    'acme/big-llm': { id: 'acme/big-llm', pipeline_tag: 'text-generation', safetensors: { total: 14e9 }, siblings: [{ rfilename: 'config.json' }, { rfilename: 'model-00001-of-00006.safetensors' }] },
    'acme/tiny-llm-GGUF': { id: 'acme/tiny-llm-GGUF', siblings: [{ rfilename: 'tiny.Q4_K_M.gguf' }] },
    'acme/locked': { gated: 'manual' },
  };
  const srv = http.createServer((req, res) => {
    const auth = req.headers.authorization === 'Bearer hf_testtoken1234567890abcd';
    const u = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/api/whoami-v2') return auth ? send(200, { name: 'trader1', orgs: [] }) : send(401, { error: 'bad token' });
    if (u.pathname === '/api/models') return send(200, Object.keys(models).filter((k) => k.includes(u.searchParams.get('search') || '')).map((id) => ({ id, downloads: 10, pipeline_tag: 'text-generation' })));
    const id = decodeURIComponent(u.pathname.replace('/api/models/', ''));
    if (id === 'acme/locked' && !auth) return send(401, {});
    return models[id] ? send(200, models[id]) : send(404, {});
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

describe('Train API with a stand-in docker', () => {
  let srv, base, dir, file, hf;
  before(async () => {
    dir = tmp(); file = mt5File(dir);
    hf = await fakeHf();
    process.env.QUANTBOT_HF_URL = `http://127.0.0.1:${hf.address().port}`;
    process.env.QUANTBOT_DOCKER = path.join(here, '..', 'support', 'fake_docker.mjs');
    srv = await startServer({ port: 0, dataDir: path.join(dir, 'data'), quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
  });
  after(async () => { await srv.close(); hf.close(); delete process.env.QUANTBOT_HF_URL; delete process.env.QUANTBOT_DOCKER; fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

  test('auto-train: picks a model + settings for the PC and refuses until everything is in place', async () => {
    const a = await (await fetch(`${base}/api/train/autoconfig`)).json();
    assert.equal(a.docker, true);
    assert.equal(a.unsloth.installed, true);
    assert.ok(a.recommended.id && a.settings.batch_size >= 1 && a.settings.grad_accum >= 1);
    assert.ok(a.exports.includes('adapter'));
    if (!a.gpu) {
      // No NVIDIA GPU on the test machine: the smallest model, the safe Q4 export, and a refusal that says why
      assert.equal(a.ready, false);
      assert.match(a.blockers.join(' '), /NVIDIA GPU/);
      assert.ok(a.exports.includes('gguf_q4_k_m'));
      const r = await post('/api/train/autostart');
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /NVIDIA GPU/);
    }
  });

  test('a run brings up what it needs: a missing Unsloth image is downloaded first, then training runs', async () => {
    process.env.FAKE_NO_IMAGE = '1';
    try {
      const a = await (await fetch(`${base}/api/train/autoconfig`)).json();
      assert.equal(a.unsloth.installed, false);
      assert.ok(!a.blockers.some((b) => /isn't installed|download/i.test(b)), 'a missing image is not a blocker');
      assert.match(a.notes.join(' '), /Unsloth .* downloaded on the first run/);
      const cfg = { source: 'file', data_path: file, train_from: '2020-01-01', train_to: '2020-12-31', test_from: '2021-01-01', test_to: '2021-12-31', model: 'qwen3.5-0.8b' };
      const { id } = await (await post('/api/train/start', cfg)).json();
      let run;
      for (let i = 0; i < 300; i++) {
        run = await (await fetch(`${base}/api/train/runs/${id}`)).json();
        if (run.status !== 'running') break;
        await wait(100);
      }
      assert.equal(run.status, 'done', JSON.stringify(run));
      const st = await (await fetch(`${base}/api/train/status`)).json();
      assert.equal(st.pulling?.state, 'done', 'the image was pulled before training');
      await fetch(`${base}/api/train/runs/${id}`, { method: 'DELETE' });
    } finally { delete process.env.FAKE_NO_IMAGE; }
  });

  test('status, pull, a full run, refusals and delete', async () => {
    const st = await (await fetch(`${base}/api/train/status`)).json();
    assert.equal(st.docker, true);
    assert.equal(st.image, true);
    assert.equal(st.models[0].id, 'qwen3.5-2b');
    const pull = await (await post('/api/train/pull')).json();
    assert.equal(pull.state, 'running');

    const bad = await post('/api/train/start', { source: 'file', data_path: file, train_from: '2020-01-01', train_to: '2020-12-31', test_from: '2020-06-01', test_to: '2021-12-31' });
    assert.equal(bad.status, 400);

    const cfg = { source: 'file', data_path: file, train_from: '2020-01-01', train_to: '2020-12-31', test_from: '2021-01-01', test_to: '2021-12-31', model: 'qwen3.5-0.8b' };
    const { id } = await (await post('/api/train/start', cfg)).json();
    assert.ok(id);
    let run;
    for (let i = 0; i < 300; i++) {
      run = await (await fetch(`${base}/api/train/runs/${id}`)).json();
      if (run.status !== 'running') break;
      await wait(100);
    }
    assert.equal(run.status, 'done', JSON.stringify(run));
    assert.equal(run.result.better_than_guess_pct, 9.09);
    assert.equal(run.losses.length, 4);
    assert.match(run.messages.map((m) => m.message).join(' '), /for training, \d+ for the test/);
    const folder = path.join(dir, 'data', 'train', id);
    const trainRows = fs.readFileSync(path.join(folder, 'train.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(trainRows.every((r) => r.date <= '2020-12-31'), 'training days stay in the training range');
    assert.match(trainRows[0].answer, /^\{"high": [\d.-]+, "low": [\d.-]+\}$/);

    assert.match(run.messages.map((m) => m.message).join(' '), /Auto settings: .*batch \d/);
    assert.match(run.messages.map((m) => m.message).join(' '), /Unsloth Studio recipe written/);
    const files = (await (await fetch(`${base}/api/train/runs/${id}/recipe`)).json()).files.map((f) => f.name);
    assert.ok(files.includes('gold_daily_range.jsonl'));
    const yamlName = files.find((f) => f.endsWith('.yaml'));
    assert.match(yamlName, /^qwen3\.5-0\.8b_lora_gold-daily-range_\d{8}-\d{6}\.yaml$/);
    const yaml = await (await fetch(`${base}/api/train/runs/${id}/recipe/${yamlName}`)).text();
    assert.match(yaml, /name: "unsloth\/Qwen3\.5-0\.8B"/);
    assert.match(yaml, /train_on_completions: true/);
    const row = JSON.parse((await (await fetch(`${base}/api/train/runs/${id}/recipe/gold_daily_range.jsonl`)).text()).split('\n')[0]);
    assert.deepEqual(Object.keys(row), ['instruction', 'input', 'output']);
    assert.equal((await fetch(`${base}/api/train/runs/${id}/recipe/..%2Fconfig.json`)).status, 404, 'only recipe files');
    const list = await (await fetch(`${base}/api/train/runs`)).json();
    assert.equal(list.runs[0].id, id);
    const del = await fetch(`${base}/api/train/runs/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(folder), false);
  });

  test('Hugging Face: token, search, model checks, and runs on any model', async () => {
    const getJ = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
    assert.equal((await getJ('/api/train/hf')).body.connected, false);
    assert.equal((await post('/api/train/hf', { token: 'nope' })).status, 400);
    assert.equal((await post('/api/train/hf', { token: 'hf_wrongtoken1234567890abcd' })).status, 400, 'Hugging Face refuses it');
    const saved = await (await post('/api/train/hf', { token: 'hf_testtoken1234567890abcd' })).json();
    assert.equal(saved.user, 'trader1');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'data', 'train', 'hf.json'), 'utf8'), /hf_testtoken/, 'stored encrypted');
    assert.equal((await getJ('/api/train/hf')).body.user, 'trader1');

    const found = (await getJ('/api/train/hf/search?q=tiny')).body.models.map((m) => m.id);
    assert.deepEqual(found, ['acme/tiny-llm', 'acme/tiny-llm-GGUF']);
    const tiny = (await getJ('/api/train/hf/model?id=acme/tiny-llm')).body;
    assert.equal(tiny.trainable, true);
    assert.equal(tiny.params, 1.5);
    const gguf = (await getJ('/api/train/hf/model?id=acme/tiny-llm-GGUF')).body;
    assert.equal(gguf.trainable, false);
    assert.match(gguf.why_not, /GGUF/);
    assert.equal((await getJ('/api/train/hf/model?id=acme/locked')).status, 200, 'gated model opens with the token');

    const cfg = { source: 'file', data_path: file, train_from: '2020-01-01', train_to: '2020-12-31', test_from: '2021-01-01', test_to: '2021-12-31' };
    assert.match(await (await post('/api/train/start', { ...cfg, model_source: 'hf', hf_model: 'acme/tiny-llm-GGUF' })).text(), /GGUF/);
    const { id } = await (await post('/api/train/start', { ...cfg, model_source: 'hf', hf_model: 'acme/big-llm', method: 'qlora', exports: ['merged_16bit', 'gguf_q4_k_m'], push_repo: 'trader1/gold' })).json();
    let run;
    for (let i = 0; i < 300 && (!run || run.status === 'running'); i++) { await wait(100); run = await (await fetch(`${base}/api/train/runs/${id}`)).json(); }
    assert.equal(run.status, 'done', JSON.stringify(run.error));
    const jobCfg = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'train', id, 'config.json'), 'utf8'));
    assert.equal(jobCfg.hf_id, 'acme/big-llm');
    assert.equal(jobCfg.load_in_4bit, true);
    assert.deepEqual(jobCfg.exports, ['adapter', 'merged_16bit', 'gguf_q4_k_m']);
    const d = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'train', id, 'docker-args.json'), 'utf8'));
    assert.equal(d.hfToken, 'hf_testtoken1234567890abcd', 'token reaches the container through the environment');
    assert.ok(d.args.includes('HF_TOKEN') && !d.args.some((x) => x.includes('hf_testtoken')), 'and never on the command line');

    // A local folder: GGUF only is refused, safetensors folders are mounted read-only
    const ggufDir = path.join(dir, 'gguf-model'); fs.mkdirSync(ggufDir); fs.writeFileSync(path.join(ggufDir, 'm.gguf'), 'x');
    assert.match((await getJ(`/api/train/local?path=${encodeURIComponent(ggufDir)}`)).body.why_not, /GGUF/);
    const stDir = path.join(dir, 'st-model'); fs.mkdirSync(stDir); fs.writeFileSync(path.join(stDir, 'config.json'), '{}'); fs.writeFileSync(path.join(stDir, 'model.safetensors'), Buffer.alloc(2000));
    assert.equal((await getJ(`/api/train/local?path=${encodeURIComponent(stDir)}`)).body.trainable, true);
    const { id: id2 } = await (await post('/api/train/start', { ...cfg, model_source: 'local', local_model: stDir })).json();
    for (let i = 0; i < 300; i++) { await wait(100); run = await (await fetch(`${base}/api/train/runs/${id2}`)).json(); if (run.status !== 'running') break; }
    const d2 = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'train', id2, 'docker-args.json'), 'utf8'));
    assert.ok(d2.args.includes(`${stDir}:/workspace/model:ro`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'train', id2, 'config.json'), 'utf8')).hf_id, '/workspace/model');
    assert.equal((await fetch(`${base}/api/train/hf`, { method: 'DELETE' })).status, 200);
    assert.equal((await getJ('/api/train/hf')).body.connected, false);
  });

  test('a failing run reports the script error, and stop ends a run', async () => {
    const cfg = { source: 'file', data_path: file, train_from: '2020-01-01', train_to: '2020-12-31', test_from: '2021-01-01', test_to: '2021-12-31' };
    process.env.FAKE_TRAIN_FAIL = '1';
    let { id } = await (await post('/api/train/start', cfg)).json();
    let run;
    for (let i = 0; i < 300 && (!run || run.status === 'running'); i++) { await wait(100); run = await (await fetch(`${base}/api/train/runs/${id}`)).json(); }
    delete process.env.FAKE_TRAIN_FAIL;
    assert.equal(run.status, 'error');
    assert.match(run.error, /out of memory/);

    process.env.FAKE_STEP_MS = '1500';
    ({ id } = await (await post('/api/train/start', cfg)).json());
    const busy = await post('/api/train/start', cfg);
    assert.equal(busy.status, 409, 'one run at a time');
    for (let i = 0; i < 300; i++) { run = await (await fetch(`${base}/api/train/runs/${id}`)).json(); if (run.progress) break; await wait(100); }
    await post(`/api/train/runs/${id}/stop`);
    for (let i = 0; i < 300 && run.status === 'running'; i++) { await wait(100); run = await (await fetch(`${base}/api/train/runs/${id}`)).json(); }
    delete process.env.FAKE_STEP_MS;
    assert.equal(run.status, 'stopped');
  });
});

test('built-in data trains on every chosen market, one per price feed', () => {
  assert.deepEqual(validateConfig({}).symbols, ['XAUUSD', 'NQ'], 'default: gold and the Nasdaq-100');
  assert.deepEqual(validateConfig({ symbols: ['NQ', 'US100', 'XAUUSD'] }).symbols, ['NQ', 'XAUUSD'], 'US100 is the same prices as NQ');
  assert.deepEqual(validateConfig({ symbols: [], symbol: 'US100' }).symbols, ['US100'], 'an old single-market config still works');
  assert.throws(() => validateConfig({ symbols: ['EURUSD'], symbol: 'EURUSD' }), /at least one market/);
});
