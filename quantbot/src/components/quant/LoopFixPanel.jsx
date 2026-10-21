import { useEffect, useState } from 'react';
import { RefreshCw, Square, Trophy, Clock } from 'lucide-react';
import { subscribe, stop } from '@/lib/agents/loopfix';
import { Button } from '@/components/ui/button';

const PHASE = { starting: 'Starting…', testing: 'Backtesting', fixing: 'Writing a better version', waiting: 'Waiting for the next round', done: 'Finished', stopped: 'Stopped', idle: '' };

// Live status for /loopfix: the local model backtesting, scoring and rewriting one script on a timer.
export default function LoopFixPanel() {
  const [s, setS] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => subscribe(setS), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!s || s.phase === 'idle') return null;
  const active = s.running;
  const secs = s.nextAt ? Math.max(0, Math.round((s.nextAt - now) / 1000)) : 0;
  const best = s.best;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-border bg-card/80 backdrop-blur p-3 text-sm" data-testid="loopfix-panel">
      <div className="flex items-center gap-2">
        <RefreshCw className={`w-4 h-4 text-primary ${active && s.phase !== 'waiting' ? 'animate-spin' : ''}`} />
        <b>Loop-fix · {s.name}</b>
        <span className="text-xs text-muted-foreground">Round {s.round} · {PHASE[s.phase] || s.phase}</span>
        {active && s.phase === 'waiting' && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />next in {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>}
        <div className="ml-auto flex items-center gap-2">
          {best && <span className="text-xs text-chart-2 flex items-center gap-1" data-testid="loopfix-best"><Trophy className="w-3.5 h-3.5" />Best: PF {best.pf} · DD {best.ddPct}% · net {best.net} · {best.trades} trades</span>}
          {active ? <Button size="sm" variant="destructive" onClick={stop} data-testid="loopfix-stop"><Square className="w-3.5 h-3.5 mr-1" />Stop</Button>
            : <span className="text-xs text-muted-foreground">{s.phase === 'done' ? 'As good as it got.' : 'Stopped.'}</span>}
        </div>
      </div>
      {s.log.length > 0 && (
        <ol className="mt-2 max-h-28 overflow-y-auto space-y-0.5 text-xs text-muted-foreground" data-testid="loopfix-log">
          {s.log.slice(-6).map((e, i) => <li key={i}>{e.text}</li>)}
        </ol>
      )}
      {s.error && <p className="mt-1 text-xs text-destructive">{s.error}</p>}
    </div>
  );
}
