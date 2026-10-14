import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

// Multi-select of candle files; each selected market gets its own test
export default function DatasetPicker({ datasets, value, onChange, className = '' }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const label = datasets.filter((d) => value.includes(d.id)).map((d) => d.symbol).join(', ');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Markets: ${label || 'none picked'}`} className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-sm ${className}`}>
          <span className="truncate">{label || 'Pick markets'}</span>
          <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {datasets.map((d) => (
          <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent cursor-pointer">
            <Checkbox checked={value.includes(d.id)} onCheckedChange={() => toggle(d.id)} />
            <span className="flex-1">{d.symbol}{d.market ? '' : ` ${d.timeframe}`}</span>
            <span className="text-xs text-muted-foreground">Built in, from {d.dayStart.slice(0, 4)}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}