import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DragDropContext } from '@hello-pangea/dnd';
import useAccounts from '@/hooks/useAccounts';
import useDesktopCopier from '@/hooks/useDesktopCopier';
import { MT5_SERVERS, PLATFORMS } from '@/lib/accounts';
import PlatformSection from '@/components/accounts/PlatformSection';
import AccountDialog from '@/components/accounts/AccountDialog';
import CopyLog from '@/components/accounts/CopyLog';
import DesktopNotice from '@/components/accounts/DesktopNotice';
import ChartLoader from '@/components/quant/ChartLoader';

export default function Accounts() {
  const data = useAccounts();
  const copier = useDesktopCopier(data.accounts, data.groups);
  const [dragging, setDragging] = useState(null);
  const [editing, setEditing] = useState(null);
  const accounts = data.accounts || [];
  const byId = (id) => accounts.find((a) => a.id === id);
  const servers = [...new Set([...accounts.map((a) => a.server).filter(Boolean), ...MT5_SERVERS])];

  // Dropping an account on a tab moves it into that copy group (same platform only)
  const onDragEnd = ({ draggableId, destination }) => {
    setDragging(null);
    const [kind, platform, groupId] = (destination?.droppableId || '').split(':');
    const acc = byId(draggableId);
    if (kind !== 'tab' || !acc || acc.platform !== platform) return;
    const target = groupId === 'none' ? '' : groupId;
    if ((acc.group_id || '') !== target) data.moveAccount(acc.id, target);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Accounts</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Trading logins and copy groups</span>
      </header>
      {!data.accounts ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
          <DesktopNotice available={!!copier.bridge} />
          <DragDropContext onDragStart={({ draggableId }) => setDragging(byId(draggableId)?.platform || null)} onDragEnd={onDragEnd}>
            {PLATFORMS.map((p) => (
              <PlatformSection key={p.id} platform={p} copier={copier}
                accounts={accounts.filter((a) => a.platform === p.id)} groups={data.groups.filter((g) => g.platform === p.id)}
                dropDisabled={!!dragging && dragging !== p.id}
                onAdd={() => setEditing({ platform: p.id })} onEdit={(a) => setEditing({ platform: a.platform, account: a })}
                onChanged={data.reload} onDeleteGroup={data.deleteGroup} />
            ))}
          </DragDropContext>
          <CopyLog log={copier.log} accounts={accounts} />
        </div>
      )}
      {editing && (
        <AccountDialog {...editing} copier={copier} servers={servers}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} />
      )}
    </div>
  );
}