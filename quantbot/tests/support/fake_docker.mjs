#!/usr/bin/env node
// Stand-in for the docker command in the Train tests: version / image inspect / pull / stop answer at once; `run`
// maps the job folder, runs the real data step (qb_train.py prepare) with this PC's python, then pretends to train.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const a = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (a[0] === 'version') { console.log('27.1.1'); process.exit(0); }
if (a[0] === 'image' && a[1] === 'inspect') { if (process.env.FAKE_NO_IMAGE) process.exit(1); console.log('9500000000'); process.exit(0); }
if (a[0] === 'pull') { console.log('core: Pulling from unsloth/unsloth'); console.log('Status: Downloaded newer image'); process.exit(0); }
if (a[0] === 'stop') process.exit(0);
if (a[0] === 'run') {
  const vol = (target) => { const v = a[a.indexOf('-v', a.findIndex((x, i) => a[i - 1] === '-v' && x.endsWith(target)) - 1) + 1]; return v.slice(0, v.length - target.length - 1); };
  const job = a.find((x, i) => a[i - 1] === '-v' && x.endsWith(':/workspace/job')).replace(/:\/workspace\/job$/, '');
  const code = a.find((x, i) => a[i - 1] === '-v' && x.endsWith(':/workspace/code:ro')).replace(/:\/workspace\/code:ro$/, '');
  void vol;
  const cfgPath = path.join(job, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, data_file: path.join(job, 'data.csv') }));
  const r = spawnSync('python3', [path.join(code, 'qb_train.py'), job, 'prepare'], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(1); }
  if (process.env.FAKE_TRAIN_FAIL) { console.log(JSON.stringify({ type: 'error', message: 'CUDA out of memory' })); process.exit(1); }
  for (let s = 5; s <= 20; s += 5) {
    if (fs.existsSync(path.join(job, 'STOP'))) process.exit(137);
    console.log(JSON.stringify({ type: 'progress', step: s, total: 20, loss: 2 / s, epoch: s / 10, vram_gb: 4.8 }));
    await sleep(Number(process.env.FAKE_STEP_MS || 20));
  }
  const result = { days: 50, unreadable: 0, model_error_pct: 0.5, guess_error_pct: 0.55, better_than_guess_pct: 9.09, reached_high_pct: 48, reached_low_pct: 50, model: cfg.model };
  fs.writeFileSync(path.join(job, 'result.json'), JSON.stringify(result));
  console.log(JSON.stringify({ type: 'metric', ...result }));
  console.log(JSON.stringify({ type: 'done', step: 'all' }));
  process.exit(0);
}
console.error(`fake docker: unknown command ${a.join(' ')}`);
process.exit(2);
