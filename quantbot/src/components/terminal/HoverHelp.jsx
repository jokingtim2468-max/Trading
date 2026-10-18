import { useEffect, useRef, useState } from 'react';
import { tipFor } from '@/lib/terminalTips';

// Holding the mouse on a control for 1 second shows what it is, what it does and how to use it (from data-tip,
// the TIPS list by data-testid, or the control's own title)
export default function HoverHelp({ delay = 1000 }) {
  const [tip, setTip] = useState(null);
  const timer = useRef(null);
  const cur = useRef(null);
  useEffect(() => {
    const find = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const t = tipFor(n.dataset?.testid);
        if (n.title) { n.dataset.tip = n.title; n.removeAttribute('title'); }
        if (t) return { el: n, tip: t };
        if (n.dataset?.tip) return { el: n, tip: [n.getAttribute('aria-label') || '', n.dataset.tip] };
      }
      return null;
    };
    const hide = () => { clearTimeout(timer.current); cur.current = null; setTip(null); };
    const over = (e) => {
      const hit = find(e.target);
      if (hit?.el === cur.current) return;
      hide();
      if (!hit) return;
      cur.current = hit.el;
      timer.current = setTimeout(() => {
        if (!hit.el.isConnected) return;
        const r = hit.el.getBoundingClientRect();
        const below = r.bottom + 120 < window.innerHeight;
        const left = Math.min(Math.max(8, r.left + r.width / 2 - 140), window.innerWidth - 288);
        setTip({ title: hit.tip[0], text: hit.tip[1], left, top: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('wheel', hide, { passive: true });
    return () => { document.removeEventListener('mouseover', over); document.removeEventListener('pointerdown', hide, true); window.removeEventListener('wheel', hide); clearTimeout(timer.current); };
  }, [delay]);
  if (!tip) return null;
  return (
    <div role="tooltip" data-testid="hover-help" style={{ left: tip.left, top: tip.top, transform: tip.below ? 'none' : 'translateY(-100%)' }}
      className="fixed z-[60] w-[280px] pointer-events-none rounded-[10px] border border-[#363a45] bg-[#1e222d] px-3 py-2.5 text-[12px] leading-snug text-[#b2b5be] shadow-[0_14px_36px_rgba(0,0,0,.55)] animate-in fade-in-0 zoom-in-95 duration-pop ease-pop calm:animate-none">
      {tip.title && <div className="mb-0.5 text-[13px] font-semibold text-white">{tip.title}</div>}
      {tip.text}
    </div>
  );
}
