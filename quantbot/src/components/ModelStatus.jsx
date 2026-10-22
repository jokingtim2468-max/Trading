import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const LOOK = {
  loaded: ['bg-emerald-400', 'ready (loaded in memory, answers fastest)'],
  ready: ['bg-emerald-400/60', 'ready (loads on the first message)'],
  missing: ['bg-amber-400', 'not installed in Ollama: set it up in Settings'],
  off: ['bg-destructive', "Ollama isn't running: it starts on your next message"],
  unset: ['bg-muted-foreground', 'no local model set: pick one in Settings'],
};

// Top right: whether the local model can answer right now (checked every 15 seconds). Click it for Settings.
export default function ModelStatus() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    const check = () => fetch('/api/model/status').then((r) => r.json()).then((x) => live && setSt(x)).catch(() => live && setSt({ state: 'off' }));
    check();
    const t = setInterval(check, 15000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!st) return null;
  const [dot, text] = LOOK[st.state] || LOOK.off;
  return (
    <Link to="/settings" className="app-no-drag flex items-center gap-1.5 px-2.5 h-full text-xs text-muted-foreground hover:text-foreground" title={`${st.model || 'Local model'}: ${text}`} data-testid="model-status" data-state={st.state}>
      <span className={`w-2 h-2 rounded-full ${dot} ${st.state === 'loaded' ? 'shadow-[0_0_6px] shadow-emerald-400' : ''}`} />
      <span className="max-w-[160px] truncate">{st.model || 'No model'}</span>
    </Link>
  );
}
