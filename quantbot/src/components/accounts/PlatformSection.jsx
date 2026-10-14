import { useState } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { client } from '@/api/client';
import { Button } from '@/components/ui/button';
import GroupTabs from './GroupTabs';
import GroupDialog from './GroupDialog';
import AccountCard from './AccountCard';

export default function PlatformSection({ platform, accounts, groups, copier, dropDisabled, onAdd, onEdit, onChanged, onDeleteGroup }) {
  const [tab, setTab] = useState('none');
  const [groupDialog, setGroupDialog] = useState(null);
  const groupOf = (a) => (groups.some((g) => g.id === a.group_id) ? a.group_id : 'none');
  const active = tab === 'none' || groups.some((g) => g.id === tab) ? tab : 'none';
  const shown = accounts.filter((a) => groupOf(a) === active);
  const counts = accounts.reduce((c, a) => ({ ...c, [groupOf(a)]: (c[groupOf(a)] || 0) + 1 }), {});
  const toggle = async (g) => { await client.entities.CopyGroup.update(g.id, { enabled: g.enabled === false }); onChanged(); };
  const empty = active !== 'none' ? 'Drag accounts onto this tab to copy trades between them.'
    : accounts.length ? 'Every account is in a copy group.' : 'No accounts yet.';

  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{platform.title}</h2>
          <p className="text-xs text-muted-foreground">{platform.subtitle}</p>
        </div>
        <Button size="sm" onClick={onAdd}><Plus className="w-4 h-4 mr-1" />Add account</Button>
      </div>
      <GroupTabs platform={platform.id} groups={groups} counts={counts} active={active} onSelect={setTab} dropDisabled={dropDisabled}
        onNew={() => setGroupDialog({})} onRename={setGroupDialog} onToggle={toggle} onDelete={onDeleteGroup} />
      <p className="text-[11px] text-muted-foreground -mt-2">Drag an account onto a tab to move it. A trade on any account in a group is copied to every other account in it.</p>
      <Droppable droppableId={`list:${platform.id}`} isDropDisabled>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((a, i) => (
              <AccountCard key={a.id} index={i} account={a} status={copier.status[a.id]} hasSecret={copier.secrets[a.id]} bridge={copier.bridge} onEdit={onEdit} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      {!shown.length && <p className="text-sm text-muted-foreground">{empty}</p>}
      {groupDialog && (
        <GroupDialog group={groupDialog} platform={platform.id} onClose={() => setGroupDialog(null)}
          onSaved={(g) => { setGroupDialog(null); if (g) setTab(g.id); onChanged(); }} />
      )}
    </section>
  );
}