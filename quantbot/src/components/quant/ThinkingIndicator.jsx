import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// QuantBot's own spark: 8 rays of alternating length around a core; turns slowly, the core breathes and the rays
// pulse in a wave
function Spark({ size = 22 }) {
  const rays = Array.from({ length: 8 }, (_, k) => k);
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" className="qb-spark shrink-0" aria-hidden="true">
      <g className="qb-spark-core">
        {rays.map((k) => (
          <rect key={k} className="qb-spark-ray" x="-1.1" y={k % 2 ? -8 : -11} width="2.2" height={k % 2 ? 5.5 : 8} rx="1.1"
            fill="hsl(var(--primary))" transform={`rotate(${k * 45})`} style={{ animationDelay: `${k * 0.2}s` }} />
        ))}
        <circle r="2.4" fill="hsl(var(--primary))" />
      </g>
    </svg>
  );
}

// While the model works: the spark, "Thinking" / "Writing" with a light sweep and the seconds so far, and a
// "Show thinking" fold with what it has written (its reasoning first)
export default function ThinkingIndicator({ live = '' }) {
  const [t0] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = Math.max(0, Math.round((now - t0) / 1000));
  const tool = /^[^\n]{1,80}…$/.test(live.trim()); // a status line ("Using market stats…"), not model text
  const label = tool ? live.trim() : live ? 'Writing' : 'Thinking';
  return (
    <div className="space-y-2 animate-in fade-in-0 duration-300 calm:animate-none" data-testid="chat-live">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={!live || tool} className="flex items-center gap-2.5 text-sm group disabled:cursor-default" data-testid="thinking-toggle">
        <Spark />
        <span className="qb-shimmer font-medium" data-testid="thinking-label">{label}{tool ? '' : '…'}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{secs}s</span>
        {live && !tool && <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && live && !tool && (
        <div className="ml-8 text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap border-l-2 border-border pl-3 max-h-80 overflow-y-auto animate-in fade-in-0 slide-in-from-top-1 duration-200 calm:animate-none" data-testid="thinking-text">
          {live.slice(-6000)}
        </div>
      )}
    </div>
  );
}
