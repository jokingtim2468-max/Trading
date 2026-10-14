import { GROUPS } from '@/lib/models';

const LABELS = { MT5: 'MetaTrader 5 EAs & indicators', Pine: 'TradingView Pine Script' };

export default function GroupPills({ active, onSelect }) {
  const pill = (label, value) => (
    <button
      key={label}
      onClick={() => onSelect(value)}
      title={LABELS[value] || 'All chats'}
      className={`px-3 py-1 rounded-full text-xs border transition ${
        active === value
          ? 'bg-primary/15 border-primary/50 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="px-3 py-2">
      <div className="px-1 mb-2 text-xs text-muted-foreground">Projects</div>
      <div className="flex flex-wrap gap-1.5">
        {pill('All', null)}
        {GROUPS.map((g) => pill(g.label, g.value))}
      </div>
    </div>
  );
}