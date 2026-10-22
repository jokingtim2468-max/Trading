import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ThinkingIndicator from './ThinkingIndicator';

export default function MessageList({ messages, thinking, live = '' }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking, live.length > 0]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-8">
        {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        {thinking && <ThinkingIndicator live={live} />}
        <div ref={endRef} />
      </div>
    </div>
  );
}