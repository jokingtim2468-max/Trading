import { useCallback, useEffect, useState } from 'react';
import { client } from '@/api/client';

const { TradingAccount, CopyGroup } = client.entities;

export default function useAccounts() {
  const [accounts, setAccounts] = useState(null);
  const [groups, setGroups] = useState([]);

  const reload = useCallback(async () => {
    const [a, g] = await Promise.all([
      TradingAccount.filter({}, { sort: 'created_date', limit: 200 }),
      CopyGroup.filter({}, { sort: 'created_date', limit: 100 }),
    ]);
    setAccounts(a.items);
    setGroups(g.items);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const moveAccount = async (id, groupId) => {
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, group_id: groupId } : a)));
    await TradingAccount.update(id, { group_id: groupId });
  };

  // Deleting a group stops copying for its accounts; the accounts stay
  const deleteGroup = async (group) => {
    const members = accounts.filter((a) => a.group_id === group.id);
    if (members.length) await TradingAccount.bulkUpdate(members.map((a) => ({ id: a.id, group_id: '' })));
    await CopyGroup.delete(group.id);
    reload();
  };

  return { accounts, groups, reload, moveAccount, deleteGroup };
}