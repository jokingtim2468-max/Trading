import { Draggable } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Crown } from 'lucide-react';
import { platformOf } from '@/lib/accounts';

const BADGE = { MT5: 'text-chart-4 border-chart-4/40', Tradovate: 'text-primary border-primary/40', TradingView: 'text-foreground/80 border-foreground/30' };

export default function AccountCard({ account, index, group, isLead, onEdit }) {
  const where = account.platform === 'MT5' ? account.server : account.environment === 'live' ? 'Live' : 'Demo';
  return (
    <Draggable draggableId={account.id} index={index}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} data-account={account.label}
          className={`rounded-xl border border-border bg-background p-3 space-y-2 ${snapshot.isDragging ? 'shadow-float ring-1 ring-primary' : ''}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">{isLead && <Crown className="w-3.5 h-3.5 text-chart-4" aria-label="Lead account" />}{account.label}</p>
              <p className="text-xs text-muted-foreground truncate">{account.login}{where ? ` on ${where}` : ''}{account.firm ? `, ${account.firm}` : ''}</p>
            </div>
            <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`rounded-full border px-2 py-0.5 ${BADGE[account.platform] || ''}`}>{platformOf(account.platform).title}</span>
            <span className="text-muted-foreground truncate">{group ? group.name : 'Not in a group'}</span>
            <button type="button" aria-label={`Edit ${account.label}`} onClick={() => onEdit(account)} className="ml-auto p-1.5 rounded-md hover:bg-accent"><Pencil className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </Draggable>
  );
}
