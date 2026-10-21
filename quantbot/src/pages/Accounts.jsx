import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { DragDropContext } from '@hello-pangea/dnd';
import { client } from '@/api/client';
import useAccounts from '@/hooks/useAccounts';
import usePointerDrop from '@/hooks/usePointerDrop';
import { logSetup, groupScriptIds, firmUsage } from '@/lib/copy';
import { MOTION, reducedMotion } from '@/lib/clickOrigin';
import { useToast } from '@/components/ui/use-toast';
import { MT5_SERVERS, familyOf, groupFamily } from '@/lib/accounts';
import GroupDialog from '@/components/accounts/GroupDialog';
import GroupCard from '@/components/copy/GroupCard';
import GroupDetail from '@/components/copy/GroupDetail';
import ReplaceDialog from '@/components/copy/ReplaceDialog';
import ScriptsPanel from '@/components/copy/ScriptsPanel';
import ScriptDialog from '@/components/copy/ScriptDialog';
import AccountDialog from '@/components/accounts/AccountDialog';
import ChartLoader from '@/components/quant/ChartLoader';
import FleetPanel from '@/components/fleet/FleetPanel';
import CopyInsights from '@/components/copy/CopyInsights';

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
  const openGroup = groups.find((g) => g.id === openId) || null;


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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Accounts</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Your accounts, their profiles, and the groups that copy your scripts</span>
      </header>
      {!data.accounts ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <DragDropContext
          autoScrollerOptions={AUTO_SCROLL}
          onDragStart={({ draggableId }) => { data.pause(true); setDragging(draggableId.startsWith('script:') ? 'script' : familyOf(byId(draggableId)?.platform)); }}
          onDragEnd={onDragEnd}>
          <div className="max-w-7xl mx-auto px-4 md:px-6 pt-4 md:pt-6">
            <FleetPanel onAddManual={() => setEditing({})} onEditAccount={(id) => setEditing({ account: byId(id) })} version={accounts.map((a) => a.group_id || '-').join()}
              groupsFor={(platform) => groups.filter((g) => groupFamily(g) === familyOf(platform))} onGroup={(id, groupId) => byId(id) && dropAccount(byId(id), `tab:${groupId || 'none'}`)} />
          </div>
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
                            <div className="ml-auto flex flex-wrap gap-1.5" data-testid="firm-usage">
                              {firmUsage(accounts).map((u) => {
                                const full = (u.max && u.funded >= u.max) || (u.maxCapital && u.capital >= u.maxCapital);
                                return (
                                  <span key={u.firm} className={`text-[11px] rounded-full border px-2 py-0.5 whitespace-nowrap ${full ? 'border-chart-4/50 text-chart-4' : 'border-border text-muted-foreground'}`}
                                    title={u.max ? `${u.firm} allows ${u.max} funded accounts per person` : `${u.firm} allows any number of accounts, $${u.maxCapital.toLocaleString('en-US')} funded at once`}>
                                    {u.firm} funded {u.max ? `${u.funded}/${u.max}` : `$${(u.capital / 1000).toLocaleString('en-US')}K / $${(u.maxCapital / 1000).toLocaleString('en-US')}K`}
                                  </span>
                                );
                              })}
                            </div>
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
              <CopyInsights data={data} scope={openGroup ? openGroup.id : 'all'} />
            </div>
          </div>
        </DragDropContext>
      )}
      {editing && (
        <AccountDialog account={editing.account} accounts={accounts} servers={servers} groups={groups}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} />
      )}
      {groupDialog && (
        <GroupDialog group={groupDialog} family="Futures" onClose={() => setGroupDialog(null)}
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
