// Provider-agnostic model calls with the trader's own key.
import { callClaude } from './claude.js';
import { callGemini } from './gemini.js';
import { callOllama } from './ollama.js';

export const PROVIDER_NAMES = { anthropic: 'Anthropic', google: 'Google Gemini', local: 'Local model' };

// Same defaults as src/lib/models.js
export const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', google: 'gemini-3.8-flash' };

// Older Claude ids stay so chats and settings saved with them keep working
const MODEL_PROVIDERS = {
  'claude-opus-5-5': 'anthropic',
  'claude-sonnet-5-5': 'anthropic',
  'claude-haiku-5-5': 'anthropic',
  local: 'local',
  'claude-opus-5': 'anthropic',
  'claude-sonnet-4-5': 'anthropic',
  'claude-opus-4-1': 'anthropic',
  'claude-haiku-4-5': 'anthropic',
  'gemini-4-argon': 'google',
  'gemini-3.1-pro-preview': 'google',
  'gemini-3.8-flash': 'google',
};

// Provider for a model id, or null for the built-in model / unknown ids
export const providerOf = (model) => MODEL_PROVIDERS[model] || null;

// Merge consecutive same-role turns and start with a user turn (required by Claude and Gemini)
export function toTurns(history) {
  const out = [];
  for (const m of history) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// apiKey is the key for Claude / Gemini; for the local provider it is { url, model } from Settings
export function callModel(provider, apiKey, model, system, messages, maxTokens) {
  if (provider === 'local') return callOllama(apiKey.url, apiKey.model, system, messages, maxTokens);
  if (provider === 'google') return callGemini(apiKey, model, system, messages);
  return callClaude(apiKey, model, system, messages, maxTokens);
}