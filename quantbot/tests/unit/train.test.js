// Train page: config checks and a full run through the server with a stand-in docker (real data step, fake GPU)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../../server/train.js';
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
});

describe('Train API with a stand-in docker', () => {
  let srv, base, dir, file;
  before(async () => {
    dir = tmp(); file = mt5File(dir);
    process.env.QUANTBOT_DOCKER = path.join(here, '..', 'support', 'fake_docker.mjs');
    srv = await startServer({ port: 0, dataDir: path.join(dir, 'data'), quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
  });
  after(async () => { await srv.close(); delete process.env.QUANTBOT_DOCKER; fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

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

    const list = await (await fetch(`${base}/api/train/runs`)).json();
    assert.equal(list.runs[0].id, id);
    const del = await fetch(`${base}/api/train/runs/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(folder), false);
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
