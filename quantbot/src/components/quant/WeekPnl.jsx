import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const money = (v) => (v == null ? 'n/a' : `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

// This week's P&L across every running account — what a copy trader checks first when they open the app.
export default function WeekPnl() {
  const [k, setK] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch('/api/fleet').then((r) => r.json()).then((d) => setK(d.kpis || null)).catch(() => setErr(true));
  }, []);

  const none = k && k.active === 0 && k.passed === 0 && k.failed === 0;
  return (
    <section aria-label="This week" className="rounded-xl border border-border bg-card shadow-raised p-4 flex flex-col" data-testid="home-week-pnl">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">This week</h2>
        {k && <span className="text-xs text-muted-foreground">{k.active} account{k.active === 1 ? '' : 's'} running</span>}
      </div>
      {err || none ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground flex-1">
            {err ? 'Could not reach the fleet.' : 'No accounts running yet. Add one and give it a script to start copying trades.'}
          </p>
          <Link to="/accounts" className="mt-3 text-sm text-primary hover:underline self-start">Open Accounts</Link>
        </>
      ) : !k ? (
        <div className="mt-2 text-sm text-muted-foreground flex-1">Loading…</div>
      ) : (
        <>
          <div className={`mt-2 font-heading text-3xl tabular-nums ${k.week >= 0 ? 'text-chart-2' : 'text-destructive'}`} data-testid="week-net">{money(k.week)}</div>
          <div className="text-xs text-muted-foreground">
            {k.week_trades || 0} trade{k.week_trades === 1 ? '' : 's'} closed this week{k.week_trades ? `, ${Math.round((k.week_wins / k.week_trades) * 100)}% winners` : ''}
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Today <b className={`tabular-nums ${k.today >= 0 ? 'text-chart-2' : 'text-destructive'}`}>{money(k.today)}</b></span>
            <span className="text-muted-foreground">All-time <b className={`tabular-nums ${k.net >= 0 ? 'text-chart-2' : 'text-destructive'}`}>{money(k.net)}</b></span>
          </div>
          <Link to="/accounts" className="mt-auto pt-3 text-sm text-primary hover:underline self-start">Open the fleet</Link>
        </>
      )}
    </section>
  );
}
