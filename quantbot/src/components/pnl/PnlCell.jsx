import { compact } from '@/lib/pnl';

const POS = ['bg-chart-2/10', 'bg-chart-2/20', 'bg-chart-2/35'];
const NEG = ['bg-destructive/10', 'bg-destructive/20', 'bg-destructive/35'];

export default function PnlCell({ label, sub, cell, max, active, onClick }) {
  const has = cell?.trades > 0;
  const lvl = has && max ? Math.min(2, Math.floor((Math.abs(cell.pnl) / max) * 3)) : 0;
  const bg = !has ? 'bg-card' : cell.pnl >= 0 ? POS[lvl] : NEG[lvl];
  return (
    <button
      onClick={onClick} disabled={!has}
      className={`text-left rounded-lg border p-2 min-h-[76px] transition-colors ${bg} ${active ? 'border-primary ring-1 ring-primary' : 'border-border'} ${has ? 'hover:border-primary/60' : 'opacity-60 cursor-default'}`}
    >
      <div className="text-xs text-muted-foreground">{label}{sub && <span className="ml-1">{sub}</span>}</div>
      {has && (
        <>
          <div className={`text-sm font-semibold mt-1 ${cell.pnl >= 0 ? 'text-chart-2' : 'text-destructive'}`}>{compact(cell.pnl)}</div>
          <div className="text-[11px] text-muted-foreground">{cell.trades} trade{cell.trades === 1 ? '' : 's'}</div>
        </>
      )}
    </button>
  );
}