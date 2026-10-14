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

async function request(url, init, timeoutMs) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('The local model took too long to answer.');
    throw new Error(`Ollama is not running at ${new URL(url).origin}. Install it from ollama.com, then run: ollama pull ${DEFAULT_OLLAMA_MODEL}`);
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
export async function callOllama(url, model, system, messages, maxTokens = 8192, tools = null) {
  const turns = [{ role: 'system', content: system }, ...messages];
  let withTools = !!tools;
  for (let round = 0; ; round++) {
    const useTools = withTools && round < MAX_TOOL_ROUNDS;
    const res = await request(`${ollamaBase(url)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, messages: turns,
        options: { num_ctx: NUM_CTX, num_predict: maxTokens },
        ...(useTools ? { tools: tools.defs.map((t) => ({ type: 'function', function: t })) } : {}),
      }),
    }, 15 * 60000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok && useTools && /does not support tools/i.test(String(data.error))) {
      withTools = false;
      continue;
    }
    if (!res.ok) throw new Error(`Local model: ${data.error || res.status}${res.status === 404 ? ` (run: ollama pull ${model})` : ''}`);
    const calls = data.message?.tool_calls || [];
    if (useTools && calls.length) {
      turns.push(data.message);
      for (const c of calls) turns.push({ role: 'tool', tool_name: c.function.name, content: await tools.run(c.function.name, c.function.arguments) });
      continue;
    }
    const text = data.message?.content || '';
    if (!text) throw new Error('The local model returned an empty reply.');
    return text;
  }
}
