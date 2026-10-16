import { ArrowLeft, X, RotateCcw, FileCode2, Trophy } from 'lucide-react';
import { client } from '@/api/client';
import { Input } from '@/components/ui/input';
import { groupMembers } from '@/lib/accounts';
import { SCRIPT_STEP, groupStats, money, signedMoney, logSetup, TIERS } from '@/lib/copy';
import GroupMenu from '@/components/accounts/GroupMenu';
import RankAvatar, { RankName } from './RankAvatar';
import { rankedScripts } from './GroupCard';

const STATUS = {
  active: 'border-border text-muted-foreground', passed: 'border-emerald-500/40 text-emerald-400', failed: 'border-red-500/40 text-red-400',
};
const STATUS_LABEL = { active: 'Current', passed: 'Passed', failed: 'Failed' };
// 1st, 2nd, 3rd place colours (Gold, Silver, Bronze tiers)
const PLACE = [TIERS[4].color, TIERS[3].color, TIERS[2].color];

function Place({ n }) {
  return (
    <span className="w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums"
      style={n <= 3 ? { background: PLACE[n - 1], color: '#000' } : undefined}>{n <= 3 ? n : <span className="text-muted-foreground">{n}</span>}</span>
  );
}

function Stat({ label, children, testId }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3 space-y-1.5 min-w-0" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{label}</p>
      {children}
    </div>
  );
}

// An opened group: its script (drop another to replace it), P&L, trades made / max, passed / failed / current,
// its accounts ranked best first, and the latest trades
export default function GroupDetail({ group, accounts, trades, scripts, over, dropScript, onClose, onChanged, onRemoveScript, onRemoveAccount, onRename, onToggle, onDelete }) {
  const members = groupMembers(group, accounts);
  const mine = trades.filter((t) => t.group_id === group.id);
  const st = groupStats(group, members, mine);
  const ranked = rankedScripts(group, scripts, trades);
  const futures = group.platform !== 'MT5';
  const total = members.reduce((s, a) => s + (Number(a.copy_qty) || 1), 0);
  const gain = (a) => (a.balance ?? a.start_balance ?? 0) - (a.start_balance ?? 0);
  const top = [...members].sort((a, b) => gain(b) - gain(a) || (Number(b.xp) || 0) - (Number(a.xp) || 0));
  const nameOf = (id) => { const a = accounts.find((x) => x.id === id); return a?.display_name || a?.label || 'Removed account'; };
  const scriptOf = (id) => scripts.find((s) => s.id === id)?.name || '';
  const update = async (data, message) => {
    await client.entities.CopyGroup.update(group.id, data);
    await logSetup(`${group.name}: ${message}`, { group_id: group.id }, data);
    onChanged();
  };
  const setQty = async (a, v) => {
    const qty = Math.max(1, Math.round(Number(v) || 1));
    await client.entities.TradingAccount.update(a.id, { copy_qty: qty });
    await logSetup(`${a.display_name || a.label}: quantity ${a.copy_qty || 1} -> ${qty}`, { account_id: a.id, group_id: group.id });
    onChanged();
  };
  const slotOver = over === `slot:${group.id}`;

  return (
    <div className="rounded-2xl border border-border bg-background p-4 space-y-4" data-testid="group-panel" data-drop={`tab:${group.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-accent">
          <ArrowLeft className="w-4 h-4" />All groups
        </button>
        <h3 className="text-base font-semibold" data-testid="group-title">{group.name}</h3>
        <span className="text-xs text-muted-foreground">{members.length} account{members.length === 1 ? '' : 's'}</span>
        {group.enabled === false && <span className="text-xs text-chart-4">Paused</span>}
        <span className="ml-auto rounded-full border border-border"><GroupMenu group={group} onRename={onRename} onToggle={onToggle} onDelete={onDelete} /></span>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Script</p>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="group-scripts">
          {ranked.slice(0, 1).map(({ script, e }) => (
            <div key={script.id} data-group-script={script.name} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-2.5 min-w-0">
              <RankAvatar seed={script.id} xp={script.xp} step={SCRIPT_STEP} size={44} label={script.name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{script.name}</p>
                <p className="text-[11px] text-muted-foreground truncate"><RankName xp={script.xp} step={SCRIPT_STEP} /> · {script.xp || 0} XP</p>
                <p className="text-[11px] tabular-nums truncate">
                  <span className={e.net > 0 ? 'text-emerald-400' : e.net < 0 ? 'text-red-400' : 'text-muted-foreground'}>{signedMoney(e.net)}</span>
                  <span className="text-muted-foreground"> · {e.trades} trade{e.trades === 1 ? '' : 's'}{e.trades ? ` · ${Math.round(e.winRate * 100)}% won` : ''}</span>
                </p>
              </div>
              <button type="button" aria-label={`Take ${script.name} off this group`} onClick={() => onRemoveScript(script.id)} className="p-1 rounded-md hover:bg-accent self-start"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <div data-drop={`slot:${group.id}`} {...(dropScript ? {} : { 'data-drop-disabled': '' })} data-testid="script-slot"
            className={`flex items-center justify-center gap-2 rounded-xl border border-dashed p-2.5 min-h-[68px] text-xs transition-colors ${slotOver ? 'border-primary bg-primary/10 ring-2 ring-primary text-foreground' : dropScript ? 'border-primary/60 text-foreground' : 'border-border text-muted-foreground'}`}>
            <FileCode2 className="w-4 h-4" />{ranked.length ? 'Drag a different script here to replace it' : 'Drag a script here'}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="P&L" testId="group-pnl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-[11px] leading-5 tabular-nums whitespace-nowrap">
              <p className="text-emerald-400" title={`${st.wins} winning trades`}>{signedMoney(st.profit)}</p>
              <p className="text-red-400" title={`${st.losses} losing trades`}>{money(st.loss)}</p>
            </div>
            <p className={`text-2xl font-semibold tabular-nums truncate ${st.pnl > 0 ? 'text-emerald-400' : st.pnl < 0 ? 'text-red-400' : ''}`}>{signedMoney(st.pnl)}</p>
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
                onBlur={(e) => Number(e.target.value) !== st.max && update({ max_trades: Math.max(1, Math.round(Number(e.target.value) || 100)) }, `max trades ${st.max} -> ${Math.max(1, Math.round(Number(e.target.value) || 100))}`)} />
            </label>
            {st.made > 0 && <button type="button" onClick={() => update({ trades_made: 0 }, `trade count started again (was ${st.made}/${st.max})`)} className="ml-auto flex items-center gap-1 hover:text-foreground whitespace-nowrap"><RotateCcw className="w-3 h-3" />Start count again</button>}
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

      <div className="space-y-1.5">
        <p className="text-xs font-medium flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-chart-4" />{top.length > 1 ? 'Top accounts' : 'Account'}</p>
        {top.length === 0 ? <p className="text-sm text-muted-foreground">Drag accounts onto this group to add them.</p> : (
          <ol className="space-y-1">
            {top.map((a, k) => (
              <li key={a.id} className="flex items-center gap-2.5 text-sm rounded-lg px-1 py-1 hover:bg-accent/40" data-member={a.label}>
                {top.length > 1 && <Place n={k + 1} />}
                <RankAvatar seed={a.avatar_seed || a.id} xp={a.xp} size={32} label={a.display_name || a.label} />
                <span className="flex-1 min-w-0 truncate">{a.display_name || a.label} <span className="text-muted-foreground text-xs">{a.label}</span></span>
                <RankName xp={a.xp} className="text-xs hidden md:inline whitespace-nowrap" />
                <span className="text-xs tabular-nums whitespace-nowrap w-24 text-right">{money(a.balance ?? a.start_balance ?? 0)}</span>
                <span className={`text-xs tabular-nums whitespace-nowrap w-20 text-right ${gain(a) > 0 ? 'text-emerald-400' : gain(a) < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{signedMoney(Math.round(gain(a) * 100) / 100)}</span>
                <span className={`text-[11px] rounded-full border px-2 py-0.5 whitespace-nowrap ${STATUS[a.status || 'active']}`}>{STATUS_LABEL[a.status || 'active']}</span>
                {a.risk_usd > 0 ? <span className="text-xs text-muted-foreground w-20 text-right whitespace-nowrap hidden sm:inline">Risk ${a.risk_usd}</span> : (
                  <label className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground w-20 justify-end">
                    Qty
                    <Input type="number" min={1} defaultValue={a.copy_qty || 1} aria-label={`Quantity for ${a.label}`} className="h-7 w-12 text-xs"
                      onBlur={(e) => Number(e.target.value) !== (a.copy_qty || 1) && setQty(a, e.target.value)} />
                  </label>
                )}
                <button type="button" aria-label={`Take ${a.label} out of ${group.name}`} onClick={() => onRemoveAccount(a)} className="p-1 rounded-md hover:bg-accent text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {mine.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Latest trades</p>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full text-xs whitespace-nowrap">
              <tbody>
                {mine.slice(0, 8).map((t) => (
                  <tr key={t.id} className="border-t first:border-t-0 border-border/50" data-trade={t.status}>
                    <td className="py-1.5 px-3">{nameOf(t.account_id)}</td>
                    <td className="pr-3 text-muted-foreground">{scriptOf(t.script_id)}</td>
                    <td className={`pr-3 ${t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side === 'long' ? 'Buy' : 'Sell'} {t.qty} {t.symbol}</td>
                    <td className="pr-3 tabular-nums text-muted-foreground">{t.entry}{t.exit != null ? ` → ${t.exit}` : ''}</td>
                    <td className={`pr-3 tabular-nums text-right ${t.pnl > 0 ? 'text-emerald-400' : t.pnl < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{t.status === 'closed' ? signedMoney(t.pnl) : 'Open'}</td>
                    <td className="pr-3 text-right text-muted-foreground">{t.status === 'closed' ? `+${t.xp} XP` : t.forwarded || ''}</td>
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
            <li>Drag the accounts in: {members.map((a) => a.login).filter(Boolean).join(', ') || 'add accounts here first'}.</li>
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
