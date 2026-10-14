export const KEY_PROVIDERS = {
  anthropic: { prefix: 'sk-ant-', name: 'Anthropic' },
  google: { prefix: 'AIza', name: 'Google Gemini' },
};

// Why a key can't be saved, or null when it looks right
export function keyError(provider, key) {
  const rule = KEY_PROVIDERS[provider];
  if (!rule) return 'Unknown provider';
  if (!key.startsWith(rule.prefix) || key.length > 300) return `That does not look like a valid ${rule.name} API key.`;
  return null;
}