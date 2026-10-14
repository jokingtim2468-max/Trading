const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const BADGE = {
  passed: ['Passed', 'text-chart-2 border-chart-2/40 bg-chart-2/10'],
  breached: ['Breached', 'text-destructive border-destructive/40 bg-destructive/10'],
  open: ['In progress', 'text-muted-foreground border-border'],
};

export default function LucidStageCard({ kind, stage, plan, size }) {
  const title = kind === 'eval' ? 'Evaluation' : 'Funded account';
  if (!stage) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground mt-2">Pass the evaluation to simulate the funded account.</p>
      </div>
    );
  }
  const [label, cls] = kind === 'funded' && stage.status === 'open' ? ['Active', BADGE.passed[1]] : BADGE[stage.status];
  const paid = stage.payouts.reduce((a, p) => a + p.toTrader, 0);
  const rows = [
    ['Result', stage.reason],
    ['Trading days', stage.days],
    ['Balance', `${usd(stage.balance)} (${stage.balance >= size ? '+' : ''}${usd(stage.balance - size)})`],
    ['Max loss limit level', usd(stage.floor)],
    kind === 'eval' ? ['Target progress', `${usd(stage.balance - size)} of ${usd(plan.target)}`] : ['Payouts', `${stage.payouts.length} paid, ${usd(paid)} to you`],
    ['Daily loss limit stops', stage.dllHits],
    ['Trades over max size', stage.oversize, stage.oversize ? 'text-destructive' : ''],
  ];
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`text-xs border rounded-full px-2.5 py-0.5 ${cls}`}>{label}</span>
      </div>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v, c]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`font-medium text-right ${c || ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}