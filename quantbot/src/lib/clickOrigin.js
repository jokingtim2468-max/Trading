// Remembers where the user last pressed, so windows/pages can grow out of that spot.
let last = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
}

// transform-origin for an element centered in the viewport
export function centeredOrigin() {
  if (!last || Date.now() - last.t > 1500) return 'center';
  return `calc(50% + ${last.x - window.innerWidth / 2}px) calc(50% + ${last.y - window.innerHeight / 2}px)`;
}

// transform-origin for a full-page element
export function pageOrigin() {
  if (!last || Date.now() - last.t > 1500) return 'center top';
  return `${last.x}px ${last.y}px`;
}