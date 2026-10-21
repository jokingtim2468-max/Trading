import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toCsv, downloadText } from '@/lib/copy';

// Filters over the activity log; each event kind belongs to one
export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'trades', label: 'Trades', test: (e) => ['open', 'close', 'move'].includes(e.kind) },
  { id: 'signals', label: 'Signals', test: (e) => e.kind === 'signal' },
  { id: 'problems', label: 'Skips & warnings', test: (e) => e.level !== 'info' || ['skip', 'limit', 'ignore', 'block'].includes(e.kind) },
  { id: 'blocks', label: 'News & hours', test: (e) => e.kind === 'block' },
  { id: 'progress', label: 'Pass / fail', test: (e) => ['status', 'floor'].includes(e.kind) },
  { id: 'orders', label: 'Orders', test: (e) => e.kind === 'order' },
  { id: 'payouts', label: 'Payouts', test: (e) => e.kind === 'payout' },
  { id: 'setup', label: 'Setup', test: (e) => e.kind === 'setup' },
];
const KIND = {
  signal: 'text-primary border-primary/40', open: 'text-emerald-400 border-emerald-500/40', close: 'text-foreground border-border',
  move: 'text-chart-4 border-chart-4/40', skip: 'text-chart-4 border-chart-4/40', limit: 'text-chart-4 border-chart-4/40',
  ignore: 'text-muted-foreground border-border', rank: 'text-violet-300 border-violet-400/40', status: 'text-foreground border-foreground/40',
  floor: 'text-muted-foreground border-border', order: 'text-sky-300 border-sky-400/40', setup: 'text-muted-foreground border-border',
  block: 'text-chart-4 border-chart-4/40', payout: 'text-emerald-400 border-emerald-500/40',
};
const LEVEL = { warn: 'text-chart-4', error: 'text-red-400' };
const time = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour12: false })}`; };

// Everything copy trading did, newest first: signals, sizing, skips, fills, stop moves, closes, pass / fail, orders
export default function ActivityLog({ events, accounts, groups, scripts, scope }) {
  const [filter, setFilter] = useState('all');
  const [account, setAccount] = useState('all');
  const [script, setScript] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const name = (list, id, f = (x) => x.name) => { const x = list.find((y) => y.id === id); return x ? f(x) : ''; };
  const accName = (id) => name(accounts, id, (a) => a.display_name || a.label);

  const inScope = useMemo(() => events.filter((e) => !scope || e.group_id === scope || (!e.group_id && (e.kind === 'signal' ? (e.data?.groups || []).includes(scope) : false))), [events, scope]);
  const shown = useMemo(() => {
    const test = ACTIVITY_FILTERS.find((f) => f.id === filter).test;
    const needle = q.trim().toLowerCase();
    return inScope.filter((e) => test(e) && (account === 'all' || e.account_id === account) && (script === 'all' || e.script_id === script)
      && (!needle || e.message.toLowerCase().includes(needle)));
  }, [inScope, filter, account, script, q]);

  const exportCsv = () => downloadText(`quantbot-copy-activity-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([...shown].reverse(), [
    ['time', (e) => e.created_date], ['kind', (e) => e.kind], ['level', (e) => e.level], ['account', (e) => accName(e.account_id)],
    ['group', (e) => name(groups, e.group_id)], ['script', (e) => name(scripts, e.script_id)], ['message', (e) => e.message],
    ['data', (e) => (e.data ? JSON.stringify(e.data) : '')],
  ]));

  return (
    <div className="space-y-3" data-testid="activity-log">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Activity filter">
        {ACTIVITY_FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded-lg text-xs border ${filter === f.id ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'}`}>
            {f.label} <span className="opacity-70">{inScope.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the log" aria-label="Search the log" className="h-8 pl-8 text-xs" />
        </div>
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Account"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All accounts</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.display_name || a.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={script} onValueChange={setScript}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Script"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All scripts</SelectItem>{scripts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8" onClick={exportCsv} disabled={!shown.length}><Download className="w-3.5 h-3.5 mr-1" />Export CSV</Button>
      </div>
      {!shown.length ? <p className="text-sm text-muted-foreground py-4">{events.length ? 'Nothing matches these filters.' : 'Nothing yet. Every signal, trade, skip and pass / fail shows up here as it happens.'}</p> : (
        <ol className="max-h-[520px] overflow-y-auto rounded-xl border border-border/70 divide-y divide-border/50 text-xs">
          {shown.slice(0, 500).map((e) => (
            <li key={e.id} data-event={e.kind}>
              <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-accent/50">
                <span className="tabular-nums text-muted-foreground shrink-0 w-28 whitespace-nowrap">{time(e.created_date)}</span>
                <span className={`shrink-0 w-14 text-center rounded-full border px-1.5 text-[10px] uppercase tracking-wide ${KIND[e.kind] || ''}`}>{e.kind}</span>
                <span className={`flex-1 min-w-0 ${open === e.id ? 'whitespace-normal' : 'truncate'} ${LEVEL[e.level] || ''}`} title={e.message}>{e.message}</span>
              </button>
              {open === e.id && (
                <pre className="mx-3 mb-2 p-2 rounded-lg bg-background border border-border text-[11px] overflow-x-auto">{JSON.stringify({
                  account: accName(e.account_id) || undefined, group: name(groups, e.group_id) || undefined, script: name(scripts, e.script_id) || undefined, ...e.data,
                }, null, 2)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
      {shown.length > 500 && <p className="text-[11px] text-muted-foreground">Showing the newest 500 of {shown.length}. Export CSV has them all.</p>}
    </div>
  );
}
