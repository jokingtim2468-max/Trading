import { client } from '@/api/client';
import { Input } from '@/components/ui/input';
import { groupMembers } from '@/lib/accounts';

// A copy group: who leads, how many contracts each account takes, and how to switch the copying on
export default function GroupPanel({ group, accounts, onChanged }) {
  const members = groupMembers(group, accounts);
  const futures = group.platform !== 'MT5';
  const total = members.reduce((s, a) => s + (Number(a.copy_qty) || 1), 0);
  const setLead = async (id) => { await client.entities.CopyGroup.update(group.id, { lead_account_id: id }); onChanged(); };
  const setQty = async (a, v) => { await client.entities.TradingAccount.update(a.id, { copy_qty: Math.max(1, Math.round(Number(v) || 1)) }); onChanged(); };

  return (
    <div className="rounded-xl border border-border/70 p-4 space-y-3" data-testid="group-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{group.name}: {members.length} account{members.length === 1 ? '' : 's'}</h3>
        {futures && members.length > 0 && <span className="text-xs text-muted-foreground">Group trade size: multiples of {total} contract{total === 1 ? '' : 's'}</span>}
      </div>
      {members.length === 0 ? <p className="text-sm text-muted-foreground">Drag accounts onto this group's tab to add them.</p> : (
        <ol className="space-y-1.5">
          {members.map((a, k) => (
            <li key={a.id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-xs text-muted-foreground tabular-nums">{k + 1}</span>
              <span className="flex-1 min-w-0 truncate">{a.label} <span className="text-muted-foreground text-xs">{a.login}</span></span>
              {k === 0 ? <span className="text-xs text-chart-4">Lead</span> : <button type="button" onClick={() => setLead(a.id)} className="text-xs text-primary hover:underline">Make lead</button>}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Qty
                <Input type="number" min={1} defaultValue={a.copy_qty || 1} aria-label={`Quantity for ${a.label}`} className="h-7 w-16 text-xs"
                  onBlur={(e) => Number(e.target.value) !== (a.copy_qty || 1) && setQty(a, e.target.value)} />
              </label>
            </li>
          ))}
        </ol>
      )}
      {futures ? (
        <details className="text-xs text-muted-foreground" open={members.length > 1}>
          <summary className="cursor-pointer text-foreground/90 text-sm">Switch copying on in Tradovate (Group Trade)</summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1">
            <li>Open the Tradovate web or desktop app (not mobile). Click the account dropdown at the top, then <b>Manage Groups</b>.</li>
            <li>Click <b>+</b> next to Group Name and name it <b>{group.name}</b>.</li>
            <li>Drag the accounts in this order, lead first: {members.map((a) => a.login).join(', ') || 'add accounts here first'}.</li>
            <li>Set each Order Quantity to the Qty above, then <b>Save</b>.</li>
            <li>To trade, pick the group in the account dropdown. Orders must be multiples of {total || 'the group total'}; every account gets its share.</li>
          </ol>
          <p className="mt-2">Group Trade works for accounts at the same prop firm (e.g. all Lucid). Orders placed from TradingView go to one account only, so trade the group from Tradovate. Don't hold opposite positions across accounts: Lucid counts that as hedging. Import each account's trade history in the PnL calendar to journal the copies.</p>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">QuantBot doesn't copy MT5 trades itself yet. This group keeps the accounts organised and their journal trades together.</p>
      )}
    </div>
  );
}
