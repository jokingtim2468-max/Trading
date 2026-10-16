import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { client } from '@/api/client';
import useAccounts from '@/hooks/useAccounts';
import { logSetup } from '@/lib/copy';
import usePointerDrop from '@/hooks/usePointerDrop';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MT5_SERVERS, PLATFORMS, SORTS, sortAccounts, familyOf, groupFamily, groupMembers } from '@/lib/accounts';
import GroupTabs from '@/components/accounts/GroupTabs';
import GroupDialog from '@/components/accounts/GroupDialog';
import GroupOverview from '@/components/copy/GroupOverview';
import ScriptsPanel from '@/components/copy/ScriptsPanel';
import ScriptDialog from '@/components/copy/ScriptDialog';
import CopyInsights from '@/components/copy/CopyInsights';
import AccountCard from '@/components/accounts/AccountCard';
import AccountDialog from '@/components/accounts/AccountDialog';
import ChartLoader from '@/components/quant/ChartLoader';

export default function Accounts() {
  const { toast } = useToast();
  const data = useAccounts();
  const [platform, setPlatform] = useState('all');
  const [sort, setSort] = useState('name');
  const [tab, setTab] = useState('all');
  const [dragging, setDragging] = useState(null);
  const [editing, setEditing] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [scriptDialog, setScriptDialog] = useState(null);
  const [over, overRef] = usePointerDrop(!!dragging);
  const accounts = data.accounts || [];
  const groups = data.groups;
  const byId = (id) => accounts.find((a) => a.id === id);
  const servers = [...new Set([...accounts.map((a) => a.server).filter(Boolean), ...MT5_SERVERS])];
  const inGroup = (a) => groups.some((g) => g.id === a.group_id);
  const activeGroup = groups.find((g) => g.id === tab) || null;
  const activeTab = tab === 'all' || tab === 'none' || activeGroup ? tab : 'all';

  const ofPlatform = platform === 'all' ? accounts : accounts.filter((a) => a.platform === platform);
  const inTab = ofPlatform.filter((a) => (activeTab === 'all' ? true : activeTab === 'none' ? !inGroup(a) : a.group_id === activeTab));
  const shown = sortAccounts(inTab, sort, groups);
  const counts = { all: ofPlatform.length, none: ofPlatform.filter((a) => !inGroup(a)).length };
  for (const g of groups) counts[g.id] = ofPlatform.filter((a) => a.group_id === g.id).length;
  const leads = new Set(groups.map((g) => groupMembers(g, accounts)[0]?.id).filter(Boolean));

  // Dropping a script on a group (its tab or its script slot) makes every account in it trade that script
  const dropScript = async (scriptId, droppableId) => {
    const g = groups.find((x) => x.id === droppableId.replace(/^(tab|slot):/, ''));
    const script = data.scripts.find((s) => s.id === scriptId);
    if (!g || !script || g.script_id === script.id) return;
    await data.setGroupScript(g.id, script.id);
    setTab(g.id);
    toast({ title: `${g.name} now trades ${script.name}`, description: "Every active account in the group copies the script's alerts." });
  };

  // Dropping an account on a group tab moves it there (MT5 with MT5, futures with futures)
  // The target is what the pointer is over when let go (tabs and the script slot are data-drop targets)
  const onDragEnd = ({ draggableId }) => {
    const drop = overRef.current || '';
    setDragging(null);
    data.pause(false);
    if (draggableId.startsWith('script:')) { if (drop) dropScript(draggableId.slice(7), drop); return; }
    if (!drop.startsWith('tab:')) return;
    const target = drop.slice(4);
    const acc = byId(draggableId);
    if (!acc || !target || target === 'all') return;
    if (target === 'none') { if (acc.group_id) data.moveAccount(acc.id, ''); return; }
    const g = groups.find((x) => x.id === target);
    if (!g) return;
    if (groupFamily(g) !== familyOf(acc.platform)) {
      toast({ title: "Can't add that account", description: `${g.name} is a ${groupFamily(g) === 'MT5' ? 'MT5' : 'futures'} group.`, variant: 'destructive' });
      return;
    }
    if (acc.group_id !== g.id) data.moveAccount(acc.id, g.id);
  };
  const toggle = async (g) => {
    await client.entities.CopyGroup.update(g.id, { enabled: g.enabled === false });
    await logSetup(`${g.name} ${g.enabled === false ? 'resumed: copying again' : 'paused: signals are not copied'}`, { group_id: g.id });
    data.reload();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Copy trading</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Your scripts, the accounts that trade them, and the groups that copy them</span>
      </header>
      {!data.accounts ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <DragDropContext
          onDragStart={({ draggableId }) => { data.pause(true); setDragging(draggableId.startsWith('script:') ? 'script' : familyOf(byId(draggableId)?.platform)); }}
          onDragEnd={onDragEnd}>
        <div className="max-w-7xl mx-auto p-4 md:p-6 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
          <div className="lg:sticky lg:top-20">
            <ScriptsPanel scripts={data.scripts} groups={groups} onAdd={() => setScriptDialog({})} onEdit={(s) => setScriptDialog({ script: s })} />
          </div>
          <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Platform">
              {[{ id: 'all', title: 'All platforms' }, ...PLATFORMS].map((p) => {
                const n = p.id === 'all' ? accounts.length : accounts.filter((a) => a.platform === p.id).length;
                return (
                  <button key={p.id} role="tab" aria-selected={platform === p.id} onClick={() => setPlatform(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${platform === p.id ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'}`}>
                    {p.title} <span className="text-xs opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-9 w-40 ml-auto" aria-label="Sort accounts"><SelectValue /></SelectTrigger>
              <SelectContent>{SORTS.map((s) => <SelectItem key={s.id} value={s.id}>Sort: {s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" onClick={() => setEditing({})}><Plus className="w-4 h-4 mr-1" />Add account</Button>
          </div>
          <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-4 shadow-raised">
              <GroupTabs groups={groups} counts={counts} active={activeTab} onSelect={setTab} dropFamily={dragging} over={over}
                onNew={() => setGroupDialog({})} onRename={setGroupDialog} onToggle={toggle} onDelete={data.deleteGroup} />
              <p className="text-[11px] text-muted-foreground -mt-2">Drag an account onto a group to add it, and a script onto a group to have its accounts trade it.</p>
              {activeGroup && (
                <GroupOverview group={activeGroup} accounts={accounts} trades={data.trades} scripts={data.scripts} onChanged={data.reload}
                  dropScript={dragging === 'script'} over={over} onRemoveScript={() => data.setGroupScript(activeGroup.id, '')} />
              )}
              <Droppable droppableId="list" isDropDisabled>
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((a, i) => (
                      <AccountCard key={a.id} index={i} account={a} group={groups.find((g) => g.id === a.group_id)} isLead={leads.has(a.id)}
                        onEdit={(acc) => setEditing({ account: acc })} />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            {!shown.length && (
              <p className="text-sm text-muted-foreground">
                {accounts.length === 0 ? 'No accounts yet. Add your MT5, Tradovate or TradingView accounts: type the account number or name and QuantBot picks the platform.'
                  : activeGroup ? "Drag accounts onto this group's tab to add them." : 'No accounts match this view.'}
              </p>
            )}
          </section>
          <CopyInsights data={data} scope={activeTab} />
          </div>
        </div>
        </DragDropContext>
      )}
      {scriptDialog && (
        <ScriptDialog script={scriptDialog.script} config={data.config} onClose={() => setScriptDialog(null)}
          onDelete={async (sc) => { setScriptDialog(null); await data.deleteScript(sc); }}
          onSaved={(sc, isNew) => { data.reload(); setScriptDialog(isNew ? { script: sc } : null); }} />
      )}
      {editing && (
        <AccountDialog account={editing.account} servers={servers} groups={groups}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} />
      )}
      {groupDialog && (
        <GroupDialog group={groupDialog} family={platform === 'MT5' ? 'MT5' : 'Futures'} onClose={() => setGroupDialog(null)}
          onSaved={(g) => { setGroupDialog(null); if (g) setTab(g.id); data.reload(); }} />
      )}
    </div>
  );
}
