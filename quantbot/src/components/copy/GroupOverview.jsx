import { X, RotateCcw, FileCode2 } from 'lucide-react';
import { client } from '@/api/client';
import { Input } from '@/components/ui/input';
import { groupMembers } from '@/lib/accounts';
import { SCRIPT_STEP, groupStats, money, signedMoney } from '@/lib/copy';
import RankAvatar, { RankName } from './RankAvatar';

const STATUS = {
  active: 'border-border text-muted-foreground', passed: 'border-emerald-500/40 text-emerald-400', failed: 'border-red-500/40 text-red-400',
};
const STATUS_LABEL = { active: 'Current', passed: 'Passed', failed: 'Failed' };

function Stat({ label, children, testId }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3 space-y-1.5" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

// A copy group's overview: the script it trades (drop one in the slot), P&L with profit and loss, trades made
// against the max, accounts passed / failed / current, the accounts and their latest trades
export default function GroupOverview({ group, accounts, trades, scripts, onChanged, onRemoveScript, dropScript, over }) {
  const members = groupMembers(group, accounts);
  const mine = trades.filter((t) => t.group_id === group.id);
  const st = groupStats(group, members, mine);
  const script = scripts.find((s) => s.id === group.script_id);
  const futures = group.platform !== 'MT5';
  const total = members.reduce((s, a) => s + (Number(a.copy_qty) || 1), 0);
  const nameOf = (id) => { const a = accounts.find((x) => x.id === id); return a?.display_name || a?.label || 'Removed account'; };
  const update = async (data) => { await client.entities.CopyGroup.update(group.id, data); onChanged(); };
  const setQty = async (a, v) => { await client.entities.TradingAccount.update(a.id, { copy_qty: Math.max(1, Math.round(Number(v) || 1)) }); onChanged(); };

  return (
    <div className="rounded-xl border border-border/70 p-4 space-y-4" data-testid="group-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">{group.name}: {members.length} account{members.length === 1 ? '' : 's'}</h3>
        {group.enabled === false && <span className="text-xs text-chart-4">Paused</span>}
        {(() => {
          const isOver = over === `slot:${group.id}`;
          return (
            <div data-drop={`slot:${group.id}`} {...(dropScript ? {} : { 'data-drop-disabled': '' })} data-testid="script-slot"
              className={`ml-auto flex items-center gap-2 rounded-xl border px-2.5 py-1.5 min-w-[220px] transition-colors ${isOver ? 'border-primary bg-primary/10 ring-2 ring-primary' : script ? 'border-border' : 'border-dashed border-border text-muted-foreground'} ${dropScript && !isOver ? 'border-primary/60' : ''}`}>
              {script ? (
                <>
                  <RankAvatar seed={script.id} xp={script.xp} step={SCRIPT_STEP} size={34} label={script.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{script.name}</p>
                    <p className="text-[10px] text-muted-foreground"><RankName xp={script.xp} step={SCRIPT_STEP} /> · {script.xp || 0} XP</p>
                  </div>
                  <button type="button" aria-label="Take the script off this group" onClick={onRemoveScript} className="p-1 rounded-md hover:bg-accent"><X className="w-3.5 h-3.5" /></button>
                </>
              ) : <span className="flex items-center gap-2 text-xs"><FileCode2 className="w-4 h-4" />Drag a script here</span>}
            </div>
          );
        })()}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="P&L" testId="group-pnl">
          <div className="flex items-center gap-3">
            <div className="text-[11px] leading-5 tabular-nums">
              <p className="text-emerald-400" title={`${st.wins} winning trades`}>{signedMoney(st.profit)}</p>
              <p className="text-red-400" title={`${st.losses} losing trades`}>{money(st.loss)}</p>
            </div>
            <p className={`text-2xl font-semibold tabular-nums ${st.pnl > 0 ? 'text-emerald-400' : st.pnl < 0 ? 'text-red-400' : ''}`}>{signedMoney(st.pnl)}</p>
          </div>
        </Stat>
        <Stat label="Trades" testId="group-trades">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold tabular-nums"><span>{st.made}</span><span className="text-muted-foreground">/{st.max}</span></p>
            {st.open > 0 && <span className="text-[11px] text-muted-foreground">{st.open} open</span>}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (st.made / st.max) * 100)}%` }} /></div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <label className="flex items-center gap-1">Max
              <Input type="number" min={1} defaultValue={st.max} key={st.max} aria-label="Max trades" className="h-6 w-16 text-[11px]"
                onBlur={(e) => Number(e.target.value) !== st.max && update({ max_trades: Math.max(1, Math.round(Number(e.target.value) || 100)) })} />
            </label>
            {st.made > 0 && <button type="button" onClick={() => update({ trades_made: 0 })} className="ml-auto flex items-center gap-1 hover:text-foreground"><RotateCcw className="w-3 h-3" />Start count again</button>}
          </div>
        </Stat>
        <Stat label="Accounts" testId="group-accounts">
          <div className="grid grid-cols-3 text-center">
            <div><p className="text-2xl font-semibold tabular-nums text-emerald-400">{st.passed}</p><p className="text-[11px] text-muted-foreground">Passed</p></div>
            <div><p className="text-2xl font-semibold tabular-nums text-red-400">{st.failed}</p><p className="text-[11px] text-muted-foreground">Failed</p></div>
            <div><p className="text-2xl font-semibold tabular-nums">{st.current}</p><p className="text-[11px] text-muted-foreground">Current</p></div>
          </div>
        </Stat>
      </div>

      {members.length === 0 ? <p className="text-sm text-muted-foreground">Drag accounts onto this group&apos;s tab to add them.</p> : (
        <ol className="space-y-1.5">
          {members.map((a) => (
            <li key={a.id} className="flex items-center gap-3 text-sm" data-member={a.label}>
              <RankAvatar seed={a.avatar_seed || a.id} xp={a.xp} size={30} label={a.display_name || a.label} />
              <span className="flex-1 min-w-0 truncate">{a.display_name || a.label} <span className="text-muted-foreground text-xs">{a.label}</span></span>
              <RankName xp={a.xp} className="text-xs hidden sm:inline" />
              <span className="text-xs tabular-nums w-24 text-right">{money(a.balance ?? a.start_balance ?? 0)}</span>
              <span className={`text-[11px] rounded-full border px-2 py-0.5 ${STATUS[a.status || 'active']}`}>{STATUS_LABEL[a.status || 'active']}</span>
              {a.risk_usd > 0 ? <span className="text-xs text-muted-foreground w-24 text-right">Risk ${a.risk_usd}</span> : (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground w-24 justify-end">
                  Qty
                  <Input type="number" min={1} defaultValue={a.copy_qty || 1} aria-label={`Quantity for ${a.label}`} className="h-7 w-14 text-xs"
                    onBlur={(e) => Number(e.target.value) !== (a.copy_qty || 1) && setQty(a, e.target.value)} />
                </label>
              )}
            </li>
          ))}
        </ol>
      )}

      {mine.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Latest trades</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {mine.slice(0, 8).map((t) => (
                  <tr key={t.id} className="border-t border-border/50" data-trade={t.status}>
                    <td className="py-1.5 pr-2 truncate max-w-[140px]">{nameOf(t.account_id)}</td>
                    <td className={`pr-2 ${t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side === 'long' ? 'Buy' : 'Sell'} {t.qty} {t.symbol}</td>
                    <td className="pr-2 tabular-nums text-muted-foreground">{t.entry}{t.exit != null ? ` → ${t.exit}` : ''}</td>
                    <td className={`pr-2 tabular-nums text-right ${t.pnl > 0 ? 'text-emerald-400' : t.pnl < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{t.status === 'closed' ? signedMoney(t.pnl) : 'Open'}</td>
                    <td className="text-right text-muted-foreground">{t.status === 'closed' ? `+${t.xp} XP` : t.forwarded || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {futures ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground/90 text-sm">Switch copying on in Tradovate (Group Trade)</summary>
          <p className="mt-2">QuantBot copies the script to these accounts itself (on paper at the alert price, and to each account&apos;s order URL when it has one). To copy by hand from Tradovate instead:</p>
          <ol className="list-decimal pl-5 mt-2 space-y-1">
            <li>Open the Tradovate web or desktop app (not mobile). Click the account dropdown at the top, then <b>Manage Groups</b>.</li>
            <li>Click <b>+</b> next to Group Name and name it <b>{group.name}</b>.</li>
            <li>Drag the accounts in this order, lead first: {members.map((a) => a.login).filter(Boolean).join(', ') || 'add accounts here first'}.</li>
            <li>Set each Order Quantity to the account&apos;s Qty, then <b>Save</b>.</li>
            <li>To trade, pick the group in the account dropdown. Orders must be multiples of {total || 'the group total'}; every account gets its share.</li>
          </ol>
          <p className="mt-2">Group Trade works for accounts at the same prop firm (e.g. all Lucid). Don&apos;t hold opposite positions across accounts: Lucid counts that as hedging.</p>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">MT5 accounts copy the script on paper here; give an account an order URL to send the trades on.</p>
      )}
    </div>
  );
}
