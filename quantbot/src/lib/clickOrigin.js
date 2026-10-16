import { getMotion } from './motionPref';

// Simple motion: things fade in with a short slide and fade out the same way. Dialogs fade and rise slightly,
// menus and selects fade and slide a few pixels away from what opened them, pages and panels fade and slide,
// the phone sidebar slides in from the left. 200 ms, ease-out. (The click point is still tracked for the few places
// that use it.)
let last = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
}

export const MOTION = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1], slide: 12 };

const recent = (maxAge) => (last && Date.now() - last.t <= maxAge ? last : null);

// transform-origin for an element centered in the viewport
export function centeredOrigin() {
  const c = recent(1500);
  if (!c) return 'center';
  return `calc(50% + ${c.x - window.innerWidth / 2}px) calc(50% + ${c.y - window.innerHeight / 2}px)`;
}



// transform-origin for an element already on screen at `rect` (toasts: the click that led to them, up to a minute ago)
export function originWithin(rect, maxAge = 60000) {
  const c = recent(maxAge);
  return c ? `${c.x - rect.left}px ${c.y - rect.top}px` : 'center';
}

// Radix open/close animation classes with the same timing (menus and selects add their anchor origin)
export const POP = 'calm:animate-none duration-pop ease-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1';
// Toasts slide up from the bottom edge and fade
export const TOAST = 'calm:animate-none duration-pop ease-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-right-8';
export const FADE = 'calm:animate-none duration-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0';
// Centered dialogs keep their -50% centering shift and rise a little (from 48% to 50%) as they fade in
export const CENTERED = 'calm:animate-none duration-pop ease-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]';

// Ref callback that sets an element's transform-origin from the latest click the moment it appears on screen.
// (A component can be rendered long before its pop-up opens, so the origin can't be picked at render time.)
export function originRef(forwarded, compute) {
  return (el) => {
    if (el && !el.dataset.originSet) {
      el.style.transformOrigin = compute(el);
      el.dataset.originSet = '1';
    }
    if (typeof forwarded === 'function') forwarded(el);
    else if (forwarded) forwarded.current = el;
  };
}

// True when Settings > Motion is "Reduced" (for people who get motion sickness): count-ups and chart drawing skip
// straight to the end, and the open/close motion turns off (calm: classes)
export const reducedMotion = () => getMotion() === 'reduced';
