import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { client } from '@/api/client';
import * as api from '@/lib/quantApi';
import { missingKey, knownModel } from '@/lib/models';
import { useToast } from '@/components/ui/use-toast';
import QuantSidebar from '@/components/quant/QuantSidebar';
import ChatHeader from '@/components/quant/ChatHeader';
import HomeGreeting from '@/components/quant/HomeGreeting';
import MessageList from '@/components/quant/MessageList';
import Composer from '@/components/quant/Composer';
import NoKeyBanner from '@/components/quant/NoKeyBanner';
import MessageQueue from '@/components/quant/MessageQueue';

export default function QuantChat() {
  const { toast } = useToast();
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [style, setStyle] = useState('Concise');
  const [queue, setQueue] = useState([]);
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
  const missing = missingKey(model, keyStatus);
  const needsKey = !!missing;

  const changeModel = (m) => { setModel(m); localStorage.setItem('quant_model', m); };

  const openSession = async (id) => {
    setQueue([]);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newChat = () => { setQueue([]); setActiveId(null); setMessages([]); setSidebarOpen(false); };

  const send = async (text) => {
    setThinking(true);
    let id = activeId;
    if (!id) {
      const s = await api.createSession(text.slice(0, 60), activeGroup);
      id = s.id;
      setActiveId(id);
      refreshSessions();
    }
    const userMsg = await api.addUserMessage(id, text);
    setMessages((m) => [...m, userMsg]);
    try {
      const reply = await api.askQuantAI(id, style, model);
      setMessages((m) => [...m, reply]);
    } catch (e) {
      toast({ title: 'Message failed', description: e.response?.data?.error || e.message, variant: 'destructive' });
    }
    setThinking(false);
    refreshSessions();
  };

  // Messages sent while QuantBot is replying wait in the queue and go out one at a time
  const submit = (text) => {
    if (thinking) setQueue((q) => [...q, { id: `${Date.now()}-${Math.random()}`, text }]);
    else send(text);
  };

  useEffect(() => {
    if (thinking || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    send(next.text);
  }, [thinking, queue]);

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
  const hasChat = activeId && (messages.length > 0 || thinking);

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
        {hasChat ? <MessageList messages={messages} thinking={thinking} /> : <HomeGreeting name={firstName} />}
        {needsKey && <NoKeyBanner provider={missing} onSaved={setKeyStatus} />}
        <MessageQueue queue={queue} onRemove={(id) => setQueue((q) => q.filter((x) => x.id !== id))} />
        <Composer
          onSend={submit} disabled={needsKey}
          style={style} onStyleChange={setStyle} model={model} onModelChange={changeModel}
        />
      </main>
    </div>
  );
}