// The Terminal's per-PC preferences (toasts, sounds, alerts) and drawings, kept in this browser
const KEY = 'quantbot.terminal.prefs';
export const PREFS = { v: 2, oneClickQty: '1', toastPos: 'tr', toastSecs: 5, sound: true, levelAlerts: true, newsMarkers: true, newsToast: true, guard: true };

export function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    // v2: toasts moved to the top right
    return { ...PREFS, ...saved, ...(saved.v === 2 ? {} : { v: 2, toastPos: 'tr' }) };
  } catch { return { ...PREFS }; }
}
export function writePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window */ } }

const drawKey = (symbol) => `quantbot.terminal.drawings.${symbol}`;
export function readDrawings(symbol) { try { return JSON.parse(localStorage.getItem(drawKey(symbol))) || []; } catch { return []; } }
export function writeDrawings(symbol, list) { try { localStorage.setItem(drawKey(symbol), JSON.stringify(list)); } catch { /* private window */ } }

// A short two-note chime (no sound files): up for fills and alerts, down for errors
let ctx = null;
export function chime(kind = 'ok') {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'error' ? [523, 392] : kind === 'alert' ? [660, 880, 660] : [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.22);
    });
  } catch { /* no audio */ }
}
