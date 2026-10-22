import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { client } from '@/api/client';
import * as api from '@/lib/quantApi';
import { missingKey, knownModel, defaultModel } from '@/lib/models';
import { useToast } from '@/components/ui/use-toast';
import LoopFixPanel from '@/components/quant/LoopFixPanel';
import * as loopfix from '@/lib/agents/loopfix';
import QuantSidebar from '@/components/quant/QuantSidebar';
import ChatHeader from '@/components/quant/ChatHeader';
import HomeGreeting from '@/components/quant/HomeGreeting';
import MessageList from '@/components/quant/MessageList';
import Composer from '@/components/quant/Composer';
import MessageQueue from '@/components/quant/MessageQueue';
import { parseCommand } from '@/lib/chatCommands';
import NoKeyBanner from '@/components/quant/NoKeyBanner';

export default function QuantChat() {
  const { toast } = useToast();
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  // The open chat survives switching pages (and its reply keeps going on the server)
  const [activeId, setActiveIdState] = useState(() => { try { return sessionStorage.getItem('quant_chat') || null; } catch { return null; } });
  const setActiveId = (id) => { setActiveIdState(id); try { if (id) sessionStorage.setItem('quant_chat', id); else sessionStorage.removeItem('quant_chat'); } catch { /* private window */ } };
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [live, setLive] = useState('');
  // Messages typed while QuantBot replies wait here (kept when you switch pages) and go out one by one
  const [queue, setQueueState] = useState(() => { try { return JSON.parse(sessionStorage.getItem('quant_queue')) || []; } catch { return []; } });
  const setQueue = (fn) => setQueueState((q) => { const next = typeof fn === 'function' ? fn(q) : fn; try { sessionStorage.setItem('quant_queue', JSON.stringify(next)); } catch { /* private window */ } return next; });
  const [style, setStyle] = useState('Concise');
  const [model, setModel] = useState(() => knownModel(localStorage.getItem('quant_model'), 'builtin'));
  const [keyStatus, setKeyStatus] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => { client.auth.me().then(setUser); api.getKeyStatus().then(setKeyStatus); }, []);

  const refreshSessions = useCallback(async () => {
    if (user) setSessions(await api.loadSessions(user.id, activeGroup));
  }, [user, activeGroup]);

  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  const session = sessions.find((s) => s.id === activeId) || null;
  // A copy trading script's chat is Claude only
  const chatModel = model;
  const missing = missingKey(chatModel, keyStatus);
  const needsKey = !!missing;

  const changeModel = (m) => { setModel(m); localStorage.setItem('quant_model', m); };

  const openSession = async (id) => {
    setActiveId(id);
    setSidebarOpen(false);
    setMessages(await api.loadMessages(id));
  };

  // /?chat=<id> opens that chat (the Strategy Converter's "Fine-tune in chat")
  useEffect(() => {
    const id = params.get('chat');
    if (!id) return;
    setParams({}, { replace: true });
    openSession(id);
  }, []);  

  const newChat = () => { setActiveId(null); setMessages([]); setSidebarOpen(false); };

  // /loopfix [script name] — put a local model on a 10-minute timer to backtest and improve a script until it
  // stops getting better; /loopfix stop ends it. Runs here in the app (the backtest engine is the browser's).
  const runLoopfix = async (text) => {
    const arg = text.replace(/^\/loopfix\b/i, '').trim();
    if (/^stop$/i.test(arg)) { await loopfix.stop(); toast({ title: 'Loop-fix stopped' }); return; }
    if (loopfix.getState().running) { toast({ title: 'Loop-fix is already running', description: 'Type /loopfix stop to end it first.', variant: 'destructive' }); return; }
    const me = user || (await client.auth.me());
    if (!me.ollama_model) { toast({ title: 'Set up a local model first', description: 'Settings → Models → "Set up a model for my PC", then run /loopfix.', variant: 'destructive' }); return; }
    const scripts = await client.entities.Script.list();
    if (!scripts.length) { toast({ title: 'No scripts yet', description: 'Make a script on the Copy trading page, then run /loopfix.', variant: 'destructive' }); return; }
    const pick = arg ? scripts.find((s) => s.name.toLowerCase() === arg.toLowerCase()) || scripts.find((s) => s.name.toLowerCase().includes(arg.toLowerCase())) : null;
    const script = pick || (session?.script_id && scripts.find((s) => s.id === session.script_id)) || scripts.slice().sort((a, b) => (b.updated_date || '').localeCompare(a.updated_date || ''))[0];
    if (arg && !pick) { toast({ title: `No script called "${arg}"`, description: `Have: ${scripts.map((s) => s.name).join(', ')}`, variant: 'destructive' }); return; }
    try {
      await loopfix.start({ scriptId: script.id, model: me.ollama_model, translator: defaultModel(keyStatus, me), intervalMinutes: 10 });
      toast({ title: `Loop-fixing "${script.name}"`, description: `${me.ollama_model} backtests and rewrites it every 10 minutes until it stops improving. Keep QuantBot open.` });
    } catch (e) { toast({ title: 'Loop-fix', description: e.message, variant: 'destructive' }); }
  };

  // Poll the server while it is replying to the open chat; the reply lands even if the page was left meanwhile
  const shownPrompt = useRef({});
  useEffect(() => {
    if (!activeId) return undefined;
    let live = true, timer = null;
    api.loadMessages(activeId).then((m) => live && setMessages(m)).catch(() => {});
    const poll = async () => {
      try {
        const st = await api.replyStatus(activeId);
        if (!live) return;
        setThinking(st.replying);
        setLive(st.replying ? st.live || '' : '');
        if (st.prompt_status && !shownPrompt.current[activeId]) {
          shownPrompt.current[activeId] = true;
          if (st.prompt_status === 'ok') toast({ title: 'System prompt loaded', description: 'The local model replied OK.' });
          else toast({ title: "The model didn't confirm the system prompt", description: `It replied: ${st.prompt_reply}`, variant: 'destructive' });
        }
        if (st.error) toast({ title: 'No reply', description: st.error, variant: 'destructive' });
        setMessages(await api.loadMessages(activeId));
        if (st.replying) timer = setTimeout(poll, 700); else refreshSessions();
      } catch { if (live) timer = setTimeout(poll, 3000); }
    };
    pollNow.current = () => { clearTimeout(timer); poll(); };
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, [activeId]);  
  const pollNow = useRef(() => {});

  // /commands: QuantBot answers them itself with a card in the chat; the model never sees them
  const [notes, setNotes] = useState([]);
  const note = (command, kind, data, chat = activeId) => setNotes((n) => [...n, { id: `${Date.now()}-${Math.random()}`, at: Date.now(), chat, command, kind, data }]);
  const fn = async (name, body) => (await client.functions.invoke(name, body)).data;
  const toggleTool = async (n, name, on) => {
    const r = await fn('chatToolList', { name, on });
    setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, data: r } : x)));
  };
  const runCommand = async ({ name, rest }) => {
    try {
      if (name === 'loopfix') return runLoopfix(`/loopfix ${rest}`);
      if (name === 'new') return newChat();
      if (name === 'help') return note('help', 'help', null);
      if (name === 'tools') {
        const [tool, state] = rest.split(/\s+/);
        return note('tools', 'tools', await fn('chatToolList', tool && /^(on|off)$/i.test(state || '') ? { name: tool, on: /^on$/i.test(state) } : {}));
      }
      if (name === 'model') {
        if (!rest) return note('model', 'text', { text: `This chat uses ${String(chatModel).replace(/^ollama:/, '')}. Type /model <name> to switch (installed models are in the menu below).` });
        changeModel(`ollama:${rest}`);
        return note('model', 'text', { text: `Switched to ${rest}. If it isn't installed, Ollama will say so on the next message (run: ollama pull ${rest}).` });
      }
      if (!activeId) return toast({ title: `/${name}`, description: 'Open or start a chat first.' });
      if (name === 'context') return note('context', 'context', await fn('chatContext', { session_id: activeId }));
      if (name === 'workspace') {
        const w = await fn('chatWorkspace', { session_id: activeId });
        return note('workspace', 'text', { text: w.workspace ? `${w.workspace}\n\n${w.files.length ? w.files.join('\n') : '(empty)'}` : 'No folder yet: it is created after the first reply.' });
      }
      if (name === 'prompt') {
        const h = await api.handshake(activeId, style);
        return note('prompt', 'text', { text: h.status === 'ok' ? 'The model confirmed the system prompt (it replied OK).' : `The model did not confirm the system prompt. It replied: ${h.reply}` });
      }
    } catch (e) { toast({ title: `/${name} failed`, description: e.response?.data?.error || e.message, variant: 'destructive' }); }
    return null;
  };

  const send = async (text) => {
    const cmd = parseCommand(text);
    if (cmd) { await runCommand(cmd); return; }
    let id = activeId;
    try {
      if (!id) {
        const s = await api.createSession(text.slice(0, 60), activeGroup);
        id = s.id;
        setActiveId(id);
        refreshSessions();
      }
      const userMsg = await api.addUserMessage(id, text);
      setMessages((m) => [...m, userMsg]);
      setThinking(true);
      await api.startReply(id, style, chatModel);
      pollNow.current();
    } catch (e) {
      toast({ title: 'Message failed', description: e.response?.data?.error || e.message, variant: 'destructive' });
    }
  };
  const submit = (text) => {
    if (parseCommand(text)) { send(text); return; }
    if (thinking && activeId) setQueue((q) => [...q, { id: `${Date.now()}-${Math.random()}`, text, chat: activeId }]);
    else send(text);
  };
  useEffect(() => {
    const next = queue.find((q) => q.chat === activeId);
    if (thinking || !next) return;
    setQueue((q) => q.filter((x) => x.id !== next.id));
    send(next.text);
  }, [thinking, queue, activeId]);  

  const changeGroup = async (group) => {
    await api.setSessionGroup(activeId, group);
    refreshSessions();
  };

  const deleteChat = async (id) => {
    await api.deleteSession(id);
    if (id === activeId) newChat();
    refreshSessions();
  };

  const removeChat = async () => {
    if (!window.confirm('Delete this conversation?')) return;
    deleteChat(activeId);
  };

  const renameChat = async (id, title) => { await api.renameSession(id, title); refreshSessions(); };
  const moveChat = async (id, group) => { await api.setSessionGroup(id, group); refreshSessions(); };

  const firstName = (user?.full_name || 'Trader').split(' ')[0];
  const chatNotes = notes.filter((n) => n.chat === activeId);
  const hasChat = (activeId && (messages.length > 0 || thinking)) || chatNotes.length > 0;

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <QuantSidebar
        user={user} sessions={sessions} activeId={activeId} activeGroup={activeGroup}
        onSelect={openSession} onNew={newChat} onGroup={setActiveGroup}
        onRename={renameChat} onMove={moveChat} onDelete={deleteChat}
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatHeader
          session={session} onGroupChange={changeGroup}
          onExport={() => api.exportMarkdown(session.title, messages)} onDelete={removeChat}
          onMenu={() => setSidebarOpen(true)}
        />
        {hasChat ? <MessageList messages={messages} thinking={thinking} live={live} notes={chatNotes} onToggleTool={toggleTool} /> : <HomeGreeting name={firstName} />}
        {needsKey && <NoKeyBanner provider={missing} onSaved={setKeyStatus} />}
        <MessageQueue queue={queue.filter((q) => q.chat === activeId)} onRemove={(id) => setQueue((q) => q.filter((x) => x.id !== id))} />
        <LoopFixPanel />
        <Composer
          onSend={submit} disabled={needsKey}
          style={style} onStyleChange={setStyle} model={chatModel} onModelChange={changeModel}
        />
      </main>
    </div>
  );
}