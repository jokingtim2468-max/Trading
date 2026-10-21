// The Terminal's per-PC preferences (toasts, sounds, alerts) and drawings, kept in this browser
const KEY = 'quantbot.terminal.prefs';
export const PREFS = {
  v: 3, oneClickQty: '0.01', sessions: true, templates: [], bracket: { on: false, slPts: 5, tpR: 2 },
  hotkeys: false, keys: { buy: 'b', sell: 's', closeAll: 'c', breakeven: 'e', half: 'h' },
  toastPos: 'tr', toastSecs: 5, sound: true, voice: true, levelAlerts: true, newsMarkers: true, newsToast: true, guard: true };

export function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    // v2: toasts moved to the top right. v3: trading size defaults to 0.01 lots
    return { ...PREFS, ...saved, ...((saved.v || 0) < 2 ? { toastPos: 'tr' } : {}), ...((saved.v || 0) < 3 ? { v: 3, oneClickQty: '0.01' } : {}) };
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
    // news: twice the alert's beats (and twice as long)
    const notes = kind === 'error' ? [523, 392] : kind === 'news' ? [660, 880, 660, 880, 660, 880] : kind === 'alert' ? [660, 880, 660] : [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.22);
    });
  } catch { /* no audio */ }
}

// A voice saying the words (the PC's own text-to-speech voice: Windows' Microsoft voices, no sound files), e.g.
// "Order filled" after the fill chime
export function say(text) {
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    const voices = s.getVoices().filter((v) => /^en/i.test(v.lang));
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voices.find((v) => /natural|aria|jenny|zira|samantha/i.test(v.name)) || voices[0] || null;
    u.rate = 1.05; u.volume = 0.9;
    s.cancel();
    setTimeout(() => s.speak(u), 260);
  } catch { /* no speech on this PC */ }
}

// The trader's own fill sound (an audio file they picked, kept in this browser as a data URL)
export function playFile(url) {
  try { const a = new Audio(url); a.volume = 0.9; a.play().catch(() => {}); } catch { /* no audio */ }
}
