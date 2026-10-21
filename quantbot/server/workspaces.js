// Chat workspaces: every chat gets its own folder, data/workspaces/<chat name>/, named by the model from the first
// message (no path to pick in Settings). Scripts the AI writes in that chat are saved into its scripts/ folder.
import fs from 'node:fs';
import path from 'node:path';

const slug = (s) => String(s || 'chat').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'chat';

// A model reply -> a clean chat title, or null when it isn't one (code, an essay, nothing)
export function cleanTitle(reply) {
  const t = String(reply || '').replace(/```[\s\S]*?```/g, '').trim().split('\n')[0]
    .replace(/^\s*(\/\/\s*)?(script|title|chat)\s*:\s*/i, '').replace(/["'`*#_]/g, '').replace(/[.!?:;,\s]+$/, '').trim();
  return t.length >= 2 && t.length <= 60 ? t : null;
}

export function createWorkspaces(root) {
  const inside = (dir) => { const full = path.resolve(dir); return full.startsWith(path.resolve(root) + path.sep) ? full : null; };
  return {
    root,
    // A fresh folder named after the chat (a number is added when that name is already taken)
    create(title, sessionId) {
      fs.mkdirSync(root, { recursive: true });
      const base = slug(title);
      let name = base;
      for (let n = 2; fs.existsSync(path.join(root, name)); n++) name = `${base}-${n}`;
      const dir = path.join(root, name);
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'README.md'), `# ${title}\n\nWorkspace of the QuantBot chat "${title}" (${sessionId}).\nScripts the AI writes in this chat are saved in scripts/; put notes, data or results next to them.\n`);
      return dir;
    },
    // The newest version of a script from the chat, saved as scripts/<name>.mq5 / .pine (only inside the root)
    saveScript(dir, found, name) {
      const ws = inside(dir);
      if (!ws || !found?.code) return null;
      const file = path.join(ws, 'scripts', `${slug(name || 'script')}.${found.language === 'MT5' ? 'mq5' : 'pine'}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, found.code);
      return file;
    },
  };
}
