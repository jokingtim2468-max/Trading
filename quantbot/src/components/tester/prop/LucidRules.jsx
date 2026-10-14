const usd = (v) => `$${v.toLocaleString()}`;

export default function LucidRules({ plan, size, dllOn }) {
  const trail = size + plan.mll + 100;
  const items = [
    ['Profit target', usd(plan.target)],
    ['Max loss limit', `${usd(plan.mll)} EOD trailing`],
    ['MLL locks at', `${usd(size + 100)} once above ${usd(trail)}`],
    ['Eval daily loss', dllOn ? (plan.evalDll ? usd(plan.evalDll) : 'None') : 'Off'],
    ['Funded daily loss', dllOn ? `${usd(plan.fundedDll)}, then 60% of peak EOD profit` : 'Off'],
    ['Max size', `${plan.maxMini} mini / ${plan.maxMini * 10} micro`],
    ['Funded consistency', 'Best day ≤ 40% of cycle profit'],
    ['Payout buffer', `Balance above ${usd(trail)}`],
    ['Payout per cycle', `Min profit ${usd(plan.minProfit)}, $500 min request`],
    ['Max payout', `${usd(plan.maxPayout[0])} first, ${usd(plan.maxPayout[1])} after, 90% split`],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="bg-card border border-border rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="text-xs font-semibold mt-0.5">{value}</div>
        </div>
      ))}
    </div>
  );
}