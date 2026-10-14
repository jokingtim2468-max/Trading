import { Input } from '@/components/ui/input';

export default function MarketFileRow({ item, onChange }) {
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5">
      <p className="text-xs font-medium truncate">{item.file.name}</p>
      {item.info ? (
        <>
          <p className="text-[11px] text-muted-foreground">{item.info.source} · {item.info.bars.toLocaleString()} bars · {item.info.start.slice(0, 10)} to {item.info.end.slice(0, 10)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-8 text-xs" value={item.symbol} onChange={(e) => onChange({ symbol: e.target.value })} placeholder="Symbol" />
            <Input className="h-8 text-xs" value={item.timeframe} onChange={(e) => onChange({ timeframe: e.target.value })} placeholder="Timeframe, e.g. M15" />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-red-400">Could not read candles, skipped.</p>
      )}
    </div>
  );
}