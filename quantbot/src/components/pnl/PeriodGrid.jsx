import { MONTHS, pad, weeksOfYear, shortLabel } from '@/lib/pnl';
import PnlCell from './PnlCell';

export default function PeriodGrid({ view, anchor, rows, max, selected, onSelect }) {
  const weekly = view === 'week';
  const keys = weekly ? weeksOfYear(anchor.y) : MONTHS.map((_, k) => `${anchor.y}-${pad(k + 1)}`);
  const field = weekly ? 'exit_week' : 'exit_month';
  return (
    <div className={weekly ? 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5' : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'}>
      {keys.map((key, k) => (
        <PnlCell
          key={key} label={weekly ? `W${k + 1}` : MONTHS[k]} sub={weekly ? shortLabel('week', key) : ''}
          cell={rows.get(key)} max={max} active={selected === key} onClick={() => onSelect(field, key)}
        />
      ))}
    </div>
  );
}