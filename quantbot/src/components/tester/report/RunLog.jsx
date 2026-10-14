import { useState } from 'react';
import { Info, AlertTriangle, XCircle } from 'lucide-react';

const LEVELS = {
  info: { icon: Info, cls: 'text-muted-foreground' },
  warn: { icon: AlertTriangle, cls: 'text-yellow-500' },
  error: { icon: XCircle, cls: 'text-destructive' },
};
const dt = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '');

export default function RunLog({ log }) {
  const [filter, setFilter] = useState('all');
  const counts = { error: 0, warn: 0, info: 0 };
  log.forEach((e) => { counts[e.level]++; });
  const shown = filter === 'all' ? log : log.filter((e) => e.level === filter);
  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-border text-xs">
        {['all', 'error', 'warn', 'info'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md capitalize ${filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
            {f}{f !== 'all' && ` (${counts[f]})`}
          </button>
        ))}
      </div>
      <ul className="max-h-[420px] overflow-auto p-2 font-mono text-xs space-y-0.5">
        {shown.map((e, k) => {
          const L = LEVELS[e.level] || LEVELS.info;
          return (
            <li key={k} className="flex gap-2 px-2 py-1 rounded hover:bg-accent/50">
              <L.icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${L.cls}`} />
              <span className="text-muted-foreground shrink-0">{dt(e.t)}</span>
              <span className={e.level === 'info' ? '' : L.cls}>{e.msg}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}