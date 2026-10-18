import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { usd } from '@/lib/pnl';
import ChartLoader from '@/components/quant/ChartLoader';

const money = (v) => (v == null ? 'no limit' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const tone = (v) => (v > 0 ? 'text-chart-2' : v < 0 ? 'text-destructive' : '');
const STATUS = { active: 'bg-chart-2/15 text-chart-2', passed: 'bg-primary/15 text-primary', failed: 'bg-destructive/15 text-destructive' };

// Copy trading at a glance: every group and account with balance, today, total, room before the firm's limits,
// open trades and how its MT5 is connected (refreshed every 5 s)
export default function Overview() {
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => fetch('/api/terminal/overview').then((r) => r.json()).then((j) => setGroups(j.groups || [])).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const all = (groups || []).flatMap((g) => g.accounts);
  const sum = (k) => all.reduce((s, a) => s + (Number(a[k]) || 0), 0);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent" aria-label="Back"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Overview</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Every group and account, live</span>
        <span className="ml-auto flex gap-4 text-sm">
          <Link to="/accounts" className="text-primary hover:underline">Copy trading</Link>
          <Link to="/terminal" className="text-primary hover:underline">Terminal</Link>
        </span>
      </header>
      {!groups ? <div className="flex justify-center py-20">{err ? <p className="text-destructive">{err}</p> : <ChartLoader className="w-20 h-12" />}</div> : (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5" data-testid="overview">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[['Accounts', all.length], ['Active', all.filter((a) => a.status === 'active').length], ['Balance', money(sum('balance'))], ['Today', usd(sum('today')), sum('today')], ['Total P&L', usd(sum('total')), sum('total')]].map(([k, v, t]) => (
              <div key={k} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className={`text-lg font-semibold tabular-nums ${t != null ? tone(t) : ''}`}>{v}</div>
              </div>
            ))}
          </div>
          {!groups.length && <p className="text-sm text-muted-foreground">No accounts yet. Add them on the <Link to="/accounts" className="text-primary underline">Copy trading</Link> page.</p>}
          {groups.map((g) => (
            <div key={g.id || 'none'} className="rounded-xl border border-border bg-card overflow-x-auto" data-testid="overview-group">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                <span className="font-semibold">{g.name}</span>
                {!g.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">paused</span>}
                {g.protect && (g.protect.lock || g.protect.streak || g.protect.consistency) ? <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">protection on</span> : null}
                <span className="ml-auto text-xs text-muted-foreground">{g.accounts.length} account{g.accounts.length === 1 ? '' : 's'}</span>
              </div>
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[1.4fr_.7fr_1fr_.9fr_.9fr_1.3fr_.5fr_1fr] px-4 py-1.5 text-xs text-muted-foreground"><span>Account</span><span>Status</span><span>Balance</span><span>Today</span><span>Total</span><span>Room before limits</span><span>Open</span><span>MT5</span></div>
                {g.accounts.map((a) => (
                  <div key={a.id} className="grid grid-cols-[1.4fr_.7fr_1fr_.9fr_.9fr_1.3fr_.5fr_1fr] items-center px-4 py-2 border-t border-border text-sm tabular-nums" data-testid="overview-row">
                    <span className="truncate">{a.name}<span className="block text-xs text-muted-foreground">{[a.firm, a.platform].filter(Boolean).join(' · ')}</span></span>
                    <span><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[a.status] || 'bg-muted'}`} title={a.status_reason}>{a.status}</span></span>
                    <span>{money(a.balance)}</span>
                    <span className={tone(a.today)}>{usd(a.today)}</span>
                    <span className={tone(a.total)}>{usd(a.total)}{a.target ? <span className="block text-xs text-muted-foreground">target {money(a.target)}</span> : null}</span>
                    <span>{money(a.room)}{a.room != null && <span className="block text-xs text-muted-foreground">before its {a.rule}</span>}</span>
                    <span>{a.open}</span>
                    <span className={`text-xs ${a.mt5 === 'fast lane' ? 'text-chart-2' : 'text-muted-foreground'}`}>{a.mt5 || '–'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
