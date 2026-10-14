import { Badge } from '@/components/ui/badge';

const money = (v) => (v == null ? 'n/a' : `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(0)}`);

export default function SessionCard({ session, active, onSelect }) {
  const s = session;
  return (
    <button
      onClick={() => onSelect(s)}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${active ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate">{s.bot_name}</span>
        <Badge variant="outline" className="shrink-0">{s.target === 'MT5' ? 'MQL5' : 'Pine'}</Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {s.symbol} {s.timeframe} · {s.versions || 0} version{s.versions === 1 ? '' : 's'} · rules {s.latest_rules || 'n/a'}
      </div>
      <div className="flex items-center justify-between text-xs mt-1.5">
        <span>
          Latest <span className={s.latest_net >= 0 ? 'text-chart-2' : 'text-destructive'}>{money(s.latest_net)}</span>
          <span className="text-muted-foreground"> · best </span>
          <span className={s.best_net >= 0 ? 'text-chart-2' : 'text-destructive'}>{money(s.best_net)}</span>
        </span>
        <span className="text-muted-foreground">{s.last_run_at?.slice(0, 10)}</span>
      </div>
    </button>
  );
}