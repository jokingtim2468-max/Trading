export const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', short: 'Anthropic', family: 'Claude', prefix: 'sk-ant-' },
  google: { name: 'Google (Gemini)', short: 'Google Gemini', family: 'Gemini', prefix: 'AIza' },
};

export const MODELS = [
  // "Auto" runs your default model: Claude if an Anthropic key is linked, then Gemini, then your local model
  { id: 'builtin', label: 'Auto (your default model)', provider: null },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', provider: 'google' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'google' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'google' },
  { id: 'local', label: 'Local model (Ollama)', provider: 'local' },
];

// Provider whose key the chosen model needs but isn't linked yet (null when ready or still loading).
// The local model has no key; it is set up in Settings and the server says so if it isn't.
export function missingKey(modelId, status) {
  const provider = MODELS.find((m) => m.id === modelId)?.provider;
  return provider && provider !== 'local' && status && !status[provider]?.linked ? provider : null;
}

export const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', google: 'gemini-3.8-flash' };

// A saved model id that is no longer offered falls back to the default
export const knownModel = (id, fallback) => (MODELS.some((m) => m.id === id) ? id : fallback);

// Tester default: your Claude model when an Anthropic key is linked, your Gemini model when only Google is linked,
// your local model when neither is
export function defaultModel(status, user) {
  if (!status?.anthropic?.linked && status?.google?.linked) return knownModel(user?.default_gemini_model, DEFAULT_MODELS.google);
  if (!status?.anthropic?.linked && user?.ollama_model) return 'local';
  return knownModel(user?.default_claude_model, DEFAULT_MODELS.anthropic);
}

export const GROUPS = [
  { value: 'MT5', label: 'MT5' },
  { value: 'Pine', label: 'Pine' },
];