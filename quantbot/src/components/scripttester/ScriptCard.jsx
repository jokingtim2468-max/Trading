export default function ScriptCard({ result }) {
  const { name, script, ds, summary, rules, start, end, modelLabel, version } = result;
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-lg font-semibold">{name}</h2>
        <span className="text-xs border border-primary/40 bg-primary/10 text-primary rounded-full px-2 py-0.5">
          {script.language === 'MT5' ? 'MQL5' : 'Pine'}
        </span>
        <span className="text-xs text-muted-foreground">
          v{version} · {ds.symbol} {ds.timeframe} · {start.slice(0, 10)} to {end.slice(0, 10)} · read by {modelLabel}
        </span>
      </div>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      {rules.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Rules the tester ran</h3>
          <ol className="text-sm space-y-1 list-decimal pl-5">
            {rules.map((r, k) => <li key={k}>{r}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}