import { Droppable } from '@hello-pangea/dnd';
import { Pause, Plus } from 'lucide-react';
import GroupMenu from './GroupMenu';

// Tabs: every account, accounts not in a group, then each copy group. Dropping an account on a group tab moves it in.
export default function GroupTabs({ groups, counts, active, onSelect, dropFamily, onNew, onRename, onToggle, onDelete }) {
  const tabs = [{ id: 'all', name: 'All accounts' }, { id: 'none', name: 'Not in a group' }, ...groups];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((t) => {
        const family = t.platform === 'MT5' ? 'MT5' : 'Futures';
        const droppable = t.id !== 'all' && (t.id === 'none' || !dropFamily || dropFamily === family);
        return (
          <Droppable key={t.id} droppableId={`tab:${t.id}`} direction="horizontal" isDropDisabled={!droppable}>
            {(provided, snapshot) => (
              <div ref={provided.innerRef} {...provided.droppableProps}
                className={`flex items-center rounded-full border text-sm transition-colors ${active === t.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'} ${snapshot.isDraggingOver ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''} ${dropFamily && !droppable ? 'opacity-40' : ''}`}>
                <button onClick={() => onSelect(t.id)} className="flex items-center gap-1.5 px-3 py-1.5">
                  {t.enabled === false && <Pause className="w-3 h-3" />}
                  {t.name}
                  {t.platform && <span className="text-[10px] opacity-70">{family === 'MT5' ? 'MT5' : 'Futures'}</span>}
                  <span className="text-xs opacity-70">{counts[t.id] || 0}</span>
                </button>
                {t.platform && active === t.id && <GroupMenu group={t} onRename={onRename} onToggle={onToggle} onDelete={onDelete} />}
                <span className="hidden">{provided.placeholder}</span>
              </div>
            )}
          </Droppable>
        );
      })}
      <button onClick={onNew} className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent">
        <Plus className="w-3.5 h-3.5" />New group
      </button>
    </div>
  );
}
