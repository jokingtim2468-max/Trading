import CountUp from '@/components/CountUp';

const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${v.toFixed(2)}%`;
const pct0 = (v) => `${v.toFixed(0)}%`;
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '∞' : v.toFixed(d));
const int = (v) => String(Math.round(v));
const hold = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');

// Every number counts up from 0 when a report opens
const N = ({ v, f }) => <CountUp value={v} format={f} />;

// Headline numbers first and large; the detail sits underneath as a compact ledger instead of 17 equal boxes
export default function MetricsGrid({ m }) {
  const pf = m.profitFactor ?? Infinity;
  const headline = [
    ['Net P&L', <N v={m.net} f={usd} />, tone(m.net), <><N v={m.returnPct} f={pct} /> on the starting balance</>],
    ['Profit factor', <N v={pf} f={num} />, pf >= 1 ? 'text-chart-2' : 'text-destructive', pf >= 1.5 ? 'Healthy edge' : pf >= 1 ? 'Thin edge' : 'Losing more than it wins'],
    ['Win rate', <N v={m.winRate} f={pct} />, '', <><span data-metric="Trades"><N v={m.trades} f={int} /></span> trades</>],
    ['Max drawdown', <N v={m.maxDDPct} f={pct} />, m.maxDDPct > 10 ? 'text-destructive' : '', <><N v={m.maxDD} f={usd} /> peak to trough</>],
  ];
  const detail = [
    ['Final balance', <N v={m.finalBalance} f={usd} />],
    ['Expectancy / trade', <N v={m.expectancy} f={usd} />, tone(m.expectancy)],
    ['Avg R', m.avgR == null ? 'n/a' : <><N v={m.avgR} f={num} />R</>, tone(m.avgR ?? 0)],
    ['Sharpe (ann.)', <N v={m.sharpe} f={num} />],
    ['Avg win / loss', <><N v={m.avgWin} f={usd} /> / <N v={m.avgLoss} f={usd} /></>],
    ['Largest win / loss', <><N v={m.largestWin} f={usd} /> / <N v={m.largestLoss} f={usd} /></>],
    ['Long / Short', <><N v={m.longs} f={int} /> / <N v={m.shorts} f={int} /></>],
    ['Long / Short win rate', <><N v={m.longWinRate} f={pct0} /> / <N v={m.shortWinRate} f={pct0} /></>],
    ['SL / TP hits', <><N v={m.slHits} f={int} /> / <N v={m.tpHits} f={int} /></>],
    ['Max loss streak', <N v={m.maxLossStreak} f={int} />],
    ['Avg hold time', <N v={m.avgHoldMins} f={hold} />],
  ];
  const lead = m.net > 0 ? 'before:bg-chart-2' : m.net < 0 ? 'before:bg-destructive' : 'before:bg-border';
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {headline.map(([label, value, cls, note], k) => (
          <div
            key={label}
            className={`relative overflow-hidden rounded-xl border border-border bg-card px-4 py-3 shadow-raised ${k === 0 ? `before:absolute before:inset-y-0 before:left-0 before:w-1 ${lead}` : ''}`}
          >
            <div className="text-xs text-muted-foreground">{label}</div>
            <div data-metric={label} className={`font-heading text-2xl font-semibold tabular-nums mt-0.5 ${cls}`}>{value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{note}</div>
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 rounded-lg border border-border/70 px-4 py-1.5">
        {detail.map(([label, value, cls]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/50 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0 lg:[&:nth-last-child(3)]:border-b-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd data-metric={label} className={`text-sm font-medium tabular-nums ${cls || ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
