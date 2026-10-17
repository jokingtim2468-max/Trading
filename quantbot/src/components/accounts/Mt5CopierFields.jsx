import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import CopyField from '@/components/signals/CopyField';
import Field from './Field';

const ago = (iso) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

// MT5 accounts (FTMO and others): QuantBot Copier EA on the account's terminal places the copied trades for real
export default function Mt5CopierFields({ account, form, set }) {
  const [addr, setAddr] = useState(null);
  useEffect(() => {
    if (account?.id) fetch(`/api/mt5/url?account=${account.id}`).then((r) => r.json()).then(setAddr).catch(() => {});
  }, [account?.id]);
  const live = account?.mt5_seen_at && Date.now() - Date.parse(account.mt5_seen_at) < 120000;
  return (
    <div className="rounded-lg border border-border/70 p-2.5 space-y-2" data-testid="mt5-copier">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={!!form.mt5_on} onCheckedChange={(v) => set('mt5_on', v)} aria-label="Place trades on MT5" />
        Place the trades on this MT5 account
        {account?.mt5_on && <span className={`ml-auto text-[11px] ${live ? 'text-emerald-400' : 'text-muted-foreground'}`}>{live ? `EA connected ${ago(account.mt5_seen_at)}` : account.mt5_seen_at ? `EA last seen ${ago(account.mt5_seen_at)}` : 'EA not connected yet'}</span>}
      </label>
      {form.mt5_on && (
        <>
          <Field label="Symbol map" hint="Signal symbol = this account's symbol, comma separated. Trades are sized in 0.01 lots from the account's risk.">
            <Input value={form.symbol_map || ''} onChange={(e) => set('symbol_map', e.target.value)} aria-label="Symbol map" placeholder="MGC1!=XAUUSD, MNQ1!=US100.cash" />
          </Field>
          {account?.id ? (
            <>
              <CopyField label="Copier address" value={addr?.url || ''} placeholder="Loading…" />
              <ol className="list-decimal pl-5 text-[11px] text-muted-foreground space-y-0.5">
                <li><a href="/api/mt5/ea" download className="text-primary hover:underline inline-flex items-center gap-1"><Download className="w-3 h-3" />Download QuantBot Copier</a>, put it in MT5&apos;s File &gt; Open Data Folder &gt; MQL5 &gt; Experts, and compile it (MetaEditor, F7).</li>
                <li>Tools &gt; Options &gt; Expert Advisors: tick Allow WebRequest and add <code>{addr?.allow || 'http://127.0.0.1:<port>'}</code>.</li>
                <li>Drag it onto one chart of this account, paste the Copier address in QuantBotUrl and turn Algo Trading on. QuantBot and MT5 run on the same PC or VPS.</li>
              </ol>
            </>
          ) : <p className="text-[11px] text-muted-foreground">Save the account to get its Copier address.</p>}
        </>
      )}
    </div>
  );
}
