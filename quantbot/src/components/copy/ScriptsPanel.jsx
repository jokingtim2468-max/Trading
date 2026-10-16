import { Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, Pencil, GripVertical, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SCRIPT_STEP, money, groupScriptIds } from '@/lib/copy';
import RankAvatar, { RankName } from './RankAvatar';

// Your scripts, best first (by XP): drag one onto a group to have every account in it trade its signals
export default function ScriptsPanel({ scripts, groups, onAdd, onEdit }) {
  const ranked = [...scripts].sort((a, b) => (b.xp || 0) - (a.xp || 0) || a.name.localeCompare(b.name));
  return (
    <section className="bg-card border border-border rounded-2xl p-4 space-y-3 shadow-raised" aria-label="Scripts">
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4 text-chart-4" />
        <h2 className="text-sm font-semibold">Scripts</h2>
        <Button size="sm" variant="outline" className="ml-auto h-8" onClick={onAdd}><Plus className="w-3.5 h-3.5 mr-1" />Add script</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Drag a script onto a group. Ranked by XP: 1,000 for the first rank, then 2,000, 3,000…</p>
      <Droppable droppableId="scripts" isDropDisabled>
        {(provided) => (
          <ol ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
            {ranked.map((s, i) => {
              const on = groups.filter((g) => groupScriptIds(g).includes(s.id));
              return (
                <Draggable key={s.id} draggableId={`script:${s.id}`} index={i}>
                  {(p, snap) => (
                    <li ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps} data-script={s.name}
                      className={`flex items-center gap-2.5 rounded-xl border border-border bg-background p-2.5 ${snap.isDragging ? 'shadow-float ring-1 ring-primary' : ''}`}>
                      <span className="w-4 text-xs text-muted-foreground tabular-nums text-center">{i + 1}</span>
                      <RankAvatar seed={s.id} xp={s.xp} step={SCRIPT_STEP} size={40} label={s.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate"><RankName xp={s.xp} step={SCRIPT_STEP} /> · {s.xp || 0} XP</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {s.trades || 0} trade{s.trades === 1 ? '' : 's'} · <span className={(s.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{money(s.pnl || 0)}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">{on.length ? `Trading ${on.map((g) => g.name).join(', ')}` : 'Not on a group'}</p>
                      </div>
                      <button type="button" aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)} className="p-1.5 rounded-md hover:bg-accent"><Pencil className="w-3.5 h-3.5" /></button>
                      <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                    </li>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </ol>
        )}
      </Droppable>
      {!scripts.length && <p className="text-sm text-muted-foreground">No scripts yet. Add a Pine or MT5 script, or take one from a QuantBot chat.</p>}
    </section>
  );
}
