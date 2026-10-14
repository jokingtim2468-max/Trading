export default function CopyLogRow({ ev, name }) {
  const ok = ev.followers.filter((f) => f.ok);
  const failed = ev.followers.filter((f) => !f.ok);
  const fills = ok.map((f) => f.fillMs).filter((x) => typeof x === 'number');
  const what = [ev.kind, ev.side, ev.volume, ev.symbol].filter((x) => x !== null && x !== undefined && x !== '').join(' ');

  return (
    <div className="py-2.5 text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">{new Date(ev.at).toLocaleTimeString()}</span>
        <span className="font-medium">{name(ev.sourceId)}</span>
        <span>{what}</span>
        <span>{ok.length}/{ev.followers.length} copied</span>
        {ev.followers.length > 1 && (
          <span className={ev.spreadMs <= 5 ? 'text-green-500' : 'text-amber-400'}>sent within {ev.spreadMs.toFixed(2)} ms</span>
        )}
        {fills.length > 0 && <span className="text-muted-foreground">broker {Math.round(Math.min(...fills))}–{Math.round(Math.max(...fills))} ms</span>}
      </div>
      {failed.map((f, i) => <p key={i} className="text-red-400">{name(f.accountId)}: {f.error}</p>)}
    </div>
  );
}