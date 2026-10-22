import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GROUPS, useLocalModels } from '@/lib/models';
import { WINDOWS } from '@/lib/backtest/windows';

export default function TesterToolbar({ cfg, set, onRun, onStop, running, disabled }) {
  const models = useLocalModels();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-border p-0.5">
        {GROUPS.map((g) => (
          <button
            key={g.value} onClick={() => set('target', g.value)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${cfg.target === g.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <Select value={models.some((m) => m.id === cfg.model) ? cfg.model : models[0]?.id} onValueChange={(v) => set('model', v)}>
        <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={cfg.windowId} onValueChange={(v) => set('windowId', v)}>
        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          {WINDOWS.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {running ? (
        <Button variant="outline" onClick={onStop} className="ml-auto bg-transparent"><Square className="w-4 h-4" />Stop</Button>
      ) : (
        <Button onClick={onRun} disabled={disabled} className="ml-auto"><Play className="w-4 h-4" />Convert & test</Button>
      )}
    </div>
  );
}