import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIMEFRAMES } from '@/lib/backtest/data';

// Timeframe and from/to dates for the built-in markets, bounded by the data available
export default function RangeFields({ tf, from, to, min, max, onChange, className = '' }) {
  return (
    <div className={`flex flex-wrap items-end gap-3 ${className}`}>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">Timeframe</span>
        <Select value={tf} onValueChange={(v) => onChange({ tf: v })}>
          <SelectTrigger className="h-10 w-24" aria-label="Timeframe"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">From</span>
        <Input type="date" aria-label="From date" value={from} min={min} max={to || max} onChange={(e) => onChange({ from: e.target.value })} className="h-10 w-40 bg-card" />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">To</span>
        <Input type="date" aria-label="To date" value={to} min={from || min} max={max} onChange={(e) => onChange({ to: e.target.value })} className="h-10 w-40 bg-card" />
      </label>
    </div>
  );
}
