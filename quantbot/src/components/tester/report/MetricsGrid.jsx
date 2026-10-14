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

export default function MetricsGrid({ m }) {
  const items = [
    ['Net P&L', <N v={m.net} f={usd} />, tone(m.net)],
    ['Return', <N v={m.returnPct} f={pct} />, tone(m.returnPct)],
    ['Final balance', <N v={m.finalBalance} f={usd} />],
    ['Trades', <N v={m.trades} f={int} />],
    ['Win rate', <N v={m.winRate} f={pct} />],
    ['Profit factor', <N v={m.profitFactor ?? Infinity} f={num} />, (m.profitFactor ?? Infinity) >= 1 ? 'text-chart-2' : 'text-destructive'],
    ['Max drawdown', <><N v={m.maxDD} f={usd} /> (<N v={m.maxDDPct} f={pct} />)</>, 'text-destructive'],
    ['Sharpe (ann.)', <N v={m.sharpe} f={num} />],
    ['Expectancy / trade', <N v={m.expectancy} f={usd} />, tone(m.expectancy)],
    ['Avg R', m.avgR == null ? 'n/a' : <><N v={m.avgR} f={num} />R</>, tone(m.avgR ?? 0)],
    ['Avg win / loss', <><N v={m.avgWin} f={usd} /> / <N v={m.avgLoss} f={usd} /></>],
    ['Largest win / loss', <><N v={m.largestWin} f={usd} /> / <N v={m.largestLoss} f={usd} /></>],
    ['Long / Short', <><N v={m.longs} f={int} /> / <N v={m.shorts} f={int} /></>],
    ['Long / Short win rate', <><N v={m.longWinRate} f={pct0} /> / <N v={m.shortWinRate} f={pct0} /></>],
    ['SL / TP hits', <><N v={m.slHits} f={int} /> / <N v={m.tpHits} f={int} /></>],
    ['Max loss streak', <N v={m.maxLossStreak} f={int} />],
    ['Avg hold time', <N v={m.avgHoldMins} f={hold} />],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map(([label, value, cls]) => (
        <div key={label} className="bg-card border border-border rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className={`text-sm font-semibold mt-0.5 ${cls || ''}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}
