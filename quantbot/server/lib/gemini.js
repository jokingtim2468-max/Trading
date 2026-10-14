// QUANTBOT_GEMINI_URL points calls at another server (the end-to-end tests use a fake one)
// messages: [{role:'user'|'assistant', content}] with alternating roles, starting with 'user'
const MAX_TOOL_ROUNDS = 10;

// tools: { defs, run(name, input) -> text } lets Gemini read the trader's tests and market data before answering
export async function callGemini(apiKey, model, system, messages, tools = null) {
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  for (let round = 0; ; round++) {
    const useTools = tools && round < MAX_TOOL_ROUNDS;
    const candidate = await request(apiKey, model, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 65536 },
      ...(tools ? { tools: [{ functionDeclarations: tools.defs.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
      ...(tools && !useTools ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } } : {}),
    });
    const parts = candidate?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!useTools || !calls.length) {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      if (!text) throw new Error(`Gemini returned no text (${candidate?.finishReason || 'empty reply'}).`);
      return text;
    }
    // The model's turn goes back unchanged (it carries thought signatures), followed by one answer per call
    contents.push(candidate.content);
    const responses = [];
    for (const p of calls) {
      responses.push({ functionResponse: { name: p.functionCall.name, response: { result: await tools.run(p.functionCall.name, p.functionCall.args) } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
}

async function request(apiKey, model, body) {
  const base = process.env.QUANTBOT_GEMINI_URL || 'https://generativelanguage.googleapis.com';
  const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(270000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini API: ${data.error?.message || res.status}`);
  if (!data.candidates?.[0]) throw new Error(`Gemini returned no reply (${data.promptFeedback?.blockReason || 'empty reply'}).`);
  return data.candidates[0];
}
