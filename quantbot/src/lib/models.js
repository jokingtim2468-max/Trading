export const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', short: 'Anthropic', family: 'Claude', prefix: 'sk-ant-' },
  google: { name: 'Google (Gemini)', short: 'Google Gemini', family: 'Gemini', prefix: 'AIza' },
};

// Local only: QuantBot runs everything on the local model (Ollama) set up in Settings
export const MODELS = [
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

// Every tool uses the local model
export function defaultModel() {
  return 'local';
}

export const GROUPS = [
  { value: 'MT5', label: 'MT5' },
  { value: 'Pine', label: 'Pine' },
];