import { useEffect, useState } from 'react';
import { reducedMotion } from '@/lib/clickOrigin';

// Counts a number up from 0 to its value (ease-out) when it first shows or changes, then shows it exactly.
// Off when the system asks for reduced motion. Non-numbers (n/a, infinite profit factor) show as they are.
export function useCountUp(value, ms = 600) {
  const animate = Number.isFinite(value) && !reducedMotion();
  const [shown, setShown] = useState(animate ? 0 : value);
  useEffect(() => {
    if (!Number.isFinite(value) || reducedMotion()) { setShown(value); return undefined; }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      setShown(p >= 1 ? value : value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export default function CountUp({ value, format = (v) => String(Math.round(v)), ms }) {
  const v = useCountUp(value, ms);
  return <span className="tabular-nums">{format(v)}</span>;
}
