// Skills: markdown instructions the local model loads only when a task needs them (with the load_skill tool), so a
// 7B model with 32k context gets deep, task-specific rules without carrying all of them in every system prompt.
// Built-in skills ship in server/skills/; the trader's own live in <data>/skills/ and override a built-in of the same
// name. A skill file starts with a small header:
//   ---
//   name: backtest-rules
//   description: One line saying when to load it
//   ---
//   ...the instructions...
import fs from 'node:fs';
import path from 'node:path';

const MAX_SKILL = 24000; // characters of one skill sent to the model (about 6k tokens)

export function parseSkill(text, fallbackName = '') {
  text = String(text || '').replace(/\r\n/g, '\n'); // files checked out on Windows have CRLF line ends
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  const head = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { name: (head.name || fallbackName).trim(), description: (head.description || '').trim(), body: (m ? m[2] : text).trim() };
}

export const skillName = (n) => String(n || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export function createSkills({ builtinDir, userDir }) {
  const read = (dir, source) => {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
      const s = parseSkill(fs.readFileSync(path.join(dir, f), 'utf8'), f.replace(/\.md$/, ''));
      return { ...s, name: skillName(s.name), source, file: path.join(dir, f) };
    });
  };
  function list() {
    const byName = new Map();
    for (const s of [...read(builtinDir, 'built-in'), ...read(userDir, 'yours')]) byName.set(s.name, s);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const get = (name) => list().find((s) => s.name === skillName(name)) || null;
  function save({ name, description, body }) {
    const n = skillName(name);
    if (!n) throw new Error('Give the skill a name (letters, numbers and -)');
    if (!String(description || '').trim()) throw new Error('Add a one-line description: the model reads it to decide when to load the skill');
    fs.mkdirSync(userDir, { recursive: true });
    const text = `---\nname: ${n}\ndescription: ${String(description).replace(/\n/g, ' ').trim()}\n---\n\n${String(body || '').trim()}\n`;
    fs.writeFileSync(path.join(userDir, `${n}.md`), text);
    return get(n);
  }
  function remove(name) {
    const f = path.join(userDir, `${skillName(name)}.md`);
    if (!fs.existsSync(f)) throw new Error('Only your own skills can be deleted (built-in ones can be overridden by saving one with the same name)');
    fs.unlinkSync(f);
  }
  // The short index that goes in the system prompt: one line per skill
  const index = () => list().map((s) => `- ${s.name}: ${s.description}`).join('\n');
  // The load_skill tool's answer
  function load(name) {
    const s = get(name);
    if (!s) return JSON.stringify({ error: `No skill named "${name}". Skills: ${list().map((x) => x.name).join(', ')}` });
    return s.body.length > MAX_SKILL ? `${s.body.slice(0, MAX_SKILL)}\n... [skill cut at ${MAX_SKILL} characters]` : s.body;
  }
  return { list, get, save, remove, index, load };
}
