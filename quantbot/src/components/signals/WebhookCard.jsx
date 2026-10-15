import { useState } from 'react';
import { Globe, Loader2, Send, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CopyField from './CopyField';

const STATES = { off: 'Off', downloading: 'Downloading Cloudflare’s tunnel…', starting: 'Connecting…', on: 'On' };

// Where scripts send signals: the public link (TradingView) and this PC's address (MT5 EAs)
export default function WebhookCard({ config, onTunnel, onTest, onRotate }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const t = config?.tunnel || {};
  const publicUrl = t.state === 'on' && t.url && config?.key ? `${t.url}/hook/${config.key}` : '';
  const run = async (what, fn) => {
    setBusy(what); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy('');
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-4 shadow-raised" aria-label="Webhook">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[220px]">
          <h2 className="font-heading text-base font-semibold">Webhook</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Scripts send each buy, sell, close and stop or target move here as a small JSON message (ask any chat for a script
            with QuantBot signals). QuantBot logs it, chimes and tracks the position. You place the orders in Tradovate.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => run('test', onTest)} disabled={!!busy}>
          {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Send test signal
        </Button>
      </div>

      {t.available !== false && (
        <div className="rounded-xl border border-border p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">TradingView public link</span>
            <span data-testid="tunnel-state" className={`text-xs px-2 py-0.5 rounded-full border ${t.state === 'on' ? 'border-emerald-500/40 text-emerald-400' : 'border-border text-muted-foreground'}`}>{STATES[t.state] || 'Off'}</span>
            <Button size="sm" className="ml-auto" variant={t.state === 'on' ? 'outline' : 'default'} disabled={!!busy || ['downloading', 'starting'].includes(t.state)}
              onClick={() => run('tunnel', () => onTunnel(t.state !== 'on'))}>
              {busy === 'tunnel' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t.state === 'on' ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          <CopyField label="TradingView webhook URL" value={publicUrl} placeholder="Turn the public link on to get the address" />
          <p className="text-[11px] text-muted-foreground">
            In TradingView: Create alert → Condition: your indicator, "Any alert() function call" → Notifications → Webhook URL: paste this.
            TradingView webhooks need a paid TradingView plan and two-factor login. The link goes through Cloudflare's free tunnel and
            changes each time it starts, so update the alert after restarting QuantBot.
          </p>
          {t.error && <p className="text-xs text-destructive">{t.error}</p>}
        </div>
      )}

      <div className="rounded-xl border border-border p-3 space-y-3">
        <CopyField label="MT5 / this PC" value={config?.localUrl || ''} placeholder="Loading…" />
        <p className="text-[11px] text-muted-foreground">
          For Expert Advisors in MetaTrader 5 on this PC: paste into the EA's QuantBotUrl input and add
          {' '}<code>{config?.localUrl ? new URL(config.localUrl).origin : 'http://127.0.0.1:5174'}</code> under Tools → Options → Expert Advisors → Allow WebRequest.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => run('rotate', onRotate)} disabled={!!busy}><KeyRound className="w-3.5 h-3.5" />New secret key</Button>
        <span className="text-[11px] text-muted-foreground">Both addresses end in a secret key; anyone with it can add signals. A new key stops the old addresses.</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
