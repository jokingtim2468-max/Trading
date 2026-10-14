import { Input } from '@/components/ui/input';
import DatasetPicker from '@/components/tester/DatasetPicker';

const fmt = (iso) => (iso ? iso.slice(0, 10) : '?');

export default function TestSettings({ cfg, set, datasets }) {
  const sel = datasets.filter((d) => cfg.datasetIds.includes(d.id));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Bot name (tracks unseen data)</span>
          <Input value={cfg.botName} onChange={(e) => set('botName', e.target.value)} placeholder="e.g. Gold EMA Scalper" className="bg-card" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Market data</span>
          <DatasetPicker datasets={datasets} value={cfg.datasetIds} onChange={(v) => set('datasetIds', v)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Starting balance ($)</span>
          <Input type="number" min={100} value={cfg.balance} onChange={(e) => set('balance', Number(e.target.value) || 0)} className="bg-card" />
        </label>
      </div>
      {cfg.windowId === 'custom' && (
        <div className="flex flex-wrap items-center gap-3">
          <Input type="date" min="2024-01-01" value={cfg.customFrom} onChange={(e) => set('customFrom', e.target.value)} className="w-44 bg-card" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" min="2024-01-01" value={cfg.customTo} onChange={(e) => set('customTo', e.target.value)} className="w-44 bg-card" />
        </div>
      )}
      {sel.length > 0 && <p className="text-xs text-muted-foreground">Each market is tested separately: {sel.map((d) => `${d.symbol} ${d.timeframe} ${fmt(d.start)} to ${fmt(d.end)}`).join(' · ')}. Unseen windows never go before 2024.</p>}
    </div>
  );
}