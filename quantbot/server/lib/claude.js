// QUANTBOT_ANTHROPIC_URL points calls at another server (the end-to-end tests use a fake one)
export async function callClaude(apiKey, model, system, messages, maxTokens = 8192) {
  const res = await fetch(`${process.env.QUANTBOT_ANTHROPIC_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(270000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${data.error?.message || res.status}`);
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}