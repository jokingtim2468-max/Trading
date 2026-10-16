import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { client } from '@/api/client';
import useAccounts from '@/hooks/useAccounts';
import usePointerDrop from '@/hooks/usePointerDrop';
import { logSetup, groupScriptIds } from '@/lib/copy';
import { MOTION, reducedMotion } from '@/lib/clickOrigin';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MT5_SERVERS, PLATFORMS, SORTS, sortAccounts, familyOf, groupFamily, groupMembers } from '@/lib/accounts';
import GroupDialog from '@/components/accounts/GroupDialog';
import GroupCard from '@/components/copy/GroupCard';
import GroupDetail from '@/components/copy/GroupDetail';
import ReplaceDialog from '@/components/copy/ReplaceDialog';
import ScriptsPanel from '@/components/copy/ScriptsPanel';
import ScriptDialog from '@/components/copy/ScriptDialog';
import CopyInsights from '@/components/copy/CopyInsights';
import AccountCard from '@/components/accounts/AccountCard';
import AccountDialog from '@/components/accounts/AccountDialog';
import ChartLoader from '@/components/quant/ChartLoader';

// Overview <-> group: a group fades and slides in from the right; going back, the overview slides in from the left
function Slide({ id, from, children }) {
  const t = { duration: reducedMotion() ? 0 : MOTION.duration, ease: MOTION.ease };
  const x = from === 'right' ? 24 : -24;
  return (
    <motion.div key={id} initial={{ opacity: 0, x }} animate={{ opacity: 1, x: 0, transition: t }} exit={{ opacity: 0, x: -x, transition: t }}>
      {children}
    </motion.div>
  );
}

// Scroll the page only when dragging right up to the window's edge, so a drop target near the top stays put
const AUTO_SCROLL = { startFromPercentage: 0.1, maxScrollAtPercentage: 0.03 };

export default function Accounts() {
  const { toast } = useToast();
  const data = useAccounts();
  const [platform, setPlatform] = useState('all');
  const [sort, setSort] = useState('name');
  const [listFilter, setListFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [editing, setEditing] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [scriptDialog, setScriptDialog] = useState(null);
  const [ask, setAsk] = useState(null);
  const [over, overRef] = usePointerDrop(!!dragging);
  const accounts = data.accounts || [];
  const groups = data.groups;
  const byId = (id) => accounts.find((a) => a.id === id);
  const scriptName = (id) => data.scripts.find((s) => s.id === id)?.name || 'a deleted script';
  const servers = [...new Set([...accounts.map((a) => a.server).filter(Boolean), ...MT5_SERVERS])];
  const inGroup = (a) => groups.some((g) => g.id === a.group_id);
  const openGroup = groups.find((g) => g.id === openId) || null;

  const ofPlatform = platform === 'all' ? accounts : accounts.filter((a) => a.platform === platform);
  const filter = listFilter === 'group' && !openGroup ? 'all' : listFilter;
  const listed = ofPlatform.filter((a) => (filter === 'all' ? true : filter === 'none' ? !inGroup(a) : a.group_id === openGroup.id));
  const shown = sortAccounts(listed, sort, groups);
  const leads = new Set(groups.map((g) => groupMembers(g, accounts)[0]?.id).filter(Boolean));

  const open = (g) => setOpenId(g.id);

  // A script dropped on a group (its card, its open view or the script slot). A group runs one script, so an
  // account never holds two scripts' trades: if it already has one, ask before replacing it.
  const dropScript = async (scriptId, target) => {
    const g = groups.find((x) => x.id === target.replace(/^(tab|slot):/, ''));
    const script = data.scripts.find((s) => s.id === scriptId);
    if (!g || !script) return;
    const current = groupScriptIds(g);
    if (current.includes(script.id)) return;
    if (current.length) {
      const open = data.trades.filter((t) => t.group_id === g.id && t.status === 'open' && current.includes(t.script_id)).length;
      setAsk({
        text: `${g.name} already trades ${current.map(scriptName).join(', ')} on its accounts. You dropped ${script.name}.`,
        oldName: current.map(scriptName).join(', '), count: open,
        replace: async () => { await data.setScript(g.id, script.id); toast({ title: `${g.name} now trades ${script.name}`, description: `${current.map(scriptName).join(', ')} was cleared from its accounts.` }); },
        keep: () => logSetup(`Kept ${current.map(scriptName).join(', ')} on ${g.name} (${script.name} not added)`, { group_id: g.id, script_id: script.id }),
      });
      return;
    }
    await data.setScript(g.id, script.id);
    toast({ title: `${g.name} now trades ${script.name}`, description: "Every active account in the group copies the script's alerts." });
  };

  // An account dropped on a group (MT5 with MT5, futures with futures) or on "Not in a group"
  const dropAccount = async (acc, target) => {
    const id = target.slice(4);
    if (id === 'none') { if (acc.group_id) data.moveAccount(acc.id, ''); return; }
    const g = groups.find((x) => x.id === id);
    if (!g || acc.group_id === g.id) return;
    if (groupFamily(g) !== familyOf(acc.platform)) {
      toast({ title: "Can't add that account", description: `${g.name} is a ${groupFamily(g) === 'MT5' ? 'MT5' : 'futures'} group.`, variant: 'destructive' });
      return;
    }
    // Open trades from another script would sit next to the new group's script
    const clash = groupScriptIds(g).length ? await data.conflictsFor(acc.id, g.id) : [];
    if (clash.length) {
      const old = [...new Set(clash.map((t) => scriptName(t.script_id)))].join(', ');
      const name = acc.display_name || acc.label;
      setAsk({
        text: `${name} has an open ${old} trade, and ${g.name} trades ${groupScriptIds(g).map(scriptName).join(', ')}.`,
        oldName: old, count: clash.length,
        replace: async () => {
          await data.clearTrades(clash, `${name}: cleared ${clash.length} open ${old} trade${clash.length === 1 ? '' : 's'} to join ${g.name}`);
          await data.moveAccount(acc.id, g.id);
          data.reload();
        },
        keep: () => logSetup(`${name} kept its open ${old} trade and stayed out of ${g.name}`, { account_id: acc.id, group_id: g.id }),
      });
      return;
    }
    data.moveAccount(acc.id, g.id);
  };

  // The target is what the pointer is over when let go (cards, the open group, the script slot, list filters)
  const onDragEnd = ({ draggableId }) => {
    const drop = overRef.current || '';
    setDragging(null);
    data.pause(false);
    if (!drop) return;
    if (draggableId.startsWith('script:')) { dropScript(draggableId.slice(7), drop); return; }
    const acc = byId(draggableId);
    if (acc && drop.startsWith('tab:')) dropAccount(acc, drop);
  };
  const toggle = async (g) => {
    await client.entities.CopyGroup.update(g.id, { enabled: g.enabled === false });
    await logSetup(`${g.name} ${g.enabled === false ? 'resumed: copying again' : 'paused: signals are not copied'}`, { group_id: g.id });
    data.reload();
  };
  const dropFamily = (g) => (dragging === 'script' ? true : dragging ? dragging === groupFamily(g) : undefined);
  const chips = [
    { id: 'all', label: 'All accounts', n: ofPlatform.length },
    { id: 'none', label: 'Not in a group', n: ofPlatform.filter((a) => !inGroup(a)).length, drop: 'tab:none' },
    ...(openGroup ? [{ id: 'group', label: `In ${openGroup.name}`, n: ofPlatform.filter((a) => a.group_id === openGroup.id).length }] : []),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Copy trading</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Your scripts, the accounts that trade them, and the groups that copy them</span>
      </header>
      {!data.accounts ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <DragDropContext
          autoScrollerOptions={AUTO_SCROLL}
          onDragStart={({ draggableId }) => { data.pause(true); setDragging(draggableId.startsWith('script:') ? 'script' : familyOf(byId(draggableId)?.platform)); }}
          onDragEnd={onDragEnd}>
          <div className="max-w-7xl mx-auto p-4 md:p-6 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
            <div className="lg:sticky lg:top-20">
              <ScriptsPanel scripts={data.scripts} groups={groups} onAdd={() => setScriptDialog({})} onEdit={(s) => setScriptDialog({ script: s })} />
            </div>
            <div className="space-y-4 min-w-0">
              <section className="bg-card border border-border rounded-2xl p-4 md:p-5 shadow-raised" aria-label="Groups">
                <div className="relative overflow-x-clip">
                  <AnimatePresence mode="wait" initial={false}>
                    {openGroup ? (
                      <Slide id={`group-${openGroup.id}`} from="right">
                        <GroupDetail group={openGroup} accounts={accounts} trades={data.trades} scripts={data.scripts} over={over} dropScript={dragging === 'script'}
                          onClose={() => setOpenId(null)} onChanged={data.reload}
                          onRemoveScript={() => data.setScript(openGroup.id, '')}
                          onRemoveAccount={(a) => data.moveAccount(a.id, '')}
                          onRename={setGroupDialog} onToggle={toggle} onDelete={async (g) => { setOpenId(null); await data.deleteGroup(g); }} />
                      </Slide>
                    ) : (
                      <Slide id="overview" from="left">
                        <div className="space-y-3" data-testid="groups-overview">
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold">Groups</h2>
                            <span className="text-[11px] text-muted-foreground">Click a group to open it. Drag accounts and a script onto a group.</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {groups.map((g) => (
                              <GroupCard key={g.id} group={g} accounts={accounts} trades={data.trades} scripts={data.scripts} over={over}
                                dropOk={dropFamily(g)} onOpen={() => open(g)} />
                            ))}
                            <button type="button" onClick={() => setGroupDialog({})}
                              className="rounded-2xl border border-dashed border-border min-h-[150px] flex flex-col items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent">
                              <Plus className="w-5 h-5" />New group
                            </button>
                          </div>
                        </div>
                      </Slide>
                    )}
                  </AnimatePresence>
                </div>
              </section>

              <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-3 shadow-raised" aria-label="Accounts">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Platform">
                    {[{ id: 'all', title: 'All platforms' }, ...PLATFORMS].map((p) => {
                      const n = p.id === 'all' ? accounts.length : accounts.filter((a) => a.platform === p.id).length;
                      return (
                        <button key={p.id} role="tab" aria-selected={platform === p.id} onClick={() => setPlatform(p.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm border whitespace-nowrap ${platform === p.id ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'}`}>
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
                <div className="flex flex-wrap items-center gap-1.5">
                  {chips.map((c) => (
                    <button key={c.id} type="button" onClick={() => setListFilter(c.id)} aria-pressed={filter === c.id}
                      {...(c.drop ? { 'data-drop': c.drop } : {})}
                      className={`px-3 py-1 rounded-full text-xs border whitespace-nowrap transition-colors ${filter === c.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'} ${c.drop && over === c.drop ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''}`}>
                      {c.label} <span className="opacity-70">{c.n}</span>
                    </button>
                  ))}
                  <span className="text-[11px] text-muted-foreground">Drag an account onto a group to add it; onto &ldquo;Not in a group&rdquo; to take it out.</span>
                </div>
                <Droppable droppableId="list" isDropDisabled>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {shown.map((a, i) => {
                        const g = groups.find((x) => x.id === a.group_id);
                        return (
                          <AccountCard key={a.id} index={i} account={a} group={g} scriptNames={g ? groupScriptIds(g).map(scriptName) : []} isLead={leads.has(a.id)}
                            onEdit={(acc) => setEditing({ account: acc })} />
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
                {!shown.length && (
                  <p className="text-sm text-muted-foreground">
                    {accounts.length === 0 ? 'No accounts yet. Add your MT5, Tradovate or TradingView accounts: type the account number or name and QuantBot picks the platform.' : 'No accounts match this view.'}
                  </p>
                )}
              </section>
              <CopyInsights data={data} scope={openGroup ? openGroup.id : 'all'} />
            </div>
          </div>
        </DragDropContext>
      )}
      {editing && (
        <AccountDialog account={editing.account} servers={servers} groups={groups}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} />
      )}
      {groupDialog && (
        <GroupDialog group={groupDialog} family={platform === 'MT5' ? 'MT5' : 'Futures'} onClose={() => setGroupDialog(null)}
          onSaved={(g) => { setGroupDialog(null); if (g) setOpenId(g.id); data.reload(); }} />
      )}
      {scriptDialog && (
        <ScriptDialog script={scriptDialog.script} config={data.config} onClose={() => setScriptDialog(null)}
          onDelete={async (sc) => { setScriptDialog(null); await data.deleteScript(sc); }}
          onSaved={(sc, isNew) => { data.reload(); setScriptDialog(isNew ? { script: sc } : null); }} />
      )}
      <ReplaceDialog ask={ask} onReplace={async () => { const a = ask; setAsk(null); await a.replace(); }} onKeep={() => { const a = ask; setAsk(null); a?.keep?.(); }} />
    </div>
  );
}
