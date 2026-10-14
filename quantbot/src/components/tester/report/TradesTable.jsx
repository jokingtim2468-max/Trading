const dt = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

export default function TradesTable({ trades }) {
  if (!trades.length) return <p className="text-sm text-muted-foreground p-4">No trades in this window.</p>;
  return (
    <div className="bg-card border border-border rounded-xl overflow-auto max-h-[520px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card text-muted-foreground">
          <tr className="border-b border-border text-left">
            {['#', 'Side', 'Entry time', 'Entry', 'Exit time', 'Exit', 'Lots', 'MAE', 'MFE', 'Exit reason', 'P&L'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 500).map((t, k) => (
            <tr key={k} className="border-b border-border/50">
              <td className="px-3 py-1.5">{k + 1}</td>
              <td className={`px-3 py-1.5 font-medium ${t.side === 'long' ? 'text-chart-2' : 'text-destructive'}`}>{t.side}</td>
              <td className="px-3 py-1.5">{dt(t.entryTime)}</td>
              <td className="px-3 py-1.5">{t.entry.toFixed(2)}</td>
              <td className="px-3 py-1.5">{dt(t.exitTime)}</td>
              <td className="px-3 py-1.5">{t.exit.toFixed(2)}</td>
              <td className="px-3 py-1.5">{t.lots}</td>
              <td className="px-3 py-1.5">{t.mae.toFixed(2)}</td>
              <td className="px-3 py-1.5">{t.mfe.toFixed(2)}</td>
              <td className="px-3 py-1.5 uppercase">{t.reason}</td>
              <td className={`px-3 py-1.5 font-semibold ${t.pnl >= 0 ? 'text-chart-2' : 'text-destructive'}`}>{t.pnl.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}