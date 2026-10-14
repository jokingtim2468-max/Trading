import { Badge } from '@/components/ui/badge';
import { MODELS } from '@/lib/models';

export default function SessionHeader({ session: s }) {
  const model = MODELS.find((m) => m.id === s.model)?.label || s.model;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-heading text-xl font-semibold">{s.bot_name}</h2>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline">{s.target === 'MT5' ? 'MQL5 (MT5)' : 'Pine Script v5'}</Badge>
          <Badge variant="outline">{model}</Badge>
          <Badge variant="outline">{s.symbol} {s.timeframe}</Badge>
          <Badge variant="outline">${(s.balance || 0).toLocaleString()} start</Badge>
          <Badge variant="outline">Started {s.created_date?.slice(0, 10)}</Badge>
        </div>
      </div>
      <details className="bg-card border border-border rounded-xl p-4">
        <summary className="text-sm font-medium cursor-pointer">Strategy & rules</summary>
        <p className="text-xs text-muted-foreground mt-3 mb-1">Strategy</p>
        <p className="text-sm whitespace-pre-wrap">{s.strategy || 'n/a'}</p>
        <p className="text-xs text-muted-foreground mt-3 mb-1">Rules</p>
        <p className="text-sm whitespace-pre-wrap">{s.rules || 'None'}</p>
      </details>
    </div>
  );
}