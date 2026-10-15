// The public link for TradingView alerts. TradingView sends webhooks from its own servers, which can't reach this PC,
// so QuantBot runs Cloudflare's free quick tunnel (cloudflared, downloaded from Cloudflare's GitHub releases the first
// time it's turned on). It gives an https://<random>.trycloudflare.com address that forwards to QuantBot's local
// server; only /hook/<key> answers through it. The address changes each time the tunnel starts.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
const BINARIES = { 'win32-x64': 'cloudflared-windows-amd64.exe', 'linux-x64': 'cloudflared-linux-amd64', 'linux-arm64': 'cloudflared-linux-arm64' };
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

// binDir: where cloudflared is kept; port(): QuantBot's local port; fetch: a fetch that follows redirects
export function createTunnel({ binDir, port, fetch, log = () => {} }) {
  const asset = BINARIES[`${process.platform}-${process.arch}`];
  const bin = asset && path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  let proc = null, state = 'off', url = '', error = '', starting = null;
  const status = () => ({ available: !!asset, state, url, error });

  async function download() {
    if (fs.existsSync(bin)) return;
    state = 'downloading';
    log('public link: downloading cloudflared from Cloudflare');
    const res = await fetch(RELEASES + asset);
    if (!res.ok) throw new Error(`Couldn't download cloudflared (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 5e6) throw new Error('The cloudflared download was incomplete');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(`${bin}.part`, bytes, { mode: 0o755 });
    fs.renameSync(`${bin}.part`, bin);
  }

  async function start() {
    if (!asset) return { ...status(), error: 'The public link needs Windows (64-bit) or Linux' };
    if (state === 'on' || starting) return starting || status();
    error = '';
    starting = (async () => {
      try {
        await download();
        state = 'starting';
        url = '';
        proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port()}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const child = proc;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Cloudflare didn't give a link within 45 seconds. Check the internet connection and try again.")), 45000);
          let found = false;
          const read = (chunk) => {
            const text = String(chunk);
            const m = text.match(URL_RE);
            if (m && !url) { url = m[0]; found = true; }
            // The link answers once the first connection to Cloudflare is registered
            if (found && /Registered tunnel connection/i.test(text)) { clearTimeout(timer); resolve(); }
          };
          child.stdout.on('data', read);
          child.stderr.on('data', read);
          child.on('error', (e) => { clearTimeout(timer); reject(e); });
          child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`cloudflared stopped (exit code ${code})`)); });
        });
        state = 'on';
        log(`public link: ${url}`);
        child.removeAllListeners('exit');
        child.on('exit', (code) => {
          if (proc !== child) return;
          proc = null; state = 'off'; url = '';
          error = `The public link closed (cloudflared exit code ${code}). Turn it on again.`;
          log(`public link: ${error}`);
        });
      } catch (e) {
        error = e.message;
        state = 'off';
        url = '';
        log(`public link failed: ${e.message}`);
        proc?.kill();
        proc = null;
      } finally {
        starting = null;
      }
      return status();
    })();
    return starting;
  }

  function stop() {
    const child = proc;
    proc = null;
    state = 'off';
    url = '';
    error = '';
    child?.kill();
    return status();
  }

  return { status, start, stop };
}
