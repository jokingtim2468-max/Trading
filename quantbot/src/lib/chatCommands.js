// Commands typed in the chat that QuantBot handles itself: they never go to the model
export const COMMANDS = [
  { name: 'context', args: '', about: 'What the model sees on your next message, in tokens, against its window' },
  { name: 'tools', args: '[name on|off]', about: 'The tools the model can use; turn them on or off' },
  { name: 'model', args: '<name>', about: 'Switch the model for this chat (e.g. /model qwen3:8b)' },
  { name: 'prompt', args: '', about: 'Did the model confirm the system prompt? Sends it again if not' },
  { name: 'workspace', args: '', about: "This chat's folder and the scripts saved in it" },
  { name: 'new', args: '', about: 'Start a new chat' },
  { name: 'loopfix', args: '<script> | stop', about: 'Backtest and rewrite a copy trading script every 10 minutes' },
  { name: 'help', args: '', about: 'This list' },
];

// "/tools rsi off" -> { name: 'tools', rest: 'rsi off' }; anything else -> null
export function parseCommand(text) {
  const m = /^\/([a-z]+)\b\s*(.*)$/is.exec(String(text).trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  return COMMANDS.some((c) => c.name === name) ? { name, rest: m[2].trim() } : null;
}
