import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MONTHS, shiftMonth } from '@/lib/pnl';

const VIEWS = [{ id: 'day', label: 'Days' }, { id: 'week', label: 'Weeks' }, { id: 'month', label: 'Months' }];

export default function PnlToolbar({ view, onView, anchor, onAnchor, bots, bot, onBot }) {
  const step = (dir) => onAnchor(view === 'day' ? shiftMonth(anchor, dir) : { ...anchor, y: anchor.y + dir });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-border p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.id} onClick={() => onView(v.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => step(-1)} className="p-2 rounded-md hover:bg-accent" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-semibold w-24 text-center">{view === 'day' ? `${MONTHS[anchor.m]} ${anchor.y}` : anchor.y}</span>
        <button onClick={() => step(1)} className="p-2 rounded-md hover:bg-accent" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <Select value={bot} onValueChange={onBot}>
        <SelectTrigger className="h-9 w-52 ml-auto"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All bots</SelectItem>
          {bots.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}