import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ThinkingIndicator from './ThinkingIndicator';
import AppNote from './AppNote';

export default function MessageList({ messages, thinking, live = '', notes = [], onToggleTool }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking, live.length > 0, notes.length]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-8">
        {/* The chat's messages and QuantBot's own /command replies, in time order */}
        {[...messages.map((m) => ({ t: Date.parse(m.created_date) || 0, m })), ...notes.map((n) => ({ t: n.at, n }))].sort((a, b) => a.t - b.t)
          .map((x) => (x.m ? <MessageBubble key={x.m.id} message={x.m} /> : <AppNote key={x.n.id} note={x.n} onToggleTool={onToggleTool} />))}
        {thinking && <ThinkingIndicator live={live} />}
        <div ref={endRef} />
      </div>
    </div>
  );
}