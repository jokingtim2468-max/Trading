import { getMotion } from './motionPref';

// One motion for everything that opens: dialogs, menus, selects, popovers, toasts and the mobile sidebar grow out of
// the spot that was clicked and shrink back into it; pages grow from the middle of the window and shrink back to it.
// Timing: 400 ms (0.75x the first 300 ms version, so the growth is easy to follow), cubic-bezier(0.2, 0.8, 0.2, 1),
// from 5% size and transparent to full size.
let last = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
}

export const MOTION = { duration: 0.4, ease: [0.2, 0.8, 0.2, 1], from: 0.05 };

const recent = (maxAge) => (last && Date.now() - last.t <= maxAge ? last : null);

// transform-origin for an element centered in the viewport
export function centeredOrigin() {
  const c = recent(1500);
  if (!c) return 'center';
  return `calc(50% + ${c.x - window.innerWidth / 2}px) calc(50% + ${c.y - window.innerHeight / 2}px)`;
}

// transform-origin at the latest click, in viewport pixels (the phone sidebar grows from the menu tap)
export function clickPoint() {
  const c = recent(1500);
  return c ? `${c.x}px ${c.y}px` : 'left top';
}

// transform-origin for a full-page element: the middle of the window (pages grow from the center, not the click)
export function pageOrigin() {
  return `${window.innerWidth / 2}px ${window.innerHeight / 2}px`;
}

// transform-origin for an element already on screen at `rect` (toasts: the click that led to them, up to a minute ago)
export function originWithin(rect, maxAge = 60000) {
  const c = recent(maxAge);
  return c ? `${c.x - rect.left}px ${c.y - rect.top}px` : 'center';
}

// Radix open/close animation classes with the same timing (menus and selects add their anchor origin)
export const POP = 'calm:animate-none duration-pop ease-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.05] data-[state=closed]:zoom-out-[0.05]';
export const FADE = 'calm:animate-none duration-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0';
// Centered dialogs keep their -50% centering shift during the animation so they grow exactly from the click
export const CENTERED = `${POP} data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2`;

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
