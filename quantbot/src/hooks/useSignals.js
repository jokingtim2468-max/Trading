import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';
import { signalText } from '@/lib/signals';

const POLL_MS = 2000;
const LIMIT = 500;

// A short two-note chime (no sound file needed)
function chime(up) {
  try {
    const ctx = new AudioContext();
    [0, 0.12].forEach((at, k) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = up ? [660, 880][k] : [660, 495][k];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.3);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* no audio */ }
}

// Signals from the webhook, newest first, refreshed every 2 s; new ones chime and show a desktop notification
export default function useSignals() {
  const [signals, setSignals] = useState(null);
  const [config, setConfig] = useState(null);
  const seen = useRef(null);

  const load = useCallback(async () => {
    const list = await client.entities.Signal.filter({}, '-created_date', LIMIT);
    if (seen.current) {
      const fresh = list.filter((s) => !seen.current.has(s.id)).reverse();
      for (const s of fresh) {
        if (s.source === 'test') continue;
        chime(['buy', 'buy_limit'].includes(s.event));
        try { if (Notification.permission === 'granted') new Notification(`QuantBot: ${s.strategy}`, { body: signalText(s), silent: true }); } catch { /* no notifications */ }
      }
    }
    seen.current = new Set(list.map((s) => s.id));
    setSignals(list);
  }, []);
  const loadConfig = useCallback(async () => setConfig(await fetch('/api/signals/config').then((r) => r.json())), []);

  useEffect(() => {
    try { if (Notification.permission === 'default') Notification.requestPermission(); } catch { /* no notifications */ }
    load();
    loadConfig();
    const t = setInterval(() => { load(); loadConfig(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, loadConfig]);

  const post = async (path, body = {}) => {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };

  return {
    signals, config,
    async test() {
      await post('/api/signals/test', { qb: 1, event: 'buy', symbol: 'MNQ1!', tf: '5', price: 21450.25, sl: 21430, tp: 21490.5, qty: 1, trade_id: `TEST-${Date.now()}`, strategy: 'QuantBot test', source: 'test', time: Date.now() });
      await load();
    },
    async rotate() { await post('/api/signals/rotate'); await loadConfig(); },
    async tunnel(on) { const t = await post('/api/signals/tunnel', { on }); await loadConfig(); return t; },
    async clear() { await client.entities.Signal.deleteMany({}); await load(); },
  };
}
