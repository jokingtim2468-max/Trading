import { client } from '@/api/client';

const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;

// MT5 vs Pine from the fence language or the code itself
function languageOf(lang, code) {
  if (/pine/i.test(lang) || /\/\/\s*@version\s*=\s*\d/.test(code)) return 'Pine';
  if (/mql|mq5|cpp|c\+\+/i.test(lang) || /#property|OnTick\s*\(|OnInit\s*\(/.test(code)) return 'MT5';
  if (/\b(strategy|indicator)\s*\(/.test(code)) return 'Pine';
  return null;
}

// Largest MT5 / Pine code block in a message (the full script), or null
export function scriptFromMessage(content) {
  let best = null;
  for (const [, lang, code] of content.matchAll(FENCE)) {
    const language = languageOf(lang, code);
    if (language && (!best || code.length > best.code.length)) best = { code: code.trim(), language };
  }
  return best;
}

// Script from the newest QuantBot reply in the chat that contains one
export async function latestScript(sessionId) {
  const page = await client.entities.ChatMessage.filter({ session_id: sessionId, role: 'assistant' }, { sort: '-created_date', limit: 20 });
  for (const m of page.items) {
    const script = scriptFromMessage(m.content);
    if (script) return { ...script, messageId: m.id, at: m.created_date };
  }
  return null;
}