// The app's AI features, run on this PC with the trader's own Claude / Gemini key.
import { providerOf, toTurns, callModel, PROVIDER_NAMES, DEFAULT_MODELS } from './lib/modelCall.js';
import { chatSystem, chatHistory, scriptNameOf } from './lib/chatPrompt.js';
import { CONVERTER_SYSTEM, converterInputError, converterTask, converterResult } from './lib/converterPrompt.js';
import { TESTER_SYSTEM, testerInputError, testerTask, testerResult } from './lib/testerPrompt.js';
import { parseJsonReply } from './lib/simContract.js';
import { keyError } from './lib/keyRules.js';
import { createChatTools } from './lib/chatTools.js';
import { listOllamaModels, ollamaBase, DEFAULT_OLLAMA_URL } from './lib/ollama.js';
import { detectSpecs, startPull, pullStatus } from './lib/ollamaSpecs.js';
import { codeFromReply } from './scriptFolders.js';
import { cleanTitle } from './workspaces.js';

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

const HANDSHAKE_ASK = 'Everything above is your system prompt for this whole chat. Follow it in every reply. To confirm you have read it, reply with exactly: OK';

export function createFunctions({ db, user, keys, market, folders = () => null, workspaces = null }) {
  const chatTools = createChatTools({ db, market, webKey: () => user.me().ollama_api_key || process.env.OLLAMA_API_KEY || '' });
  const replying = new Map(); // session_id -> { started, error, done }
  // There is no built-in model: "builtin" means your default model for whichever key is linked
  // Local only: every chat, conversion and test runs on the local model (Ollama) set up in Settings
  function pickModel(model) {
    if (String(model || '').startsWith('ollama:')) return model;
    if (user.me().ollama_model) return 'local';
    return fail('Set up your local model in Settings (Models → "Set up a model for my PC") to use QuantBot.');
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

  async function ask(model, system, messages, maxTokens, tools, onLive) {
    const id = pickModel(model);
    // ollama:<name>: that installed model instead of the one set in Settings
    if (id.startsWith('ollama:')) return callModel('local', { ...credentials('local'), model: id.slice(7) }, id, system, messages, maxTokens, tools, onLive);
    const provider = providerOf(id) || fail('Unknown model');
    return callModel(provider, credentials(provider), id, system, messages, maxTokens, tools, onLive);
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
    async localModel({ action, url, model, api_key }) {
      if (action === 'test') return { models: await listOllamaModels(url) };
      if (action === 'save') {
        const name = String(model || '').trim();
        return user.update({ ollama_url: ollamaBase(url), ollama_model: name, ...(api_key !== undefined ? { ollama_api_key: String(api_key).trim() } : {}) });
      }
      // Look at this PC and recommend the best coding model that fits its GPU / RAM
      if (action === 'recommend') return detectSpecs();
      // Install the recommended (or named) model through Ollama; the UI polls pull_status
      if (action === 'install') {
        const me = user.me();
        const name = String(model || '').trim() || (await detectSpecs()).pick.model;
        return startPull(url || me.ollama_url, name);
      }
      if (action === 'pull_status') return pullStatus();
      return fail('Unknown action');
    },

    // A new chat's first message is the system prompt itself; the model must answer OK, which shows it read it
    async chatHandshake({ session_id, style }) {
      const session = db.run('ChatSession', 'get', session_id);
      if (session.prompt_status === 'ok') return { status: 'ok', reply: session.prompt_reply || 'OK' };
      const system = chatSystem(session.group, style, user.me().full_name, { today: new Date().toISOString().slice(0, 10) });
      const ask0 = `${system}\n\n${HANDSHAKE_ASK}`;
      let reply;
      try { reply = String(await ask(null, 'Follow the instructions in the first message exactly.', [{ role: 'user', content: ask0 }], 50)).trim(); } catch (e) { reply = `(no answer: ${e.message})`; }
      const ok = /^\W*ok\W*$/i.test(reply);
      for (const m of db.run('ChatMessage', 'filter', { session_id, hidden: true }, { limit: 100 }).items) db.run('ChatMessage', 'delete', m.id);
      db.run('ChatMessage', 'create', { session_id, role: 'user', content: ask0, hidden: true });
      db.run('ChatMessage', 'create', { session_id, role: 'assistant', content: ok ? 'OK' : reply, hidden: true });
      db.run('ChatSession', 'update', session_id, { prompt_status: ok ? 'ok' : 'failed', prompt_reply: reply.slice(0, 300) });
      return { status: ok ? 'ok' : 'failed', reply: reply.slice(0, 300) };
    },

    // Background replies: the server answers whatever the trader has sent, so leaving the chat page (or several quick
    // messages) never loses a reply. The page polls chatStatus and reloads the messages.
    chatSend({ session_id, style, model }) {
      db.run('ChatSession', 'get', session_id);
      if (replying.has(session_id)) return { replying: true };
      replying.set(session_id, { started: Date.now(), error: '' });
      (async () => {
        try {
          // Messages sent while the model was busy get another round, answered together
          const users = () => db.run('ChatMessage', 'filter', { session_id, role: 'user' }, { limit: 1000 }).items.filter((m) => !m.hidden).length;
          for (let guard = 0, answered = -1; guard < 10; guard++) {
            const n = users();
            if (n === answered) break;
            await fns.quantChat({ session_id, style, model }, (text) => { const r = replying.get(session_id); if (r) r.live = text; });
            const r = replying.get(session_id); if (r) r.live = '';
            answered = n;
          }
          replying.delete(session_id);
        } catch (e) {
          replying.set(session_id, { error: e.message, done: true });
        }
      })();
      return { replying: true };
    },
    chatStatus({ session_id }) {
      const r = replying.get(session_id);
      if (r?.done) replying.delete(session_id);
      const s = db.run('ChatSession', 'get', session_id);
      return { replying: !!r && !r.done, live: r?.live || '', error: r?.error || '', prompt_status: s.prompt_status || null, prompt_reply: s.prompt_reply || '' };
    },

    async quantChat({ session_id, style, model }, onLive = null) {
      let session = db.run('ChatSession', 'get', session_id);
      if (!session.script_id && !session.prompt_status) { onLive?.('Sending your system prompt to the model…'); await fns.chatHandshake({ session_id, style }); session = db.run('ChatSession', 'get', session_id); }
      const all = db.run('ChatMessage', 'filter', { session_id }, { sort: 'created_date', limit: 1000 }).items;
      // The system-prompt handshake always opens the conversation, then the last 20 visible messages
      const recent = [...all.filter((m) => m.hidden), ...all.filter((m) => !m.hidden).slice(-20)];
      // A copy trading script's chat: Claude only, with the script's folder context (CLAUDE.md) and code
      let script = null;
      if (session.script_id) { try { script = db.run('Script', 'get', session.script_id); } catch { /* script deleted */ } }
      const useModel = model;
      const linked = script ? scriptBrief(script, await folders()?.brief(script)) : session.bot_name ? chatTools.testBrief(session.bot_name) : '';
      const system = chatSystem(session.group, style, user.me().full_name, { linked, today: new Date().toISOString().slice(0, 10) });
      const reply = String(await ask(useModel, system, toTurns(chatHistory(recent).map(({ role, content }) => ({ role, content }))), 16000, chatTools, onLive));
      const message = db.run('ChatMessage', 'create', { session_id, role: 'assistant', content: reply });
      const name = scriptNameOf(reply);
      // A normal chat's first reply: the model names the chat, and that name becomes its workspace folder
      let title = !script && name && name !== session.title ? name : null;
      let workspace = session.workspace || null;
      if (!script && !workspace && workspaces) {
        if (!title && !recent.some((m) => m.role === 'assistant' && !m.hidden)) {
          try {
            title = cleanTitle(await ask(useModel, 'You name chats. Reply with ONLY a short title of 2 to 5 words saying what the user wants, no quotes and no punctuation.',
              [{ role: 'user', content: recent.filter((m) => m.role === 'user' && !m.hidden).map((m) => m.content).join('\n').slice(0, 2000) }], 200));
          } catch { /* keep the first words of the message as the title */ }
        }
        try { workspace = workspaces.create(title || session.title, session_id); } catch { workspace = null; }
      }
      db.run('ChatSession', 'update', session_id, {
        last_message_at: new Date().toISOString(),
        ...(title && title !== session.title ? { title } : {}),
        ...(workspace && workspace !== session.workspace ? { workspace } : {}),
      });
      // Scripts written in a normal chat are saved into its workspace (scripts/<name>.mq5 or .pine)
      const inChat = !script && workspace && codeFromReply(reply);
      if (inChat) workspaces.saveScript(workspace, inChat, name || title || session.title);
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
