import { Draggable } from '@hello-pangea/dnd';
import { GripVertical, KeyRound, Pencil, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATES = {
  connected: ['bg-green-500', 'Connected'],
  starting: ['bg-amber-400 animate-pulse', 'Connecting'],
  error: ['bg-red-500', 'Needs attention'],
  stopped: ['bg-muted-foreground/40', 'Offline'],
};

export default function AccountCard({ account, index, status, hasSecret, bridge, onEdit }) {
  const state = status?.state || 'stopped';
  const [dot, label] = STATES[state] || STATES.stopped;
  const on = state !== 'stopped';
  const where = account.platform === 'MT5' ? account.server : account.environment === 'live' ? 'Live' : 'Demo';
  const money = typeof status?.balance === 'number' ? `${status.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${status.currency || ''}` : '';

  return (
    <Draggable draggableId={account.id} index={index}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
          className={`rounded-xl border border-border bg-background p-3 space-y-2 ${snapshot.isDragging ? 'shadow-xl ring-1 ring-primary' : ''}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{account.label}</p>
              <p className="text-xs text-muted-foreground truncate">{account.login}{where ? ` · ${where}` : ''}</p>
            </div>
            <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${dot}`} />{label}
            {money && <span className="ml-auto text-muted-foreground">{money}</span>}
          </div>
          {status?.detail && <p className={`text-[11px] leading-snug ${state === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>{status.detail}</p>}
          <div className="flex items-center gap-2 pt-1">
            {bridge && hasSecret === false ? (
              <Button size="sm" variant="outline" onClick={() => onEdit(account)}><KeyRound className="w-3.5 h-3.5 mr-1" />Add password</Button>
            ) : (
              <Button size="sm" variant={on ? 'outline' : 'default'} disabled={!bridge} onClick={() => bridge.invoke(on ? 'disconnect' : 'connect', account.id)}>
                <Power className="w-3.5 h-3.5 mr-1" />{on ? 'Disconnect' : 'Connect'}
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 ml-auto" onClick={() => onEdit(account)}><Pencil className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      )}
    </Draggable>
  );
}