// Gets the desktop app's files ready before Electron runs or packages it: builds the UI (../dist) and copies the
// bundled fonts next to the loading screen. electron-builder then packs ../server, ../dist and the fonts into the app.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

if (!process.argv.includes('--no-build')) {
  console.log('Building the QuantBot UI...');
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
}
const fonts = path.join(here, 'fonts');
fs.rmSync(fonts, { recursive: true, force: true });
fs.mkdirSync(fonts);
for (const f of fs.readdirSync(path.join(root, 'public', 'fonts'))) fs.copyFileSync(path.join(root, 'public', 'fonts', f), path.join(fonts, f));
console.log('Staged.');
