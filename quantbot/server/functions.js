// The app's AI features, run on this PC with the trader's own Claude / Gemini key.
import { providerOf, toTurns, callModel, PROVIDER_NAMES, DEFAULT_MODELS } from './lib/modelCall.js';
import { chatSystem, chatHistory, scriptNameOf } from './lib/chatPrompt.js';
import { CONVERTER_SYSTEM, converterInputError, converterTask, converterResult } from './lib/converterPrompt.js';
import { TESTER_SYSTEM, testerInputError, testerTask, testerResult } from './lib/testerPrompt.js';
import { parseJsonReply } from './lib/simContract.js';
import { keyError } from './lib/keyRules.js';

const fail = (message) => { throw new Error(message); };

export function createFunctions({ db, user, keys }) {
  // There is no built-in model: "builtin" means your default model for whichever key is linked
  function pickModel(model) {
    if (model && model !== 'builtin') return model;
    const me = user.me();
    if (keys.get('anthropic')) return me.default_claude_model || DEFAULT_MODELS.anthropic;
    if (keys.get('google')) return me.default_gemini_model || DEFAULT_MODELS.google;
    return fail('Add a Claude or Gemini API key in Settings to use QuantBot.');
  }

  async function ask(model, system, messages, maxTokens) {
    const id = pickModel(model);
    const provider = providerOf(id) || fail('Unknown model');
    const apiKey = keys.get(provider) || fail(`No ${PROVIDER_NAMES[provider]} API key linked. Add one in Settings.`);
    return callModel(provider, apiKey, id, system, messages, maxTokens);
  }

  return {
    apiKeys({ action, provider, api_key }) {
      if (action === 'status') return keys.status();
      if (action === 'save') {
        const key = String(api_key || '').trim();
        const invalid = keyError(provider, key);
        if (invalid) fail(invalid);
        keys.set(provider, key);
        return keys.status();
      }
      if (action === 'remove') {
        keys.remove(provider);
        return keys.status();
      }
      return fail('Unknown action');
    },

    async quantChat({ session_id, style, model }) {
      const session = db.run('ChatSession', 'get', session_id);
      const recent = db.run('ChatMessage', 'filter', { session_id }, { sort: '-created_date', limit: 20 }).items.reverse();
      const system = chatSystem(session.group, style, user.me().full_name);
      const reply = String(await ask(model, system, toTurns(chatHistory(recent))));
      const message = db.run('ChatMessage', 'create', { session_id, role: 'assistant', content: reply });
      const name = scriptNameOf(reply);
      db.run('ChatSession', 'update', session_id, {
        last_message_at: new Date().toISOString(),
        ...(name && name !== session.title ? { title: name } : {}),
      });
      return { message };
    },

    async strategyTester(body) {
      const invalid = converterInputError(body);
      if (invalid) fail(invalid);
      const text = await ask(body.model, CONVERTER_SYSTEM, [{ role: 'user', content: converterTask(body) }], 20000);
      return converterResult(parseJsonReply(text));
    },

    async scriptTester(body) {
      const invalid = testerInputError(body);
      if (invalid) fail(invalid);
      const text = await ask(body.model, TESTER_SYSTEM, [{ role: 'user', content: testerTask(body) }], 16000);
      return testerResult(parseJsonReply(text)) || fail('The model could not translate this script. Try again.');
    },
  };
}