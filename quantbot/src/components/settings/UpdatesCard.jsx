import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const post = async (path) => {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
  return body;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Only when QuantBot was opened from the desktop shortcut: installed version, updates waiting on GitHub, and a
// restart that installs them behind the loading screen
export default function UpdatesCard() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetch('/api/app/info').then((r) => r.json()).then(setInfo).catch(() => setInfo({ managed: false })); }, []);
  if (!info?.managed) return null;

  const check = async () => {
    setBusy('check');
    setError('');
    try { const { behind } = await post('/api/app/check'); setInfo((i) => ({ ...i, behind })); } catch (e) { setError(e.message); }
    setBusy('');
  };

  const restart = async () => {
    setBusy('restart');
    setError('');
    try {
      await post('/api/app/restart');
      // Wait for the new launcher to answer, then show its loading screen with the update's progress
      await wait(800);
      for (let k = 0; k < 120; k++) {
        try { if ((await fetch('/api/app/ping', { cache: 'no-store' })).ok) break; } catch { /* restarting */ }
        await wait(500);
      }
      window.location.replace('/');
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  };

  const version = info.version ? `v${info.version}${info.commit ? ` (${[info.commit, info.date].filter(Boolean).join(', ')})` : ''}` : '';
  const status = info.behind == null ? "Couldn't reach GitHub to check for updates."
    : info.behind === 0 ? 'You have the newest version.'
      : `${info.behind} update${info.behind === 1 ? '' : 's'} ready to install.`;

  return (
    <section className="mt-8 space-y-3">
      <h2 className="font-heading text-lg font-semibold">Updates</h2>
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">QuantBot {version}</h3>
            <p className="text-xs text-muted-foreground">{status} QuantBot also checks every time you open it from the desktop shortcut.</p>
          </div>
          {info.behind > 0 && <span className="text-xs text-primary bg-primary/10 border border-primary/30 rounded-full px-2.5 py-1 shrink-0">Update ready</span>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={check} disabled={!!busy}>
            {busy === 'check' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}Check now
          </Button>
          {info.behind > 0 && (
            <Button size="sm" onClick={restart} disabled={!!busy}>
              {busy === 'restart' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {busy === 'restart' ? 'Restarting…' : 'Restart & update'}
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}
