import { useEffect, useState } from 'react';
import { client } from '@/api/client';
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

// A saved model id that is no longer offered falls back to the default (installed Ollama models are ollama:<name>)
export const knownModel = (id, fallback) => (MODELS.some((m) => m.id === id) || String(id || '').startsWith('ollama:') ? id : fallback);

// A readable name for an Ollama model: family, size and what it's good at; "-gold" ones are trained on your data
const FAMILIES = [
  [/^qwen2\.5-coder/, 'Qwen2.5 Coder', 'coding'], [/^qwen3-coder/, 'Qwen3 Coder', 'coding'], [/^qwen3\.5/, 'Qwen3.5', 'general'], [/^qwen3/, 'Qwen3', 'general, thinks first'],
  [/^qwen2\.5/, 'Qwen2.5', 'general'], [/^deepseek-r1/, 'DeepSeek R1', 'reasoning'], [/^deepseek-coder/, 'DeepSeek Coder', 'coding'], [/^codellama/, 'Code Llama', 'coding'],
  [/^llama3\.2/, 'Llama 3.2', 'general'], [/^llama3\.1/, 'Llama 3.1', 'general'], [/^gemma3/, 'Gemma 3', 'general'], [/^phi4-mini/, 'Phi-4 mini', 'maths'], [/^phi4/, 'Phi-4', 'maths'],
  [/^mistral/, 'Mistral', 'general'], [/^gpt-oss/, 'gpt-oss', 'reasoning'],
];
export function describeOllama(name) {
  const [base, tag = 'latest'] = String(name).split(':');
  const gold = /-gold$/.test(base);
  const fam = FAMILIES.find(([re]) => re.test(base.replace(/-gold$/, '')));
  const size = tag.match(/^(\d+(?:\.\d+)?[bm])/i)?.[1]?.toUpperCase() || (tag === 'latest' ? '' : tag);
  const title = fam ? `${fam[1]}${size ? ` ${size}` : ''}` : name;
  return `${title} · ${gold ? 'trained on your data' : fam ? fam[2] : 'Ollama'}`;
}

// The menus' model list: every model installed in Ollama by name, with the one set in Settings first
let cached = null;
export function useLocalModels() {
  const [list, setList] = useState(cached || MODELS);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const me = await client.auth.me();
        const { models } = (await client.functions.invoke('localModel', { action: 'test', url: me.ollama_url || 'http://127.0.0.1:11434' })).data;
        const names = [...models].sort((a, b) => (b === me.ollama_model) - (a === me.ollama_model));
        cached = names.length ? names.map((n) => ({ id: `ollama:${n}`, label: `${describeOllama(n)}${n === me.ollama_model ? ' (default)' : ''}`, provider: 'local', name: n })) : MODELS;
        if (live) setList(cached);
      } catch { /* Ollama not running: keep the plain entry */ }
    })();
    return () => { live = false; };
  }, []);
  return list;
}

// Every tool uses the local model
export function defaultModel() {
  return 'local';
}

export const GROUPS = [
  { value: 'MT5', label: 'MT5' },
  { value: 'Pine', label: 'Pine' },
];