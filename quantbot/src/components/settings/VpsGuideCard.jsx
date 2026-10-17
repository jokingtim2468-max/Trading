import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import CopyField from '@/components/signals/CopyField';

const INSTALL = 'irm https://raw.githubusercontent.com/jokingtim2468-max/Trading/vibe-coded/clever-thompson-2f91fo/quantbot/installer/install.ps1 | iex';
const TASK = 'schtasks /create /tn "QuantBot MT5 daemon" /sc ONLOGON /rl HIGHEST /tr "cmd /c cd /d C:\\QuantBot && python mt5_manager.py --token PASTE_TOKEN"';

// Moving QuantBot, the MT5 terminals and the daemon to a Windows VPS that runs 24/7
export default function VpsGuideCard() {
  const [startup, setStartup] = useState(null);
  useEffect(() => { fetch('/api/app/startup').then((r) => r.json()).then(setStartup).catch(() => setStartup({ available: false })); }, []);
  const toggle = async (on) => {
    setStartup(await (await fetch('/api/app/startup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) })).json());
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3" data-testid="vps-guide">
      <h3 className="font-medium">24/7 VPS deployment</h3>
      {startup?.available && (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!startup.on} onCheckedChange={toggle} aria-label="Start QuantBot with Windows" />
          Start QuantBot when Windows starts
        </label>
      )}
      <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-2">
        <li><b className="text-foreground">Get a Windows VPS:</b> Windows Server 2022, 4 GB RAM for a few accounts; each MT5 terminal uses roughly 150-300 MB, so add about 1 GB per 4 accounts. Pick a provider close to your brokers&apos; servers (London or New York for most) and check its reviews before you pay.</li>
        <li><b className="text-foreground">Install QuantBot</b> on the VPS (PowerShell), then turn on &ldquo;Start QuantBot when Windows starts&rdquo; above:
          <div className="mt-1"><CopyField label="Install QuantBot" value={INSTALL} /></div></li>
        <li><b className="text-foreground">One MT5 folder per account:</b> install each broker&apos;s MT5, or copy an installed MT5 folder (e.g. <code>C:\MT5\FTMO1</code>, <code>C:\MT5\FTMO2</code>), and enter each account&apos;s <code>terminal64.exe</code> above. Two accounts can&apos;t share one terminal.</li>
        <li><b className="text-foreground">In each terminal:</b> Tools &gt; Options &gt; Expert Advisors: tick &ldquo;Allow algorithmic trading&rdquo; and &ldquo;Allow WebRequest&rdquo; for QuantBot&apos;s address, attach the QuantBot Copier EA (Copy trading &gt; the account &gt; MT5) and press Algo Trading.</li>
        <li><b className="text-foreground">Run the daemon at logon</b> (Command Prompt as administrator; paste your token). It runs when the VPS user logs in, because MT5 terminals need a desktop session; a task run as SYSTEM at boot has none and the terminals don&apos;t start properly:
          <div className="mt-1"><CopyField label="Startup task" value={TASK} /></div></li>
        <li><b className="text-foreground">Log in automatically after a reboot:</b> use Microsoft&apos;s Sysinternals Autologon for the VPS user, so Windows logs in, QuantBot starts, and the task starts the daemon, which starts every terminal.</li>
        <li><b className="text-foreground">Check it:</b> restart the VPS, wait two minutes, and open Settings &gt; MT5 &amp; deployment: every account should show Connected with its balance. Disconnect from Remote Desktop with the window&apos;s X (don&apos;t sign out), so the session keeps running.</li>
      </ol>
    </div>
  );
}
