import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { reducedMotion } from '@/lib/clickOrigin';

// Every chart draws itself in over 1 s; Replay draws it again whenever you like
export default function ChartCard({ title, right, children }) {
  const [run, setRun] = useState(0);
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-3 min-w-0">
          {right && <div className="text-xs text-muted-foreground truncate">{right}</div>}
          <button type="button" onClick={() => setRun((n) => n + 1)} title="Replay the chart" aria-label={`Replay ${title}`}
            className="shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
            <RotateCcw className="w-3.5 h-3.5" />Replay
          </button>
        </div>
      </div>
      <div key={run}>{children}</div>
    </div>
  );
}

// Spread on every chart series (Area, Line, Bar, Scatter) so they all draw the same way
export const CHART_ANIM = { isAnimationActive: !reducedMotion(), animationDuration: 1000, animationEasing: 'ease-out' };

export const axisProps = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false, axisLine: false };
export const tooltipStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };
export const dateTick = (t) => new Date(t).toISOString().slice(5, 10);
export const dateTimeLabel = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
