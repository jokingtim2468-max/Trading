import { Draggable } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Crown, FileCode2 } from 'lucide-react';
import { platformOf } from '@/lib/accounts';
import { ACCOUNT_STEP, levelFromXp, money, signedMoney, STAGE_LABELS, planFirm } from '@/lib/copy';
import RankAvatar, { RankName } from '@/components/copy/RankAvatar';

const BADGE = { MT5: 'text-chart-4 border-chart-4/40', Tradovate: 'text-primary border-primary/40', TradingView: 'text-foreground/80 border-foreground/30' };
const STATUS = { passed: 'text-emerald-400 border-emerald-500/40', failed: 'text-red-400 border-red-500/40' };

export default function AccountCard({ account, index, group, scriptNames = [], isLead, onEdit }) {
  const where = account.platform === 'MT5' ? account.server : account.environment === 'live' ? 'Live' : 'Demo';
  const name = account.display_name || account.label;
  const lv = levelFromXp(Number(account.xp) || 0, ACCOUNT_STEP);
  const start = Number(account.start_balance) || 0;
  const balance = account.balance ?? start;
  const status = account.status || 'active';
  return (
    <Draggable draggableId={account.id} index={index}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} data-account={account.label}
          className={`rounded-xl border border-border bg-background p-3 space-y-2 ${snapshot.isDragging ? 'shadow-float ring-1 ring-primary' : ''}`}>
          <div className="flex items-start gap-2.5">
            <RankAvatar seed={account.avatar_seed || account.id} xp={account.xp} size={46} label={name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">{isLead && <Crown className="w-3.5 h-3.5 text-chart-4" aria-label="Lead account" />}{name}</p>
              <p className="text-xs text-muted-foreground truncate">{account.display_name ? `${account.label} · ` : ''}{account.login ? `${account.login} on ${where}` : where}{account.firm ? `, ${account.firm}` : ''}</p>
              <p className="text-[11px] text-muted-foreground truncate"><RankName xp={account.xp} /> · {Math.round(lv.into)}/{lv.need} XP</p>
            </div>
            <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
          <p className={`flex items-center gap-1.5 text-xs min-w-0 ${scriptNames.length ? '' : 'text-muted-foreground'}`} data-testid="account-script">
            <FileCode2 className="w-3.5 h-3.5 shrink-0 text-primary" />
            <span className="truncate">{scriptNames.length ? scriptNames.join(', ') : group ? 'No script on this group yet' : 'No script: add it to a group'}</span>
          </p>
          {start > 0 && (
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <span>{money(balance)}</span>
              <span className={balance > start ? 'text-emerald-400' : balance < start ? 'text-red-400' : 'text-muted-foreground'}>{signedMoney(Math.round((balance - start) * 100) / 100)}</span>
              {account.withdrawn > 0 && <span className="text-[11px] text-muted-foreground whitespace-nowrap" title="Your share paid out">· {money(account.withdrawn)} out</span>}
              {account.stage && <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{planFirm(account.plan)} {STAGE_LABELS[account.stage]}</span>}
              {status !== 'active' && <span className={`${account.stage ? '' : 'ml-auto '}rounded-full border px-2 py-0.5 text-[11px] ${STATUS[status]}`} title={account.status_reason || ''}>{status === 'passed' ? 'Passed' : 'Failed'}</span>}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className={`rounded-full border px-2 py-0.5 ${BADGE[account.platform] || ''}`}>{platformOf(account.platform).title}</span>
            <span className="text-muted-foreground truncate min-w-0">{group ? group.name : 'Not in a group'}</span>
            <button type="button" aria-label={`Edit ${account.label}`} onClick={() => onEdit(account)} className="ml-auto p-1.5 rounded-md hover:bg-accent"><Pencil className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </Draggable>
  );
}
