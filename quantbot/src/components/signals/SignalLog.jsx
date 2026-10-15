import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { EVENT_LABELS, EVENT_TONES, FILTERS, price } from '@/lib/signals';

const SOURCES = { tradingview: 'TradingView', mt5: 'MT5', test: 'Test', other: 'Other' };
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Every signal received, newest first
export default function SignalLog({ signals, onClear }) {
  const [filter, setFilter] = useState('all');
  const events = FILTERS.find((f) => f.id === filter)?.events;
  const shown = events ? signals.filter((s) => events.includes(s.event)) : signals;
  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-3 shadow-raised" aria-label="Signal log">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-base font-semibold mr-2">Signal log</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg text-xs border ${filter === f.id ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {signals.length > 0 && (
          <button onClick={onClear} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" />Clear log</button>
        )}
      </div>
      {!shown.length ? <p className="text-sm text-muted-foreground">No signals yet. Send a test signal, or set up an alert or EA with the addresses above.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>{['Time', 'Signal', 'Symbol', 'Qty', 'Price', 'SL', 'TP', 'Reason', 'Strategy', 'From'].map((h) => <th key={h} className="font-normal py-2 pr-3 whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} data-signal={s.event} className="border-t border-border/60">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{when(s.created_date)}</td>
                  <td className="py-2 pr-3"><span className={`font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${EVENT_TONES[s.event]}`}>{EVENT_LABELS[s.event]}</span></td>
                  <td className="py-2 pr-3 font-medium">{s.symbol}{s.tf && <span className="text-muted-foreground"> {s.tf}</span>}</td>
                  <td className="py-2 pr-3">{s.qty ?? ''}</td>
                  <td className="py-2 pr-3 font-mono">{price(s.price)}</td>
                  <td className="py-2 pr-3 font-mono text-red-400">{price(s.sl)}</td>
                  <td className="py-2 pr-3 font-mono text-emerald-400">{price(s.tp)}</td>
                  <td className="py-2 pr-3">{s.reason}</td>
                  <td className="py-2 pr-3 max-w-[180px] truncate" title={s.trade_id}>{s.strategy}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{SOURCES[s.source] || s.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
