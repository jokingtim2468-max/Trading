import { useState } from 'react';

const $ = (v) => (v == null ? '–' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const tone = (left) => (left == null ? '#787b86' : left < 0.25 ? '#f23645' : left < 0.5 ? '#ff9800' : '#089981');

// A bar: how much of a limit is left (full = untouched)
function Bar({ label, left, of, testid }) {
  const share = of ? Math.max(0, Math.min(1, left / of)) : null;
  return (
    <div className="space-y-0.5" data-testid={testid}>
      <div className="flex justify-between gap-3"><span className="text-[#9598a1]">{label}</span><span className="tabular-nums" style={{ color: tone(share) }}>{$(left)} left of {$(of)}</span></div>
      <div className="h-1 rounded bg-[#2a2e39] overflow-hidden"><div className="h-full rounded transition-[width] duration-500" style={{ width: `${(share ?? 0) * 100}%`, background: tone(share) }} /></div>
    </div>
  );
}

// Top right of the chart: each account's firm limits live (daily loss, max loss, target), tightest account first.
// Click the header to fold it.
export default function LimitsHud({ rows }) {
  const [open, setOpen] = useState(true);
  const list = rows.filter((r) => r.daily_limit || r.max_loss || r.target).sort((a, b) => (a.room ?? Infinity) - (b.room ?? Infinity)).slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="absolute right-[72px] top-2 z-10 w-[250px] rounded-lg bg-[#1e222d]/90 backdrop-blur border border-[#363a45] text-[11px] text-[#d1d4dc] shadow-[0_6px_18px_rgba(0,0,0,.4)]" data-testid="limits-hud">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex justify-between px-2.5 py-1.5 font-semibold"><span>Account limits</span><span className="text-[#787b86]">{open ? '−' : '+'}</span></button>
      {open && list.map((r) => {
        const target = r.target && r.start ? r.start + r.target : null;
        const toTarget = target ? target - r.balance : null;
        return (
          <div key={r.id} className="px-2.5 pb-2 pt-1 border-t border-[#2a2e39] space-y-1.5" data-testid="limits-row">
            <div className="flex justify-between"><span className="truncate">{r.name}{r.firm ? ` · ${r.firm}` : ''}</span><span className="tabular-nums">{$(r.balance)} · today <span style={{ color: r.day_pnl >= 0 ? '#089981' : '#f23645' }}>{$(r.day_pnl)}</span></span></div>
            {r.daily_limit && <Bar label="Daily loss" left={r.to_daily} of={r.daily_limit} testid="limits-daily" />}
            {r.max_loss && <Bar label="Max loss" left={r.to_floor} of={r.max_loss} testid="limits-max" />}
            {target && <div className="flex justify-between"><span className="text-[#9598a1]">Profit target</span><span className="tabular-nums">{toTarget <= 0 ? <span className="text-[#089981]">reached</span> : `${$(toTarget)} to go`}</span></div>}
          </div>
        );
      })}
    </div>
  );
}
