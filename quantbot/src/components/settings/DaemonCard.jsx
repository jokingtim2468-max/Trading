import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CopyField from '@/components/signals/CopyField';

// The 24/7 MT5 daemon (mt5/mt5_manager.py): how to run it, its token, and whether it is reporting
export default function DaemonCard() {
  const [info, setInfo] = useState(null);
  const load = () => fetch('/api/mt5/daemon').then((r) => r.json()).then(setInfo).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  const rotate = async () => {
    if (!window.confirm('Make a new daemon token? The running daemon stops working until you restart it with the new command.')) return;
    await fetch('/api/mt5/daemon/rotate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    load();
  };
  const command = info ? `python mt5_manager.py --url ${info.url} --token ${info.token}` : '';
  const live = info?.last_report && Date.now() - Date.parse(info.last_report) < 120000;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3" data-testid="daemon-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">MT5 auto-login daemon</h3>
        <span className={`text-[11px] rounded-full border px-2 py-0.5 ${live ? 'border-emerald-500/40 text-emerald-400' : 'border-border text-muted-foreground'}`} data-testid="daemon-status">
          {live ? `Running: ${info.connected}/${info.enabled} accounts connected` : info?.last_report ? 'Not reporting' : 'Not started yet'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        A small Python program that runs next to QuantBot. For every enabled account it starts that account&apos;s own MT5 terminal, logs in,
        checks the connection every 30 seconds and logs in again when it drops (one process per account: the MetaTrader5 package handles one terminal per process).
        The QuantBot Copier EA in each terminal places the copied trades.
      </p>
      <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-1">
        <li>Install Python 3 for Windows (python.org, tick &ldquo;Add to PATH&rdquo;), then run <code>pip install MetaTrader5</code>.</li>
        <li><a href="/api/mt5/daemon/script" download className="text-primary hover:underline inline-flex items-center gap-1"><Download className="w-3 h-3" />Download mt5_manager.py</a> into a folder, e.g. <code>C:\QuantBot\</code>.</li>
        <li>Run it from that folder (it writes <code>mt5_manager.log</code> next to itself):</li>
      </ol>
      <CopyField label="Daemon command" value={command} placeholder="Loading…" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={rotate}><RefreshCw className="w-3.5 h-3.5 mr-1" />New token</Button>
        <span className="text-[11px] text-muted-foreground">The token lets only this daemon read the account passwords, and only from this PC (127.0.0.1).</span>
      </div>
    </div>
  );
}
