// Provider-agnostic model calls with the trader's own key.
import { callClaude } from './claude.js';
import { callGemini } from './gemini.js';

export const PROVIDER_NAMES = { anthropic: 'Anthropic', google: 'Google Gemini' };

// Same defaults as src/lib/models.js
export const DEFAULT_MODELS = { anthropic: 'claude-opus-5', google: 'gemini-3.8-flash' };

const MODEL_PROVIDERS = {
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

export function callModel(provider, apiKey, model, system, messages, maxTokens) {
  if (provider === 'google') return callGemini(apiKey, model, system, messages);
  return callClaude(apiKey, model, system, messages, maxTokens);
}