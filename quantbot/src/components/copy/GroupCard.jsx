import { Pause, FileCode2, ChevronRight } from 'lucide-react';
import { groupMembers } from '@/lib/accounts';
import { SCRIPT_STEP, groupStats, groupScriptIds, evaluate, money, signedMoney } from '@/lib/copy';
import RankAvatar from './RankAvatar';

// Scripts of a group, best first by what they made in that group
export function rankedScripts(group, scripts, trades) {
  return groupScriptIds(group).map((id) => scripts.find((s) => s.id === id)).filter(Boolean)
    .map((s) => ({ script: s, e: evaluate(trades.filter((t) => t.group_id === group.id && t.script_id === s.id)) }))
    .sort((a, b) => b.e.net - a.e.net || (b.script.xp || 0) - (a.script.xp || 0));
}

// One group in the overview: its script, accounts, P&L, trades made / max and passed / failed / current.
// Click it to open the group; drop accounts or scripts on it to add them.
export default function GroupCard({ group, accounts, trades, scripts, over, dropOk, onOpen }) {
  const members = groupMembers(group, accounts);
  const st = groupStats(group, members, trades.filter((t) => t.group_id === group.id));
  const ranked = rankedScripts(group, scripts, trades);
  const isOver = over === `tab:${group.id}`;
  return (
    <div data-drop={`tab:${group.id}`} {...(dropOk ? {} : { 'data-drop-disabled': '' })} data-group-card={group.name}
      role="button" tabIndex={0} aria-label={`Open ${group.name}`} onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className={`group/card rounded-2xl border bg-background p-4 space-y-3 cursor-pointer transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isOver ? 'border-primary ring-2 ring-primary bg-primary/5' : 'border-border'} ${dropOk === false ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-sm font-semibold truncate">{group.name}</h3>
        <span className="text-[10px] rounded-full border border-border px-1.5 text-muted-foreground shrink-0">{group.platform === 'MT5' ? 'MT5' : 'Futures'}</span>
        {group.enabled === false && <span className="flex items-center gap-1 text-[10px] text-chart-4 shrink-0"><Pause className="w-3 h-3" />Paused</span>}
        <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground shrink-0 transition-transform group-hover/card:translate-x-0.5" />
      </div>

      <div className="space-y-1.5" data-testid="card-scripts">
        {ranked.length ? ranked.slice(0, 1).map(({ script, e }) => (
          <div key={script.id} className="flex items-center gap-2 min-w-0 text-xs">
            <RankAvatar seed={script.id} xp={script.xp} step={SCRIPT_STEP} size={24} label={script.name} />
            <span className="font-medium truncate">{script.name}</span>
            <span className={`ml-auto tabular-nums whitespace-nowrap ${e.net > 0 ? 'text-emerald-400' : e.net < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{signedMoney(e.net)}</span>
          </div>
        )) : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileCode2 className="w-3.5 h-3.5" />No script yet: drag one here</p>}
      </div>

      <div className="rounded-lg bg-card/60 px-3 py-2 flex items-center gap-3" data-testid="card-pnl">
        <div className="text-[11px] leading-4 tabular-nums whitespace-nowrap">
          <p className="text-emerald-400">{signedMoney(st.profit)}</p>
          <p className="text-red-400">{money(st.loss)}</p>
        </div>
        <p className={`ml-auto text-lg font-semibold tabular-nums whitespace-nowrap ${st.pnl > 0 ? 'text-emerald-400' : st.pnl < 0 ? 'text-red-400' : ''}`}>{signedMoney(st.pnl)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-card/60 py-1.5">
          <p className="text-sm font-semibold tabular-nums">{st.made}<span className="text-muted-foreground">/{st.max}</span></p>
          <p className="text-[10px] text-muted-foreground">Trades made</p>
        </div>
        <div className="rounded-lg bg-card/60 py-1.5">
          <p className="text-sm font-semibold tabular-nums"><span className="text-emerald-400">{st.passed}</span> · <span className="text-red-400">{st.failed}</span> · {st.current}</p>
          <p className="text-[10px] text-muted-foreground whitespace-nowrap">Passed · Failed · Current</p>
        </div>
      </div>

      <div className="flex items-center gap-1 min-h-[28px]">
        {members.slice(0, 7).map((a) => <RankAvatar key={a.id} seed={a.avatar_seed || a.id} xp={a.xp} size={28} label={a.display_name || a.label} />)}
        {members.length > 7 && <span className="text-xs text-muted-foreground ml-1">+{members.length - 7}</span>}
        {!members.length && <span className="text-xs text-muted-foreground">No accounts: drag them here</span>}
        <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">{members.length} account{members.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}
