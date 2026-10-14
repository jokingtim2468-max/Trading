import { usd, keyLabel } from '@/lib/pnl';
import CountUp from '@/components/CountUp';

const pct = (v) => `${v.toFixed(1)}%`;

const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');

export default function PnlSummary({ rows, wins, view }) {
  const list = [...rows.entries()].filter(([, c]) => c.trades > 0);
  const net = list.reduce((s, [, c]) => s + c.pnl, 0);
  const trades = list.reduce((s, [, c]) => s + c.trades, 0);
  const green = list.filter(([, c]) => c.pnl > 0).length;
  const best = list.reduce((b, e) => (!b || e[1].pnl > b[1].pnl ? e : b), null);
  const worst = list.reduce((b, e) => (!b || e[1].pnl < b[1].pnl ? e : b), null);
  const items = [
    ['Net P&L', <CountUp value={net} format={usd} />, tone(net)],
    ['Trades', <CountUp value={trades} />],
    ['Trade win rate', trades ? <CountUp value={(wins / trades) * 100} format={pct} /> : 'n/a'],
    [`Green ${view}s`, list.length ? <><CountUp value={green} /> / {list.length}</> : 'n/a'],
    [`Avg per ${view}`, list.length ? <CountUp value={net / list.length} format={usd} /> : 'n/a', tone(net)],
    [`Best ${view}`, best ? <CountUp value={best[1].pnl} format={usd} /> : 'n/a', best && tone(best[1].pnl), best && keyLabel(view, best[0])],
    [`Worst ${view}`, worst ? <CountUp value={worst[1].pnl} format={usd} /> : 'n/a', worst && tone(worst[1].pnl), worst && keyLabel(view, worst[0])],
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