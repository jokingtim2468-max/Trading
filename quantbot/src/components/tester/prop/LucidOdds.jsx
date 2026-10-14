const pct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(0)}%`);
const usd = (v) => `$${Math.round(v).toLocaleString()}`;

export default function LucidOdds({ odds }) {
  const items = [
    ['Eval pass chance', pct(odds.passRate), odds.passRate >= 0.5 ? 'text-chart-2' : 'text-destructive'],
    ['Eval breach chance', pct(odds.breachRate), odds.breachRate > 0.3 ? 'text-destructive' : ''],
    ['Median days to pass', odds.medianDays ?? 'n/a'],
    ['Funded survival', pct(odds.fundedSurvival)],
    ['Expected payout per attempt', usd(odds.avgPaid), odds.avgPaid > 0 ? 'text-chart-2' : ''],
  ];
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Odds over {odds.iterations} shuffled day orders</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {items.map(([label, value, cls]) => (
          <div key={label} className="bg-background border border-border rounded-lg px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className={`text-sm font-semibold mt-0.5 ${cls || ''}`}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}