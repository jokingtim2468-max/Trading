import { useEffect, useRef, useState } from 'react';

// The innermost drop target under a point that takes the dragged item (a disabled one passes to the one around it)
const targetAt = (x, y) => {
  let el = x == null ? null : document.elementFromPoint(x, y)?.closest('[data-drop]');
  while (el && el.hasAttribute('data-drop-disabled')) el = el.parentElement?.closest('[data-drop]');
  return el ? el.getAttribute('data-drop') : null;
};

// While something is dragged, the drop target under the pointer: the nearest element with data-drop="<id>"
// (skipping ones marked data-drop-disabled). Drops follow the pointer, not the dragged card's size.
export default function usePointerDrop(active) {
  const [over, setOver] = useState(null);
  const current = useRef(null);
  const point = useRef({ x: null, y: null });
  const live = useRef(active);
  live.current = active;

  useEffect(() => {
    const set = (id) => { if (id !== current.current) { current.current = id; setOver(id); } };
    const move = (e) => {
      const p = e.touches?.[0] || e;
      point.current = { x: p.clientX, y: p.clientY };
      if (live.current) set(targetAt(p.clientX, p.clientY));
    };
    // The page can scroll under a still pointer (auto-scroll while dragging): look again at the same spot
    const scrolled = () => { if (live.current) set(targetAt(point.current.x, point.current.y)); };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('touchmove', move, true);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, []);

  useEffect(() => {
    const id = active ? targetAt(point.current.x, point.current.y) : null;
    current.current = id;
    setOver(id);
  }, [active]);

  return [over, current];
}
