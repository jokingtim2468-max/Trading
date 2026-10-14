// QUANTBOT_ANTHROPIC_URL points calls at another server (the end-to-end tests use a fake one)
// Opus 5.5 and Sonnet 5.5 requests opt into server-side fallback: if a safety check declines the request,
// Anthropic retries it on another model in the same call instead of returning nothing.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const MAX_TOOL_ROUNDS = 10;

// tools: { defs, run(name, input) -> text } lets Claude read the trader's tests and market data before answering
export async function callClaude(apiKey, model, system, messages, maxTokens = 8192, tools = null) {
  const turns = [...messages];
  for (let round = 0; ; round++) {
    // After the last round the tools stay listed (the history refers to them) but Claude must answer
    const useTools = tools && round < MAX_TOOL_ROUNDS;
    const data = await request(apiKey, model, {
      system, messages: turns, max_tokens: maxTokens,
      ...(tools ? { tools: tools.defs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      ...(tools && !useTools ? { tool_choice: { type: 'none' } } : {}),
    });
    const calls = data.content.filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !calls.length || !useTools) return replyText(data);
    turns.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const c of calls) results.push({ type: 'tool_result', tool_use_id: c.id, content: await tools.run(c.name, c.input) });
    turns.push({ role: 'user', content: results });
  }
}

async function request(apiKey, model, body) {
  const fallback = FALLBACK_MODELS.has(model);
  const res = await fetch(`${process.env.QUANTBOT_ANTHROPIC_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify({ model, ...body, ...(fallback ? { fallbacks: 'default' } : {}) }),
    signal: AbortSignal.timeout(600000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${data.error?.message || res.status}`);
  return data;
}

function replyText(data) {
  if (data.stop_reason === 'refusal') throw new Error(`Claude declined this request${data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.'}`);
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text && data.stop_reason === 'max_tokens') throw new Error('Claude ran out of output space before answering. Try again or pick another model.');
  return text;
}
