import { Droppable } from '@hello-pangea/dnd';
import { Pause, Plus } from 'lucide-react';
import GroupMenu from './GroupMenu';

// Each tab is a drop target: dropping an account on it moves the account into that copy group
export default function GroupTabs({ platform, groups, counts, active, onSelect, dropDisabled, onNew, onRename, onToggle, onDelete }) {
  const tabs = [{ id: 'none', name: 'Not copying' }, ...groups];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((t) => (
        <Droppable key={t.id} droppableId={`tab:${platform}:${t.id}`} direction="horizontal" isDropDisabled={dropDisabled}>
          {(provided, snapshot) => (
            <div ref={provided.innerRef} {...provided.droppableProps}
              className={`flex items-center rounded-full border text-sm transition-colors ${active === t.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'} ${snapshot.isDraggingOver ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''}`}>
              <button onClick={() => onSelect(t.id)} className="flex items-center gap-1.5 px-3 py-1.5">
                {t.enabled === false && <Pause className="w-3 h-3" />}
                {t.name}
                <span className="text-xs opacity-70">{counts[t.id] || 0}</span>
              </button>
              {t.id !== 'none' && active === t.id && <GroupMenu group={t} onRename={onRename} onToggle={onToggle} onDelete={onDelete} />}
              <span className="hidden">{provided.placeholder}</span>
            </div>
          )}
        </Droppable>
      ))}
      <button onClick={onNew} className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent">
        <Plus className="w-3.5 h-3.5" />New group
      </button>
    </div>
  );
}