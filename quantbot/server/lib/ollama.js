// A model running on this PC through Ollama (https://ollama.com). Free and offline; quality depends on the model.
// The context window is set large enough for QuantBot's prompts plus a full EA (fits a 7B model on an 8 GB GPU).
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
const NUM_CTX = 32768;

export function ollamaBase(url) {
  const base = String(url || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('The Ollama address must start with http:// or https://');
  return base;
}

// If Ollama isn't answering, start it (or install it on Windows) in the background and try once more, so a chat,
// agent or /loopfix never fails just because Ollama wasn't open yet
async function request(url, init, timeoutMs, retried = false) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('The local model took too long to answer.');
    if (!retried) {
      const { ensureOllama } = await import('./ollamaSpecs.js');
      try { await ensureOllama(new URL(url).origin); } catch (why) { throw new Error(`Ollama isn't running and couldn't be started: ${why.message}`); }
      return request(url, init, timeoutMs, true);
    }
    throw new Error(`Ollama is not answering at ${new URL(url).origin}. Open the Ollama app, then try again (model: ollama pull ${DEFAULT_OLLAMA_MODEL}).`);
  }
}

// Installed model names, to check the connection from Settings
export async function listOllamaModels(url) {
  const res = await request(`${ollamaBase(url)}/api/tags`, {}, 5000);
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  return ((await res.json()).models || []).map((m) => m.name);
}

const MAX_TOOL_ROUNDS = 6;

// tools: { defs, run(name, input) -> text }. Models without tool support (Ollama answers "does not support tools")
// are asked again without them.
// onLive(text): the reply so far (thinking included) while it streams, and "Using <tool>…" during tool calls
export async function callOllama(url, model, system, messages, maxTokens = 8192, tools = null, onLive = null) {
  const turns = [{ role: 'system', content: system }, ...messages];
  let withTools = !!tools;
  for (let round = 0; ; round++) {
    const useTools = withTools && round < MAX_TOOL_ROUNDS;
    const res = await request(`${ollamaBase(url)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, stream: !!onLive, messages: turns,
        options: { num_ctx: NUM_CTX, num_predict: maxTokens },
        ...(useTools ? { tools: tools.defs.map((t) => ({ type: 'function', function: t })) } : {}),
      }),
    }, 15 * 60000);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (useTools && /does not support tools/i.test(String(data.error))) { withTools = false; continue; }
      throw new Error(`Local model: ${data.error || res.status}${res.status === 404 ? ` (run: ollama pull ${model})` : ''}`);
    }
    let message;
    if (onLive) message = await readStream(res, onLive);
    else message = (await res.json().catch(() => ({}))).message || {};
    const calls = message.tool_calls || [];
    if (useTools && calls.length) {
      turns.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
      for (const c of calls) {
        onLive?.(`Using ${c.function.name.replace(/_/g, ' ')}…`);
        turns.push({ role: 'tool', tool_name: c.function.name, content: await tools.run(c.function.name, c.function.arguments) });
      }
      continue;
    }
    // Thinking models put their reasoning in <think> tags or a separate field: the reply is what follows it
    const text = String(message.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    if (!text) throw new Error('The local model returned an empty reply.');
    return text;
  }
}

// Ollama streams one JSON object per line; returns the whole message
async function readStream(res, onLive) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', content = '', thinking = '', calls = [], last = 0;
  const show = (force) => { const now = Date.now(); if (force || now - last > 150) { last = now; onLive(thinking ? `${thinking}${content ? `\n\n${content}` : ''}` : content); } };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) buf += '\n';
    else buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new Error(`Local model: ${j.error}`);
      const m = j.message || {};
      if (m.thinking) thinking += m.thinking;
      if (m.content) content += m.content;
      if (m.tool_calls?.length) calls = calls.concat(m.tool_calls);
      show(false);
    }
    if (done) break;
  }
  show(true);
  return { content, thinking, tool_calls: calls };
}
