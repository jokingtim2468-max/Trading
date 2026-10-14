import { useEffect, useState } from 'react';
import { copierAccount, copierGroup } from '@/lib/accounts';

// A copy-trading engine, when one is installed, exposes itself here; without it accounts are managed but not connected
const bridge = typeof window !== 'undefined' ? window.quantbotDesktop || null : null;

export default function useDesktopCopier(accounts, groups) {
  const [status, setStatus] = useState({});
  const [log, setLog] = useState([]);
  const [secrets, setSecrets] = useState({});
  const [terminals, setTerminals] = useState([]);

  useEffect(() => {
    if (!bridge) return undefined;
    bridge.invoke('status').then((s) => { setStatus(s.accounts); setLog(s.log); });
    bridge.invoke('terminals').then(setTerminals);
    return bridge.onEvent((ev) => {
      if (ev.type === 'status') setStatus((s) => ({ ...s, [ev.accountId]: ev }));
      if (ev.type === 'copy') setLog((l) => [ev, ...l].slice(0, 50));
    });
  }, []);

  // Keep the copier's routing identical to the groups on screen
  useEffect(() => {
    if (!bridge || !accounts) return;
    bridge.invoke('sync', { accounts: accounts.map(copierAccount), groups: groups.map(copierGroup) });
    bridge.invoke('hasSecrets', accounts.map((a) => a.id)).then(setSecrets);
  }, [accounts, groups]);

  return { bridge, status, log, secrets, terminals };
}