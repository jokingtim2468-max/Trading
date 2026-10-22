import { Switch } from '@/components/ui/switch';
import { COMMANDS } from '@/lib/chatCommands';

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// A reply from QuantBot itself to a /command: never sent to or seen by the model
export default function AppNote({ note, onToggleTool }) {
  const { kind, data } = note;
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3 text-sm space-y-2" data-testid={`app-note-${kind}`}>
      <div className="text-[11px] text-muted-foreground">QuantBot · /{note.command} · not sent to the model</div>
      {kind === 'help' && (
        <div className="grid gap-1">
          {COMMANDS.map((c) => (
            <div key={c.name} className="flex gap-3"><span className="font-mono text-primary w-24 shrink-0">/{c.name}</span><span className="text-muted-foreground">{c.about}</span></div>
          ))}
        </div>
      )}
      {kind === 'context' && (() => {
        const pct = Math.min(100, (100 * data.used) / data.window);
        const colors = ['bg-primary', 'bg-chart-2', 'bg-chart-4', 'bg-chart-5'];
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span><b className="font-mono">{k(data.used)}</b> of <span className="font-mono">{k(data.window)}</span> tokens ({pct.toFixed(0)}%) on {data.model || 'the local model'}</span>
              <span className="text-xs text-muted-foreground">{(data.window - data.used) > 0 ? `${k(data.window - data.used)} free for its reply and tools` : 'full: older messages get cut'}</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
              {data.parts.map((p, i) => <div key={p.part} className={colors[i % colors.length]} style={{ width: `${(100 * p.tokens) / data.window}%` }} title={`${p.part}: ${p.tokens} tokens`} />)}
            </div>
            <div className="grid gap-0.5">
              {data.parts.map((p, i) => (
                <div key={p.part} className="flex items-center gap-2 text-xs"><span className={`w-2 h-2 rounded-sm ${colors[i % colors.length]}`} /><span className="text-muted-foreground flex-1">{p.part}</span><span className="font-mono">{k(p.tokens)}</span></div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              System prompt {data.prompt_status === 'ok' ? 'confirmed (the model replied OK)' : data.prompt_status === 'failed' ? 'NOT confirmed: type /prompt' : 'not sent yet'}.
              {data.dropped ? ` ${data.dropped} older messages are no longer sent.` : ''} Token counts are estimates (about 3.6 characters a token).
            </div>
          </div>
        );
      })()}
      {kind === 'tools' && (
        <div className="grid gap-1.5">
          {data.tools.map((t) => (
            <label key={t.name} className="flex items-start gap-3">
              <Switch checked={t.on} onCheckedChange={(on) => onToggleTool(note, t.name, on)} aria-label={`Tool ${t.name}`} className="mt-0.5" />
              <span><span className="font-mono text-xs">{t.name}</span><span className="block text-xs text-muted-foreground">{t.description}</span></span>
            </label>
          ))}
        </div>
      )}
      {kind === 'text' && <div className="whitespace-pre-wrap">{data.text}</div>}
    </div>
  );
}
