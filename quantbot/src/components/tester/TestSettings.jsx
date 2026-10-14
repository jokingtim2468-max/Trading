import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DatasetPicker from '@/components/tester/DatasetPicker';
import { TIMEFRAMES, firstDate, lastDate, today } from '@/lib/backtest/data';

export default function TestSettings({ cfg, set, datasets }) {
  const sel = datasets.filter((d) => cfg.datasetIds.includes(d.id));
  const min = sel.map((d) => firstDate(d, cfg.timeframe)).filter(Boolean).sort().at(-1);
  const span = (d) => (d.market ? `${d.symbol} ${cfg.timeframe} ${firstDate(d, cfg.timeframe)} to today` : `${d.symbol} ${d.timeframe} ${firstDate(d)} to ${lastDate(d)}`);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Bot name (tracks unseen data)</span>
          <Input value={cfg.botName} onChange={(e) => set('botName', e.target.value)} placeholder="e.g. Gold EMA Scalper" className="bg-card" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Market data</span>
          <DatasetPicker datasets={datasets} value={cfg.datasetIds} onChange={(v) => set('datasetIds', v)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Timeframe</span>
          <Select value={cfg.timeframe} onValueChange={(v) => set('timeframe', v)}>
            <SelectTrigger className="h-10 bg-card" aria-label="Timeframe"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Starting balance ($)</span>
          <Input type="number" min={100} value={cfg.balance} onChange={(e) => set('balance', Number(e.target.value) || 0)} className="bg-card" />
        </label>
      </div>
      {cfg.windowId === 'custom' && (
        <div className="flex flex-wrap items-center gap-3">
          <Input type="date" aria-label="From date" min={min} max={cfg.customTo} value={cfg.customFrom} onChange={(e) => set('customFrom', e.target.value)} className="w-44 bg-card" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" min={cfg.customFrom} max={today()} value={cfg.customTo} onChange={(e) => set('customTo', e.target.value)} className="w-44 bg-card" />
        </div>
      )}
      {sel.length > 0 && <p className="text-xs text-muted-foreground">Each market is tested separately: {sel.map(span).join(' · ')}. Built-in history downloads from Dukascopy the first time it's used; M1 windows cover up to 370 days.</p>}
    </div>
  );
}
