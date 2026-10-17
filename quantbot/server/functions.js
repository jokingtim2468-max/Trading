// The app's AI features, run on this PC with the trader's own Claude / Gemini key.
import { providerOf, toTurns, callModel, PROVIDER_NAMES, DEFAULT_MODELS } from './lib/modelCall.js';
import { chatSystem, chatHistory, scriptNameOf } from './lib/chatPrompt.js';
import { CONVERTER_SYSTEM, converterInputError, converterTask, converterResult } from './lib/converterPrompt.js';
import { TESTER_SYSTEM, testerInputError, testerTask, testerResult } from './lib/testerPrompt.js';
import { parseJsonReply } from './lib/simContract.js';
import { keyError } from './lib/keyRules.js';
import { createChatTools } from './lib/chatTools.js';
import { listOllamaModels, ollamaBase, DEFAULT_OLLAMA_URL } from './lib/ollama.js';
import { codeFromReply } from './scriptFolders.js';

const fail = (message) => { throw new Error(message); };

// System prompt part for a script's own Claude chat: its folder context and current code
function scriptBrief(script, context) {
  return [
    `LINKED SCRIPT: this chat writes and changes the copy trading script "${script.name}" (${script.language}). Its accounts copy the script's QuantBot signal alerts, so keep every buy / sell / set_sl / set_tp / close message in the code.`,
    'When you change it, reply with the whole script in ONE code block: QuantBot saves it as the script\'s new code and in its folder. Use the copy_trading_* tools for its live results, log and trades before changing it, and say what evidence a change is based on.',
    context ? `Script folder (CLAUDE.md):\n${context.slice(0, 6000)}` : '',
    script.code ? `Current code:\n\`\`\`${script.language === 'MT5' ? 'mql5' : 'pine'}\n${script.code.slice(0, 30000)}\n\`\`\`` : 'No code yet: write the first version.',
  ].filter(Boolean).join('\n\n');
}

export function createFunctions({ db, user, keys, market, folders = () => null }) {
  const chatTools = createChatTools({ db, market });
  // There is no built-in model: "builtin" means your default model for whichever key is linked
  function pickModel(model) {
    if (model && model !== 'builtin') return model;
    const me = user.me();
    if (keys.get('anthropic')) return me.default_claude_model || DEFAULT_MODELS.anthropic;
    if (keys.get('google')) return me.default_gemini_model || DEFAULT_MODELS.google;
    if (me.ollama_model) return 'local';
    return fail('Add a Claude or Gemini API key, or set up a local model, in Settings to use QuantBot.');
  }

  function credentials(provider) {
    if (provider === 'local') {
      const me = user.me();
      if (!me.ollama_model) fail('Set up your local model in Settings first.');
      return { url: me.ollama_url || DEFAULT_OLLAMA_URL, model: me.ollama_model };
    }
    if (keys.unreadable(provider)) fail(`Your saved ${PROVIDER_NAMES[provider]} API key can't be read (it was saved by an older version of QuantBot). Add it again in Settings.`);
    return keys.get(provider) || fail(`No ${PROVIDER_NAMES[provider]} API key linked. Add one in Settings.`);
  }

  async function ask(model, system, messages, maxTokens, tools) {
    const id = pickModel(model);
    const provider = providerOf(id) || fail('Unknown model');
    return callModel(provider, credentials(provider), id, system, messages, maxTokens, tools);
  }

  const fns = {
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

    // Local model settings: test the Ollama address (lists installed models) or save address and model
    async localModel({ action, url, model }) {
      if (action === 'test') return { models: await listOllamaModels(url) };
      if (action === 'save') {
        const name = String(model || '').trim();
        return user.update({ ollama_url: ollamaBase(url), ollama_model: name });
      }
      return fail('Unknown action');
    },

    async quantChat({ session_id, style, model }) {
      const session = db.run('ChatSession', 'get', session_id);
      const recent = db.run('ChatMessage', 'filter', { session_id }, { sort: '-created_date', limit: 20 }).items.reverse();
      // A copy trading script's chat: Claude only, with the script's folder context (CLAUDE.md) and code
      let script = null;
      if (session.script_id) { try { script = db.run('Script', 'get', session.script_id); } catch { /* script deleted */ } }
      if (script && !keys.get('anthropic')) fail('Scripts are written with Claude only. Add your Anthropic (Claude) API key in Settings.');
      const useModel = script && !String(model || '').startsWith('claude-') ? user.me().default_claude_model || DEFAULT_MODELS.anthropic : model;
      const linked = script ? scriptBrief(script, await folders()?.brief(script)) : session.bot_name ? chatTools.testBrief(session.bot_name) : '';
      const system = chatSystem(session.group, style, user.me().full_name, { linked, today: new Date().toISOString().slice(0, 10) });
      const reply = String(await ask(useModel, system, toTurns(chatHistory(recent)), 16000, chatTools));
      const message = db.run('ChatMessage', 'create', { session_id, role: 'assistant', content: reply });
      const name = scriptNameOf(reply);
      db.run('ChatSession', 'update', session_id, {
        last_message_at: new Date().toISOString(),
        ...(!script && name && name !== session.title ? { title: name } : {}),
      });
      // New code in the reply becomes the script's code (and its folder's script file)
      const found = script && codeFromReply(reply);
      if (found && found.code !== script.code) {
        db.run('Script', 'update', script.id, { code: found.code, language: found.language });
        db.run('CopyEvent', 'create', { kind: 'setup', level: 'info', script_id: script.id, message: `Claude updated ${script.name} (${found.language}, ${found.code.split('\n').length} lines)` });
        folders()?.syncSoon(200);
      }
      return { message, script_updated: !!found };
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
  // For other server parts (the Terminal's chart editor): the local model when one is set up, else the default
  fns._ask = (model, system, messages, maxTokens) => ask(model || (user.me().ollama_model ? 'local' : undefined), system, messages, maxTokens);
  return fns;
}
