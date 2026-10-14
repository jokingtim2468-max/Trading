import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import { loadDatasets } from '@/lib/backtest/data';
import MarketDataDialog from './MarketDataDialog';

const day = (v) => (v ? String(v).slice(0, 10) : '?');

// Uploaded candle files the Strategy Tester and Converter can run on, next to the built-in markets
export default function MarketDataCard() {
  const [datasets, setDatasets] = useState(null);
  const [adding, setAdding] = useState(false);
  const reload = () => loadDatasets().then((all) => setDatasets(all.filter((d) => !d.market)));

  useEffect(() => { reload(); }, []);

  const remove = async (d) => {
    if (!window.confirm(`Remove ${d.symbol} ${d.timeframe}?`)) return;
    await client.entities.MarketData.delete(d.id);
    reload();
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Your own candle files</h3>
          <p className="text-xs text-muted-foreground">Optional: MT5 or TradingView exports for other symbols or your broker's own prices.</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="w-4 h-4 mr-1" />Add file</Button>
      </div>
      {!datasets ? <p className="text-sm text-muted-foreground">Loading…</p> : !datasets.length ? (
        <p className="text-sm text-muted-foreground">No files added.</p>
      ) : (
        <div className="divide-y divide-border">
          {datasets.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium">{d.symbol} {d.timeframe}</span>
              <span className="text-xs text-muted-foreground">{Number(d.bars || 0).toLocaleString()} {d.source} bars, {day(d.start)} to {day(d.end)}</span>
              <button onClick={() => remove(d)} title="Remove" className="ml-auto p-1.5 rounded hover:bg-accent text-muted-foreground"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      {adding && <MarketDataDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}