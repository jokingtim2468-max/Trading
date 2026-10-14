import { Fragment } from 'react';
import { monthGrid, compact } from '@/lib/pnl';
import PnlCell from './PnlCell';

const HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'];

export default function DayCalendar({ anchor, rows, max, selected, onSelect }) {
  const weeks = monthGrid(anchor.y, anchor.m);
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {HEAD.map((h) => <div key={h} className="text-xs text-muted-foreground text-center py-1">{h}</div>)}
      {weeks.map((w, k) => {
        const total = w.reduce((s, d) => s + (rows.get(d)?.pnl || 0), 0);
        const trades = w.reduce((s, d) => s + (rows.get(d)?.trades || 0), 0);
        return (
          <Fragment key={k}>
            {w.map((d, j) => (d ? (
              <PnlCell key={d} label={+d.slice(8)} cell={rows.get(d)} max={max} active={selected === d} onClick={() => onSelect('exit_day', d)} />
            ) : <div key={j} />))}
            <div className="rounded-lg border border-dashed border-border p-2 min-h-[76px]">
              <div className="text-xs text-muted-foreground">Total</div>
              {trades > 0 && (
                <>
                  <div className={`text-sm font-semibold mt-1 ${total >= 0 ? 'text-chart-2' : 'text-destructive'}`}>{compact(total)}</div>
                  <div className="text-[11px] text-muted-foreground">{trades} trades</div>
                </>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}