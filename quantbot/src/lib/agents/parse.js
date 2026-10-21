// An agent's reply -> its one command: { cmd, arg, code } (WRITE's file is the first fenced code block after it).
// Small local models often add a sentence first or wrap the command in backticks, so the first line that starts
// with a command word counts.
const CMDS = ['LIST', 'READ', 'WRITE', 'DELETE', 'BACKTEST', 'DONE'];

export function parseCommand(reply) {
  const text = String(reply || '').replace(/\r/g, '');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*[`*>#-]*\s*(LIST|READ|WRITE|DELETE|BACKTEST|DONE)\b[`*:]*\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const cmd = m[1];
    const arg = m[2].replace(/[`*]+$/g, '').trim();
    if (cmd === 'WRITE') {
      const rest = lines.slice(i + 1).join('\n');
      const block = /```[^\n]*\n([\s\S]*?)```/.exec(rest);
      return { cmd, arg, code: block ? block[1] : null };
    }
    return { cmd, arg: cmd === 'DONE' ? [arg, ...lines.slice(i + 1)].join('\n').trim() : arg };
  }
  return null;
}

export const COMMANDS = CMDS;
