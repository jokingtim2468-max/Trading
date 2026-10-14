// QuantBot's own motion setting (Settings > Motion). Full animations by default, even when Windows has its
// "Animation effects" turned off: that switch makes browsers report reduced motion, which used to stop every
// animation in the app. "Reduced" turns the open/close motion, count-ups and chart drawing off.
const KEY = 'quant_motion';

export function getMotion() {
  try { return localStorage.getItem(KEY) === 'reduced' ? 'reduced' : 'full'; } catch { return 'full'; }
}

export function applyMotion(value = getMotion()) {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('motion-reduced', value === 'reduced');
}

export function setMotion(value) {
  try { localStorage.setItem(KEY, value); } catch { /* still applies for this session */ }
  applyMotion(value);
  // The desktop app's loading window and window opening follow the same setting
  fetch('/api/app/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ motion: value }) }).catch(() => {});
}
