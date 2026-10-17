import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleAlert, ShieldAlert, Target, X, XCircle } from 'lucide-react';

const ICONS = { buy: [ArrowUpRight, '#2962ff'], sell: [ArrowDownRight, '#f23645'], set_tp: [Target, '#089981'], set_sl: [ShieldAlert, '#f23645'], close: [XCircle, '#d1d4dc'], error: [CircleAlert, '#f23645'] };
const LIFE = 5000;

// One toast: dark rounded card in the bottom-right stack, icon, title, detail lines, a close X and a bar that runs
// down until it dismisses itself (hovering pauses it)
function Toast({ t, onClose }) {
  const [hover, setHover] = useState(false);
  const [left, setLeft] = useState(LIFE);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (hover || out) return undefined;
    const id = setInterval(() => setLeft((v) => v - 100), 100);
    return () => clearInterval(id);
  }, [hover, out]);
  useEffect(() => { if (left <= 0) setOut(true); }, [left]);
  useEffect(() => { if (!out) return undefined; const id = setTimeout(onClose, 180); return () => clearTimeout(id); }, [out]);
  const [Icon, color] = ICONS[t.kind] || ICONS.error;
  return (
    <div role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} data-testid="toast"
      className={`pointer-events-auto relative w-[340px] overflow-hidden rounded-[12px] border border-[#363a45] bg-[#1e222d] text-[#d1d4dc] shadow-[0_16px_40px_rgba(0,0,0,.55)] calm:animate-none ${out ? 'animate-out fade-out-0 slide-out-to-right-4 duration-150' : 'animate-in fade-in-0 slide-in-from-right-6 duration-pop ease-pop'}`}>
      <div className="flex gap-3 p-3 pr-9">
        <span className="mt-0.5 w-7 h-7 shrink-0 rounded-full flex items-center justify-center" style={{ background: `${color}22`, color }}><Icon className="w-4 h-4" /></span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-white">{t.title}</div>
          {t.lines?.map((l, i) => <div key={i} className="text-xs text-[#9598a1] tabular-nums truncate">{l}</div>)}
        </div>
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => setOut(true)} className="absolute top-2.5 right-2.5 w-6 h-6 rounded-md flex items-center justify-center text-[#787b86] hover:bg-[#2a2e39] hover:text-white"><X className="w-3.5 h-3.5" /></button>
      <div className="absolute bottom-0 left-0 h-[2px] transition-[width] duration-100 ease-linear" style={{ width: `${(Math.max(0, left) / LIFE) * 100}%`, background: color }} />
    </div>
  );
}

export default function Toasts({ items, onClose }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none" aria-live="polite" data-testid="toasts">
      {items.slice(-4).map((t) => <Toast key={t.id} t={t} onClose={() => onClose(t.id)} />)}
    </div>
  );
}
