import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';

const { TradingAccount, CopyGroup, Script, AccountTrade } = client.entities;
const POLL_MS = 3000;

// Accounts, copy groups, scripts and their copied trades; refreshed every 3 s so webhook trades show up live
export default function useAccounts() {
  const [accounts, setAccounts] = useState(null);
  const [groups, setGroups] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [config, setConfig] = useState(null);
  const paused = useRef(false); // no refresh mid-drag

  const reload = useCallback(async () => {
    const [a, g, s, t] = await Promise.all([
      TradingAccount.filter({}, { sort: 'created_date', limit: 200 }),
      CopyGroup.filter({}, { sort: 'created_date', limit: 100 }),
      Script.filter({}, { sort: 'created_date', limit: 100 }),
      AccountTrade.filter({}, { sort: '-opened_at', limit: 2000 }),
    ]);
    setAccounts(a.items);
    setGroups(g.items);
    setScripts(s.items);
    setTrades(t.items);
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/signals/config').then((r) => r.json()).then(setConfig).catch(() => {});
    const t = setInterval(() => { if (!paused.current && document.visibilityState !== 'hidden') reload().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const moveAccount = async (id, groupId) => {
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, group_id: groupId } : a)));
    await TradingAccount.update(id, { group_id: groupId });
  };

  const setGroupScript = async (groupId, scriptId) => {
    setGroups((list) => list.map((g) => (g.id === groupId ? { ...g, script_id: scriptId } : g)));
    await CopyGroup.update(groupId, { script_id: scriptId });
  };

  // Deleting a group stops copying for its accounts; the accounts stay
  const deleteGroup = async (group) => {
    const members = accounts.filter((a) => a.group_id === group.id);
    if (members.length) await TradingAccount.bulkUpdate(members.map((a) => ({ id: a.id, group_id: '' })));
    await CopyGroup.delete(group.id);
    reload();
  };

  // Deleting a script takes it off its groups; trades it made stay in the history
  const deleteScript = async (script) => {
    for (const g of groups.filter((x) => x.script_id === script.id)) await CopyGroup.update(g.id, { script_id: '' });
    await Script.delete(script.id);
    reload();
  };

  return { accounts, groups, scripts, trades, config, reload, moveAccount, setGroupScript, deleteGroup, deleteScript, pause: (on) => { paused.current = on; } };
}
