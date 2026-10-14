// QUANTBOT_ANTHROPIC_URL points calls at another server (the end-to-end tests use a fake one)
// Opus 5.5 and Sonnet 5.5 requests opt into server-side fallback: if a safety check declines the request,
// Anthropic retries it on another model in the same call instead of returning nothing.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export async function callClaude(apiKey, model, system, messages, maxTokens = 8192) {
  const fallback = FALLBACK_MODELS.has(model);
  const res = await fetch(`${process.env.QUANTBOT_ANTHROPIC_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, ...(fallback ? { fallbacks: 'default' } : {}) }),
    signal: AbortSignal.timeout(600000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${data.error?.message || res.status}`);
  if (data.stop_reason === 'refusal') throw new Error(`Claude declined this request${data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.'}`);
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text && data.stop_reason === 'max_tokens') throw new Error('Claude ran out of output space before answering. Try again or pick another model.');
  return text;
}
