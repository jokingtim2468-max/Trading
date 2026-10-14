// QUANTBOT_GEMINI_URL points calls at another server (the end-to-end tests use a fake one)
// messages: [{role:'user'|'assistant', content}] with alternating roles, starting with 'user'
export async function callGemini(apiKey, model, system, messages) {
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const base = process.env.QUANTBOT_GEMINI_URL || 'https://generativelanguage.googleapis.com';
  const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 65536 },
    }),
    signal: AbortSignal.timeout(270000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini API: ${data.error?.message || res.status}`);
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text) throw new Error(`Gemini returned no text (${candidate?.finishReason || data.promptFeedback?.blockReason || 'empty reply'}).`);
  return text;
}