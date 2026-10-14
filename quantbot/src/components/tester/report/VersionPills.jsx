import { Trophy } from 'lucide-react';
import { GRADE_TONE } from './gradeTone';

export default function VersionPills({ runs, activeIdx, onSelect }) {
  const scores = runs.map((r) => r.mc?.score ?? -1);
  const top = Math.max(...scores);
  const best = runs.length > 1 && top >= 0 ? scores.indexOf(top) : -1;
  return (
    <div className="flex flex-wrap gap-2">
      {runs.map((r, k) => (
        <button
          key={r.id} onClick={() => onSelect(k)} title={k === best ? 'Highest Monte Carlo robustness score' : undefined}
          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center ${k === activeIdx ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}
        >
          {k === best && <Trophy className="w-3.5 h-3.5 mr-1.5 text-primary" />}
          <span className="font-semibold">v{r.version}</span>
          {(r.ds?.symbol || r.symbol) && <span className="ml-1.5 text-muted-foreground">{r.ds?.symbol || r.symbol}</span>}
          <span className={`ml-2 ${r.metrics.net >= 0 ? 'text-chart-2' : 'text-destructive'}`}>
            {r.metrics.net >= 0 ? '+' : '-'}${Math.abs(r.metrics.net).toFixed(0)}
          </span>
          <span className="ml-2 text-muted-foreground">{r.metrics.trades} trades</span>
          {r.mc && <span title={`Monte Carlo robustness ${r.mc.score}/100`} className={`ml-2 font-semibold ${GRADE_TONE[r.mc.grade]}`}>MC {r.mc.grade}</span>}
        </button>
      ))}
    </div>
  );
}