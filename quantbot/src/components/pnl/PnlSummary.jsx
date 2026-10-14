import { usd, keyLabel } from '@/lib/pnl';

const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');

export default function PnlSummary({ rows, wins, view }) {
  const list = [...rows.entries()].filter(([, c]) => c.trades > 0);
  const net = list.reduce((s, [, c]) => s + c.pnl, 0);
  const trades = list.reduce((s, [, c]) => s + c.trades, 0);
  const green = list.filter(([, c]) => c.pnl > 0).length;
  const best = list.reduce((b, e) => (!b || e[1].pnl > b[1].pnl ? e : b), null);
  const worst = list.reduce((b, e) => (!b || e[1].pnl < b[1].pnl ? e : b), null);
  const items = [
    ['Net P&L', usd(net), tone(net)],
    ['Trades', trades],
    ['Trade win rate', trades ? `${((wins / trades) * 100).toFixed(1)}%` : 'n/a'],
    [`Green ${view}s`, list.length ? `${green} / ${list.length}` : 'n/a'],
    [`Avg per ${view}`, list.length ? usd(net / list.length) : 'n/a', tone(net)],
    [`Best ${view}`, best ? usd(best[1].pnl) : 'n/a', 'text-chart-2', best && keyLabel(view, best[0])],
    [`Worst ${view}`, worst ? usd(worst[1].pnl) : 'n/a', 'text-destructive', worst && keyLabel(view, worst[0])],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {items.map(([label, value, cls, sub]) => (
        <div key={label} className="bg-card border border-border rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className={`text-sm font-semibold mt-0.5 ${cls || ''}`}>{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
      ))}
    </div>
  );
}