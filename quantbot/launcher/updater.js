// Brings an installed QuantBot up to date before it opens: fetch and pull from GitHub, reinstall packages when the
// lockfile changed, rebuild the UI when its source changed. Every step reports real progress:
//   git        its own "Receiving objects: 45%" output while downloading
//   npm        packages fetched so far out of the packages in package-lock.json
//   build      modules transformed so far out of the module count of the previous build
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WIN = process.platform === 'win32';
// The lockfile, the build inputs, and everything that decides what the UI build looks like
const BUILD_INPUTS = ['src', 'public', 'index.html', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'package-lock.json'];

// -> { code, out } ; onLine gets every output line (stdout and stderr, split on \n and \r for progress lines)
export function run(cmd, args, { cwd, onLine, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: WIN && /^(npm|npx)$/.test(cmd), windowsHide: true });
    } catch (e) {
      resolve({ code: -1, out: e.message });
      return;
    }
    let partial = '';
    const feed = (chunk) => {
      const text = partial + chunk.toString();
      const lines = text.split(/\r?\n|\r/);
      partial = lines.pop();
      for (const l of lines) { out += `${l}\n`; onLine?.(l); }
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', (e) => resolve({ code: -1, out: `${out}${e.message}` }));
    child.on('close', (code) => { if (partial) { out += partial; onLine?.(partial); } resolve({ code, out }); });
  });
}

function hashPaths(root, entries) {
  const h = crypto.createHash('sha1');
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) { for (const f of fs.readdirSync(abs).sort()) walk(path.join(rel, f)); return; }
    h.update(rel.replace(/\\/g, '/'));
    h.update(fs.readFileSync(abs));
  };
  entries.forEach(walk);
  return h.digest('hex');
}

const gitPercent = (line) => {
  const m = line.match(/^(?:remote: )?(Counting|Compressing|Receiving|Resolving|Updating files|Checking out files)[^:]*:\s+(\d+)%/);
  if (!m) return null;
  // Receiving and resolving are the slow parts; weight them more
  const share = { Counting: [0, 0.05], Compressing: [0.05, 0.1], Receiving: [0.1, 0.8], Resolving: [0.8, 0.95], 'Updating files': [0.95, 1], 'Checking out files': [0.95, 1] }[m[1]];
  return share[0] + (share[1] - share[0]) * (Number(m[2]) / 100);
};

// Progress that only moves forward even when the plan grows (an update turns up more work): new steps share the
// part of the bar that is still left.
export function createProgress(report) {
  let base = 0, plan = [], current = null, frac = 0, pct = 0;
  const emit = (label) => {
    const total = plan.reduce((a, s) => a + s.weight, 0) || 1;
    const done = plan.filter((s) => s.done).reduce((a, s) => a + s.weight, 0) + (current ? current.weight * frac : 0);
    pct = Math.min(100, Math.max(pct, base + (100 - base) * (done / total)));
    report({ percent: Math.floor(pct), label });
  };
  return {
    // Replaces the steps still to come (weights are relative)
    plan(steps) { base = pct; plan = steps.map(([id, weight]) => ({ id, weight, done: false })); current = null; frac = 0; },
    start(id, label) { current = plan.find((s) => s.id === id); frac = 0; emit(label); },
    step(fraction, label) { frac = Math.max(frac, Math.min(1, fraction)); emit(label); },
    finish(label) { if (current) current.done = true; current = null; frac = 0; emit(label); },
    get percent() { return Math.floor(pct); },
  };
}

export async function update({ appDir, statePath, progress, log = () => {}, skipGit = false }) {
  const repoDir = path.resolve(appDir, '..');
  const state = (() => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; } })();
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const notes = [];

  // 1. Is there a newer version on GitHub?
  const isRepo = !skipGit && fs.existsSync(path.join(repoDir, '.git'));
  progress.plan([['check', 1], ['pull', 0], ['install', 0], ['build', 0], ['start', 0.4]]);
  let behind = 0;
  if (isRepo) {
    progress.start('check', 'Checking for updates…');
    const fetched = await run('git', ['fetch', '--progress', 'origin'], { cwd: repoDir, onLine: (l) => { const f = gitPercent(l); if (f != null) progress.step(f, 'Checking for updates…'); } });
    if (fetched.code !== 0) {
      notes.push('Could not reach GitHub, opening the installed version.');
      log(`git fetch failed: ${fetched.out.trim().slice(-300)}`);
    } else {
      const count = await run('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: repoDir });
      behind = Number(count.out.trim()) || 0;
    }
    progress.finish(behind ? `Update found: ${behind} new change${behind === 1 ? '' : 's'}` : 'Up to date');
  } else {
    progress.start('check', 'Checking your copy…');
    progress.finish('Not installed from GitHub, updates are off');
  }

  // 2. Download the update
  const needsInstall = () => !fs.existsSync(path.join(appDir, 'node_modules', 'vite')) || state.lockHash !== hashPaths(appDir, ['package-lock.json']);
  const needsBuild = () => !fs.existsSync(path.join(appDir, 'dist', 'index.html')) || state.buildHash !== hashPaths(appDir, BUILD_INPUTS);
  if (behind) {
    progress.plan([['pull', 2], ['install', needsInstall() ? 6 : 0], ['build', 5], ['start', 0.4]]);
    // The fetch above already downloaded it; this puts the installed copy exactly on the new version. The install
    // is managed by QuantBot (your data lives in the ignored data/ folder), so a changed or stray tracked file can
    // never block updates.
    progress.start('pull', 'Installing the update…');
    const applied = await run('git', ['reset', '--hard', '@{u}'], { cwd: repoDir });
    if (applied.code !== 0) {
      notes.push('The update could not be applied, opening the installed version.');
      log(`git reset failed: ${applied.out.trim().slice(-300)}`);
    }
    progress.finish('Update installed');
  }

  // 3. Packages, only when package-lock.json changed (or they're missing)
  const install = needsInstall();
  const build = needsBuild();
  progress.plan([['install', install ? 6 : 0], ['build', build ? 5 : 0], ['start', 0.4]]);
  if (install) {
    const lock = JSON.parse(fs.readFileSync(path.join(appDir, 'package-lock.json'), 'utf8'));
    const total = Object.keys(lock.packages || {}).filter((k) => k.startsWith('node_modules/')).length || 1;
    let fetchedCount = 0;
    progress.start('install', 'Installing packages…');
    const res = await run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=http'], {
      cwd: appDir,
      onLine: (l) => {
        if (/\bhttp fetch GET 200\b/.test(l)) {
          fetchedCount++;
          progress.step(fetchedCount / total, `Installing packages… ${Math.min(fetchedCount, total)} of ${total}`);
        }
      },
    });
    if (res.code !== 0) throw new Error(`Installing packages failed. Check your internet connection and try again.\n${res.out.trim().slice(-400)}`);
    state.lockHash = hashPaths(appDir, ['package-lock.json']);
    save();
    progress.finish('Packages installed');
  }

  // 4. Build the UI, only when its source changed
  if (build) {
    progress.start('build', 'Building QuantBot…');
    const expected = state.buildModules || 2700;
    let seen = 0;
    // The Vite that was just installed (it may be newer than when QuantBot started)
    const { build: viteBuild } = await import(pathToFileURL(path.join(appDir, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
    await viteBuild({
      root: appDir,
      logLevel: 'silent',
      plugins: [{
        name: 'quantbot-build-progress',
        transform() {
          seen++;
          if (seen % 25 === 0) progress.step(Math.min(0.97, seen / expected), 'Building QuantBot…');
          return null;
        },
      }],
    });
    state.buildModules = seen;
    state.buildHash = hashPaths(appDir, BUILD_INPUTS);
    save();
    progress.finish('Built');
  }

  return { notes, updated: behind > 0 };
}

// "1.0.0 · a1b2c3d · 2026-10-14", or just the package version outside a git checkout
export async function versionInfo(appDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const repoDir = path.resolve(appDir, '..');
  if (!fs.existsSync(path.join(repoDir, '.git'))) return { version: pkg.version, commit: null, date: null };
  const res = await run('git', ['log', '-1', '--format=%h %cI'], { cwd: repoDir });
  const [commit, date] = res.out.trim().split(' ');
  return { version: pkg.version, commit: commit || null, date: date ? date.slice(0, 10) : null };
}

// How many changes GitHub has that this copy doesn't (fetches first); null when it can't tell
export async function checkForUpdates(appDir) {
  const repoDir = path.resolve(appDir, '..');
  if (!fs.existsSync(path.join(repoDir, '.git'))) return null;
  const fetched = await run('git', ['fetch', 'origin'], { cwd: repoDir });
  if (fetched.code !== 0) return null;
  const count = await run('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: repoDir });
  return count.code === 0 ? Number(count.out.trim()) || 0 : null;
}
