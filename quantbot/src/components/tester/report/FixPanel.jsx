import { useState } from 'react';
import { Wand2, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function FixPanel({ run, onPromptChange, onFix, running }) {
  const [loops, setLoops] = useState('3');
  return (
    <div className="bg-card border border-primary/40 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="font-heading font-semibold">Auto-generated fix prompt</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Built from v{run.version}'s log, metrics and rule test. Edit it if you like. Each fix makes a new version and tests it on fresh unseen data.
        </p>
      </div>
      <Textarea value={run.fixPrompt} onChange={(e) => onPromptChange(e.target.value)} className="min-h-[180px] font-mono text-xs bg-background" />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onFix(1)} disabled={running}><Wand2 className="w-4 h-4" />Fix & retest</Button>
        <div className="flex items-center gap-2 ml-auto">
          <Select value={loops} onValueChange={setLoops}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['3', '5', '10'].map((n) => <SelectItem key={n} value={n}>{n} rounds</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => onFix(Number(loops))} disabled={running} className="bg-transparent">
            <Repeat className="w-4 h-4" />Auto test & fix
          </Button>
        </div>
      </div>
    </div>
  );
}