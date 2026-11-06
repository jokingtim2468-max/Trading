import { useState } from 'react';
import { Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Accounts > Connection guides: step-by-step setup for MetaTrader 5 and Quantower. Both run a small QuantBot Copier
// on the trading terminal that asks QuantBot for orders every second and reports each fill.
const GUIDES = {
  MT5: {
    title: 'MetaTrader 5',
    download: { href: '/api/mt5/ea', label: 'QuantBot Copier EA (.mq5)' },
    steps: [
      'Install MetaTrader 5 from your broker or prop firm and log in to the account once.',
      'In QuantBot: Accounts > Add account. Type the MT5 login number, pick MetaTrader 5, enter the server name exactly as MT5 shows it (e.g. FTMO-Demo), and the password if you want QuantBot to log the terminal in by itself.',
      'Under Copy trading, turn on "Place the trades on this MT5 account", add a symbol map if names differ (MGC1!=XAUUSD), and Save. Open the account again to see its Copier address.',
      'Download the Copier EA. In MT5: File > Open Data Folder > MQL5 > Experts, put the file there, open it in MetaEditor and press F7 to compile.',
      'MT5: Tools > Options > Expert Advisors: tick "Allow WebRequest for listed URL" and add the address QuantBot shows (http://127.0.0.1:<port>).',
      'Drag QuantBot Copier onto one chart of the account, paste the Copier address into QuantBotUrl, tick Allow Algo Trading, and turn the Algo Trading button on.',
      'Check: the account in QuantBot shows "EA connected". Send a test signal on a demo account before using a funded one.',
    ],
  },
  Quantower: {
    title: 'Quantower',
    download: { href: '/api/quantower/strategy', label: 'QuantBot Copier strategy (.cs)' },
    steps: [
      'In Quantower, connect your broker or prop connection (Rithmic, CQG, Tradovate, etc.) so the account shows in the Accounts panel.',
      'In QuantBot: Accounts > Add account. Type the account name exactly as Quantower shows it, pick Quantower, set the account rules, turn on "Place the trades on this Quantower account" and Save. Open it again to see its Copier address.',
      'Download the Copier strategy. Install Visual Studio (free Community) and Quantower\'s "Algo" extension, create a new Quantower Strategy project, replace its code with the downloaded file and Build. Quantower picks it up automatically.',
      'Quantower: open Strategies Manager, add "QuantBot Copier", pick the account, paste the Copier address, set the symbol map (e.g. MGC1!=MGC, MNQ1!=MNQ; use the exact Quantower symbol names), then Run.',
      'Check: the strategy log says "Polling…" and the account in QuantBot shows "Strategy connected". Test on a demo or evaluation account first.',
      'Keep QuantBot and Quantower open on the same PC or VPS. Quantower must allow automated trading on the connection (some prop firms forbid it; check their rules).',
    ],
  },
};

export default function ConnectionGuide({ onClose }) {
  const [tab, setTab] = useState('MT5');
  const g = GUIDES[tab];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="connection-guide">
        <DialogHeader><DialogTitle>Connect a trading platform</DialogTitle></DialogHeader>
        <div className="flex gap-1.5" role="tablist">
          {Object.entries(GUIDES).map(([id, x]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`guide-${id}`}
              className={`px-3 py-1.5 rounded-lg border text-sm ${tab === id ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'}`}>{x.title}</button>
          ))}
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          {g.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <a href={g.download.href} download className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><Download className="w-4 h-4" />Download {g.download.label}</a>
        <p className="text-[11px] text-muted-foreground">Copied trades go to the platform only after you turn the copier on for that account. Losses are real on funded accounts: test on demo first.</p>
      </DialogContent>
    </Dialog>
  );
}
