import { useCallback, useEffect, useState } from 'react';
import { Plus, Settings2, ShieldCheck, Pause, Play, CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ProfileConfigurator from './ProfileConfigurator';
import { platformOf } from '@/lib/accounts';

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v) => (v > 0 ? `+${money(v)}` : money(v));
const PILL = {
  active: 'bg-chart-2/15 text-chart-2', passed: 'bg-cyan-400/15 text-cyan-300', failed: 'bg-destructive/15 text-destructive', paused: 'bg-muted text-muted-foreground',
};
const LABEL = { active: 'ACTIVE', passed: 'PASSED 🎯', failed: 'FAILED', paused: 'PAUSED' };
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });

// The simplified accounts tab: four numbers, one row per account (P&L, the script / profile it runs, its status),
// and three actions: edit its profile, audit a payout, pause it
export default function FleetPanel({ onAddManual, onEditAccount, groupsFor = () => [], onGroup, version }) {
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null); // { account } or {} for a new one
  const [audit, setAudit] = useState(null);
  const load = useCallback(() => fetch('/api/fleet').then((r) => r.json()).then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { load(); }, [version]);
  if (!data) return null;
  const { rows, kpis } = data;
  const status = (r) => (r.paused ? 'paused' : r.status);
  const cards = [['Active accounts', kpis.active, 'text-chart-2'], ['Passed accounts', kpis.passed, 'text-cyan-300'], ['Failed accounts', kpis.failed, kpis.failed ? 'text-destructive' : ''], ['Net fleet P&L', signed(kpis.net), kpis.net >= 0 ? 'text-chart-2' : 'text-destructive']];

  return (
    <section className="bg-card border border-border rounded-2xl p-4 md:p-5 space-y-4 shadow-raised" aria-label="Accounts" data-testid="fleet">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(([k, v, tone]) => (
          <div key={k} className="rounded-xl border border-border bg-background/40 px-4 py-3" data-testid="fleet-kpi">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Accounts</h2>
        <span className="text-[11px] text-muted-foreground">Failed counts the real thing; the kill switch and daily limits are there to keep it at zero.</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onAddManual}>Add account</Button>
          <Button size="sm" onClick={() => setCfg({})} data-testid="fleet-add"><Plus className="w-4 h-4 mr-1" />Add / Configure Account Profile</Button>
        </div>
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[1000px] text-sm" data-testid="fleet-table">
          <thead><tr className="text-xs text-muted-foreground text-left">
            {['Account ID', 'Firm & model', 'Platform', 'Group', 'Active script / profile', 'Balance & P&L', 'Status', ''].map((h) => <th key={h} className="font-normal px-2 py-2">{h}</th>)}
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={8} className="px-2 py-6 text-muted-foreground">No accounts yet. Add one with a profile, or by its login.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border" data-testid="fleet-row" data-account={r.account}>
                <td className="px-2 py-2.5">
                  <span className="font-mono text-xs block">{r.account}</span>
                  <span className="text-[11px] text-muted-foreground block truncate max-w-[220px]">{r.display_name ? `${r.display_name} · ` : ''}{r.login ? `${r.login} on ${r.where}` : r.where}{r.firm ? `, ${r.firm}` : ''}</span>
                </td>
                <td className="px-2 py-2.5">{r.firm && r.model ? `${r.firm} (${r.model})` : r.plan || r.firm || <span className="text-muted-foreground">–</span>}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">{platformOf(r.platform).title}</td>
                <td className="px-2 py-2.5">
                  <select value={groupsFor(r.platform).some((g) => g.name === r.group) ? groupsFor(r.platform).find((g) => g.name === r.group).id : ''} onChange={(e) => onGroup?.(r.id, e.target.value)}
                    aria-label={`Group for ${r.account}`} className="h-8 max-w-[150px] rounded-md border border-border bg-background px-1.5 text-sm" data-testid="fleet-group">
                    <option value="">No group</option>
                    {groupsFor(r.platform).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2.5" data-testid="account-script">{r.profile || <span className="text-muted-foreground">{r.group ? 'No script on this group yet' : 'No script: add it to a group'}</span>}</td>
                <td className="px-2 py-2.5 tabular-nums">{money(r.balance)} <span className={r.pnl >= 0 ? 'text-chart-2' : 'text-destructive'}>({signed(r.pnl)})</span></td>
                <td className="px-2 py-2.5"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PILL[status(r)] || PILL.active}`} data-testid="fleet-status">{LABEL[status(r)] || status(r).toUpperCase()}</span></td>
                <td className="px-2 py-2.5">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" title="Edit login and details" aria-label={`Edit ${r.account}`} onClick={() => onEditAccount?.(r.id)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" title="Edit config (profile)" onClick={() => setCfg({ account: r })} data-testid="fleet-edit"><Settings2 className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" title="Audit payout" onClick={() => post('/api/fleet/audit', { account_id: r.id }).then(setAudit).catch((e) => setAudit({ error: e.message }))} data-testid="fleet-audit"><ShieldCheck className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" title={r.paused ? 'Resume' : 'Pause'} onClick={() => post('/api/fleet/pause', { account_id: r.id, paused: !r.paused }).then(load)} data-testid="fleet-pause">{r.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ProfileConfigurator open={!!cfg} account={cfg?.account} accounts={rows} presets={data.presets} onClose={() => setCfg(null)} onDeployed={load} />
      <Dialog open={!!audit} onOpenChange={(v) => !v && setAudit(null)}>
        <DialogContent data-testid="audit-dialog">
          <DialogHeader>
            <DialogTitle>Payout audit{audit?.account ? `: ${audit.account}` : ''}</DialogTitle>
            <DialogDescription>{audit?.error || (audit?.ok ? `Ready: request ${money(audit.withdraw)} and keep ${money(audit.retain)} as the drawdown buffer.` : 'Not ready yet: every check below has to pass.')}</DialogDescription>
          </DialogHeader>
          {audit?.rules && (
            <div className="space-y-2">
              {audit.rules.map((x) => (
                <div key={x.rule} className="flex gap-2 text-sm">
                  {x.ok ? <CheckCircle2 className="w-4 h-4 text-chart-2 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
                  <span><b className="font-medium">{x.rule}</b>: {x.detail}</span>
                </div>
              ))}
              {audit.site && <p className="text-xs text-muted-foreground pt-1">Requests are made in the firm's dashboard: <a className="text-primary underline" href={audit.site} target="_blank" rel="noreferrer">{audit.site}</a></p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
