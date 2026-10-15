import { EVENT_TONES, price } from '@/lib/signals';

// What the signals say is open right now, per strategy and symbol
export default function PositionsCard({ positions }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-3 shadow-raised" aria-label="Open from signals">
      <h2 className="font-heading text-base font-semibold">Open from signals</h2>
      {!positions.length ? <p className="text-sm text-muted-foreground">Nothing open. A buy or sell signal shows up here with its stop and target.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {positions.map((p) => (
            <div key={p.key} data-position={p.symbol} className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${EVENT_TONES[p.side === 'long' ? 'buy' : 'sell']}`}>
                  {p.status === 'pending' ? `${p.side === 'long' ? 'BUY' : 'SELL'} LIMIT` : p.side === 'long' ? 'LONG' : 'SHORT'}
                </span>
                <span className="font-medium text-sm">{p.symbol}</span>
                {p.qty != null && <span className="text-xs text-muted-foreground">x{p.qty}</span>}
              </div>
              <div className="text-xs text-muted-foreground truncate">{p.strategy}</div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-muted-foreground">{p.status === 'pending' ? 'Limit' : 'Entry'}</dt><dd className="font-mono">{price(p.entry)}</dd></div>
                <div><dt className="text-red-400">SL</dt><dd className="font-mono">{price(p.sl) || '-'}</dd></div>
                <div><dt className="text-emerald-400">TP</dt><dd className="font-mono">{price(p.tp) || '-'}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
