import { GRADE_TONE } from './gradeTone';

const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');

export default function MonteCarloStats({ mc }) {
  const items = [
    ['Robustness score', `${mc.score}/100 (${mc.grade})`, GRADE_TONE[mc.grade]],
    ['Profitable runs', pct(mc.probProfit), mc.probProfit >= 0.5 ? 'text-chart-2' : 'text-destructive'],
    ['Median net', usd(mc.p50), tone(mc.p50)],
    ['Worst 5% net', usd(mc.p5), tone(mc.p5)],
    ['Best 5% net', usd(mc.p95), tone(mc.p95)],
    ['Median max DD', `${mc.dd50.toFixed(2)}%`],
    ['95th pct max DD', `${mc.dd95.toFixed(2)}%`, 'text-destructive'],
    [`Risk of ${mc.ruinPct}%+ DD`, pct(mc.ruin), mc.ruin > 0.05 ? 'text-destructive' : ''],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
      {items.map(([label, value, cls]) => (
        <div key={label} className="bg-background border border-border rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className={`text-sm font-semibold mt-0.5 ${cls || ''}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}