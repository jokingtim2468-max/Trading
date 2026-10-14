import { Trophy } from 'lucide-react';
import CountUp from '@/components/CountUp';
import { GRADE_TONE } from './gradeTone';

const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${v.toFixed(2)}%`;
const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');

// Every market and version of a test side by side, best net P&L first. rows: [{ id, name, version?, metrics, mc? }]
export default function Leaderboard({ rows, activeId, onSelect, title = 'Leaderboard' }) {
  if (!rows.length) return null;
  const ranked = [...rows].sort((a, b) => b.metrics.net - a.metrics.net);
  const pf = (m) => (m.profitFactor == null || !Number.isFinite(m.profitFactor) ? '∞' : m.profitFactor.toFixed(2));
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden" aria-label={title}>
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <Trophy className="w-4 h-4 text-primary" />
        <h3 className="font-heading font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} run{rows.length === 1 ? '' : 's'}, best net P&L first</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              {['#', 'Run', 'Net P&L', 'Return', 'Win rate', 'Profit factor', 'Max DD', 'Trades', 'Robustness'].map((h) => (
                <th key={h} className="text-left font-normal px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, k) => {
              const m = r.metrics;
              return (
                <tr key={r.id} onClick={onSelect ? () => onSelect(r.id) : undefined}
                  className={`border-b border-border last:border-0 ${onSelect ? 'cursor-pointer hover:bg-accent' : ''} ${r.id === activeId ? 'bg-primary/10' : ''}`}>
                  <td className="px-3 py-2 font-semibold">{k === 0 ? <Trophy className="w-4 h-4 text-primary" aria-label="1st" /> : k + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className="font-medium">{r.name}</span>{r.version && <span className="text-muted-foreground ml-2">{r.version}</span>}</td>
                  <td className={`px-3 py-2 font-semibold whitespace-nowrap ${tone(m.net)}`}><CountUp value={m.net} format={usd} /></td>
                  <td className={`px-3 py-2 ${tone(m.returnPct)}`}><CountUp value={m.returnPct} format={pct} /></td>
                  <td className="px-3 py-2"><CountUp value={m.winRate} format={pct} /></td>
                  <td className="px-3 py-2">{pf(m)}</td>
                  <td className="px-3 py-2 text-destructive"><CountUp value={m.maxDDPct} format={pct} /></td>
                  <td className="px-3 py-2"><CountUp value={m.trades} /></td>
                  <td className={`px-3 py-2 whitespace-nowrap ${r.mc ? GRADE_TONE[r.mc.grade] : 'text-muted-foreground'}`}>{r.mc ? `${r.mc.grade} ${r.mc.score}` : 'n/a'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
