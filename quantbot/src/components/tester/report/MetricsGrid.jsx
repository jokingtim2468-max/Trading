const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (v) => `${v.toFixed(2)}%`;
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '∞' : v.toFixed(d));
const hold = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');

export default function MetricsGrid({ m }) {
  const items = [
    ['Net P&L', usd(m.net), tone(m.net)],
    ['Return', pct(m.returnPct), tone(m.returnPct)],
    ['Final balance', usd(m.finalBalance)],
    ['Trades', m.trades],
    ['Win rate', pct(m.winRate)],
    ['Profit factor', num(m.profitFactor), m.profitFactor >= 1 ? 'text-chart-2' : 'text-destructive'],
    ['Max drawdown', `${usd(m.maxDD)} (${pct(m.maxDDPct)})`, 'text-destructive'],
    ['Sharpe (ann.)', num(m.sharpe)],
    ['Expectancy / trade', usd(m.expectancy), tone(m.expectancy)],
    ['Avg R', m.avgR == null ? 'n/a' : `${num(m.avgR)}R`, tone(m.avgR ?? 0)],
    ['Avg win / loss', `${usd(m.avgWin)} / ${usd(m.avgLoss)}`],
    ['Largest win / loss', `${usd(m.largestWin)} / ${usd(m.largestLoss)}`],
    ['Long / Short', `${m.longs} / ${m.shorts}`],
    ['Long / Short win rate', `${m.longWinRate.toFixed(0)}% / ${m.shortWinRate.toFixed(0)}%`],
    ['SL / TP hits', `${m.slHits} / ${m.tpHits}`],
    ['Max loss streak', m.maxLossStreak],
    ['Avg hold time', hold(m.avgHoldMins)],
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