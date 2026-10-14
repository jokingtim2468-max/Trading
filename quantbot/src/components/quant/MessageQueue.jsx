import { X, Clock } from 'lucide-react';

export default function MessageQueue({ queue, onRemove }) {
  if (!queue.length) return null;
  return (
    <div className="px-4 md:px-6 pb-2">
      <div className="max-w-3xl mx-auto space-y-1.5">
        <p className="text-xs text-muted-foreground">Queued ({queue.length}): sent one by one after QuantBot replies</p>
        {queue.map((q, k) => (
          <div key={q.id} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm">
            <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs text-muted-foreground shrink-0">{k + 1}.</span>
            <span className="truncate flex-1">{q.text}</span>
            <button onClick={() => onRemove(q.id)} className="p-1 rounded hover:bg-accent text-muted-foreground" aria-label="Remove from queue">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}