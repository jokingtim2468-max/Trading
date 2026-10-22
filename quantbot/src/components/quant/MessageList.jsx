import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ChartLoader from './ChartLoader';

export default function MessageList({ messages, thinking, live = '' }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking, live.length > 0]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-8">
        {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        {thinking && (
          <div className="space-y-2" data-testid="chat-live">
            <div className="flex items-center gap-3 text-muted-foreground text-sm">
              <ChartLoader />
              {live ? 'QuantBot is writing…' : 'QuantBot is thinking…'}
            </div>
            {/* What the model has written so far (its thinking first, for models that think out loud) */}
            {live && <div className="text-sm text-muted-foreground whitespace-pre-wrap border-l-2 border-primary/40 pl-3 max-h-80 overflow-y-auto font-mono text-[12px] leading-relaxed">{live.slice(-6000)}</div>}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}