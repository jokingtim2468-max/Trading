import { useState } from 'react';

const KEY = 'quantbot.lucidPro';
const DEFAULTS = { size: 50000, dllOn: true, lotsPerMini: '1' };

// LucidPro account settings, remembered on this device
export default function useLucidSettings() {
  const [s, setS] = useState(() => ({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }));
  const set = (key, value) => setS((cur) => {
    const next = { ...cur, [key]: value };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  });
  return [s, set];
}