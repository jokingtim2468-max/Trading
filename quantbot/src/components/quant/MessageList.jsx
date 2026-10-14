import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ChartLoader from './ChartLoader';

export default function MessageList({ messages, thinking }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-8">
        {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        {thinking && (
          <div className="flex items-center gap-3 text-muted-foreground text-sm">
            <ChartLoader />
            QuantBot is analyzing...
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}