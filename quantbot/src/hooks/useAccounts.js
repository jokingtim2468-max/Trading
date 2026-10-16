import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';
import { logSetup, groupScriptIds } from '@/lib/copy';

const { TradingAccount, CopyGroup, Script, AccountTrade, CopyEvent } = client.entities;
const POLL_MS = 3000;

// Accounts, copy groups, scripts and their copied trades; refreshed every 3 s so webhook trades show up live
export default function useAccounts() {
  const [accounts, setAccounts] = useState(null);
  const [groups, setGroups] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [events, setEvents] = useState([]);
  const [config, setConfig] = useState(null);
  const paused = useRef(false); // no refresh mid-drag

  const reload = useCallback(async () => {
    const [a, g, s, t, e] = await Promise.all([
      TradingAccount.filter({}, { sort: 'created_date', limit: 200 }),
      CopyGroup.filter({}, { sort: 'created_date', limit: 100 }),
      Script.filter({}, { sort: 'created_date', limit: 100 }),
      AccountTrade.filter({}, { sort: '-opened_at', limit: 5000 }),
      CopyEvent.filter({}, { sort: '-created_date', limit: 2000 }),
    ]);
    setAccounts(a.items);
    setGroups(g.items);
    setScripts(s.items);
    setTrades(t.items);
    setEvents(e.items);
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/signals/config').then((r) => r.json()).then(setConfig).catch(() => {});
    const t = setInterval(() => { if (!paused.current && document.visibilityState !== 'hidden') reload().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const nameOf = (a) => a?.display_name || a?.label || 'account';

  const moveAccount = async (id, groupId) => {
    const acc = accounts.find((a) => a.id === id);
    const from = groups.find((g) => g.id === acc?.group_id), to = groups.find((g) => g.id === groupId);
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, group_id: groupId } : a)));
    await TradingAccount.update(id, { group_id: groupId });
    await logSetup(to ? `${nameOf(acc)} added to ${to.name}${from ? ` (from ${from.name})` : ''}` : `${nameOf(acc)} taken out of ${from?.name || 'its group'}`,
      { account_id: id, group_id: groupId || from?.id || '' });
  };

  // One script per group, so an account never holds trades from two scripts. Replacing a script clears the old
  // one's open trades from the group's accounts.
  const openTradesOf = (query) => AccountTrade.filter({ ...query, status: 'open' });
  const setScript = async (groupId, scriptId) => {
    const g = groups.find((x) => x.id === groupId), sc = scripts.find((x) => x.id === scriptId);
    if (!g) return;
    const old = groupScriptIds(g).filter((id) => id !== scriptId);
    let cleared = 0;
    for (const id of old) {
      const open = await openTradesOf({ group_id: g.id, script_id: id });
      if (open.length) await AccountTrade.deleteMany({ id: { $in: open.map((t) => t.id) } });
      cleared += open.length;
    }
    const oldNames = old.map((id) => scripts.find((x) => x.id === id)?.name || 'a deleted script').join(', ');
    setGroups((list) => list.map((x) => (x.id === g.id ? { ...x, script_ids: scriptId ? [scriptId] : [], script_id: '' } : x)));
    await CopyGroup.update(g.id, { script_ids: scriptId ? [scriptId] : [], script_id: '' });
    await logSetup(sc ? `${g.name} now trades ${sc.name}${old.length ? ` (replaced ${oldNames}${cleared ? `, cleared ${cleared} open trade${cleared === 1 ? '' : 's'}` : ''})` : ''}`
      : `${oldNames} taken off ${g.name}${cleared ? ` (cleared ${cleared} open trade${cleared === 1 ? '' : 's'})` : ''}`, { group_id: g.id, script_id: scriptId || old[0] || '' });
    reload();
  };
  // Open trades an account would carry into a group whose script is different (asked about before a move)
  const conflictsFor = async (accountId, groupId) => {
    const g = groups.find((x) => x.id === groupId);
    const keep = new Set(g ? groupScriptIds(g) : []);
    return (await openTradesOf({ account_id: accountId })).filter((t) => !keep.has(t.script_id));
  };
  const clearTrades = async (list, why) => {
    if (!list.length) return;
    await AccountTrade.deleteMany({ id: { $in: list.map((t) => t.id) } });
    await logSetup(why, { account_id: list[0].account_id, script_id: list[0].script_id });
  };

  // Deleting a group stops copying for its accounts; the accounts stay
  const deleteGroup = async (group) => {
    const members = accounts.filter((a) => a.group_id === group.id);
    if (members.length) await TradingAccount.bulkUpdate(members.map((a) => ({ id: a.id, group_id: '' })));
    await CopyGroup.delete(group.id);
    await logSetup(`Group ${group.name} deleted (${members.length} account${members.length === 1 ? '' : 's'} left without a group)`, { group_id: group.id });
    reload();
  };

  // Deleting a script takes it off its groups; trades it made stay in the history
  const deleteScript = async (script) => {
    for (const g of groups.filter((x) => groupScriptIds(x).includes(script.id))) await setScript(g.id, '');
    await Script.delete(script.id);
    await logSetup(`Script ${script.name} deleted`, { script_id: script.id });
    reload();
  };

  return { accounts, groups, scripts, trades, events, config, reload, moveAccount, setScript, conflictsFor, clearTrades, deleteGroup, deleteScript, pause: (on) => { paused.current = on; } };
}
