import { client } from '@/api/client';

const { ChatSession, ChatMessage } = client.entities;

export async function loadSessions(userId, group) {
  const query = { created_by_id: userId };
  if (group) query.group = group;
  const page = await ChatSession.filter(query, { sort: '-last_message_at', limit: 50 });
  return page.items;
}

export async function loadMessages(sessionId) {
  const page = await ChatMessage.filter({ session_id: sessionId }, { sort: 'created_date', limit: 200 });
  return page.items.filter((m) => !m.hidden);
}

export const createSession = (title, group) =>
  ChatSession.create({ title, group: group || 'MT5', last_message_at: new Date().toISOString() });

export const setSessionGroup = (id, group) => ChatSession.update(id, { group });

export const renameSession = (id, title) => ChatSession.update(id, { title });

export const addUserMessage = (sessionId, content) =>
  ChatMessage.create({ session_id: sessionId, role: 'user', content });

// The new chat's system prompt goes to the model first; it answers OK when it read it -> { status: 'ok' | 'failed', reply }
export async function handshake(sessionId, style) {
  return (await client.functions.invoke('chatHandshake', { session_id: sessionId, style })).data;
}

// Start the server answering the chat in the background -> { replying }
export const startReply = async (sessionId, style, model) => (await client.functions.invoke('chatSend', { session_id: sessionId, style, model })).data;
// -> { replying, error, prompt_status, prompt_reply }
export const replyStatus = async (sessionId) => (await client.functions.invoke('chatStatus', { session_id: sessionId })).data;

export async function askQuantAI(sessionId, style, model) {
  const res = await client.functions.invoke('quantChat', { session_id: sessionId, style, model });
  return res.data.message;
}

// API keys: encrypted and decrypted only on the server
const keys = async (payload) => (await client.functions.invoke('apiKeys', payload)).data;
// Each returns the status of every provider: { anthropic: {linked, last4}, google: {linked, last4} }
export const getKeyStatus = () => keys({ action: 'status' });
export const saveKey = (provider, apiKey) => keys({ action: 'save', provider, api_key: apiKey });
export const removeKey = (provider) => keys({ action: 'remove', provider });

export async function deleteSession(id) {
  await ChatMessage.deleteMany({ session_id: id });
  await ChatSession.delete(id);
}

export function exportMarkdown(title, messages) {
  const md = `# ${title}\n\n` + messages
    .map((m) => `### ${m.role === 'user' ? 'Trader' : 'QuantBot'}\n\n${m.content}`)
    .join('\n\n---\n\n');
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, '').trim() || 'chat'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}