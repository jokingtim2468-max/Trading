import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { axisProps, tooltipStyle, dateTick, dateTimeLabel, CHART_ANIM } from '@/components/tester/report/ChartCard';
import { evaluate, money, signedMoney, toCsv, downloadText } from '@/lib/copy';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const pf = (v) => (v === Infinity ? '∞' : v.toFixed(2));
const hold = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const tone = (v) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : '');

function Tile({ label, value, className = '', hint }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums truncate ${className}`}>{value}</p>
    </div>
  );
}

function Table({ title, rows }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{title}</p>
      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted-foreground text-[11px]">
            <tr className="text-right">
              <th className="text-left font-normal px-3 py-1.5">Name</th><th className="font-normal px-2">Trades</th><th className="font-normal px-2">Win %</th>
              <th className="font-normal px-2">Net</th><th className="font-normal px-2">Avg win</th><th className="font-normal px-2">Avg loss</th>
              <th className="font-normal px-2">PF</th><th className="font-normal px-2">Per trade</th><th className="font-normal px-2">Max DD</th><th className="font-normal px-3">XP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, sub, e }) => (
              <tr key={name} className="border-t border-border/50 text-right" data-eval-row={name}>
                <td className="text-left px-3 py-1.5"><span className="font-medium">{name}</span>{sub && <span className="text-muted-foreground"> {sub}</span>}</td>
                <td className="px-2">{e.trades}{e.open ? <span className="text-muted-foreground"> +{e.open}</span> : ''}</td>
                <td className="px-2">{e.trades ? pct(e.winRate) : '-'}</td>
                <td className={`px-2 ${tone(e.net)}`}>{signedMoney(e.net)}</td>
                <td className="px-2 text-emerald-400">{e.wins ? money(e.avgWin) : '-'}</td>
                <td className="px-2 text-red-400">{e.losses ? money(e.avgLoss) : '-'}</td>
                <td className="px-2">{e.trades ? pf(e.profitFactor) : '-'}</td>
                <td className={`px-2 ${tone(e.expectancy)}`}>{e.trades ? signedMoney(e.expectancy) : '-'}</td>
                <td className="px-2 text-red-400">{e.maxDrawdown ? money(-e.maxDrawdown) : '-'}</td>
                <td className="px-3">{e.xp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// How the copied trades did: overall numbers, the equity curve, and the same numbers per script, account, exit and side
export default function Evaluate({ trades, accounts, groups, scripts, scope }) {
  const mine = useMemo(() => trades.filter((t) => !scope || t.group_id === scope), [trades, scope]);
  const all = useMemo(() => evaluate(mine), [mine]);
  const by = (key, list, label) => list.map((x) => ({ name: label(x), sub: x.sub, e: evaluate(mine.filter((t) => t[key] === x.id)) })).filter((r) => r.e.trades || r.e.open);
  const accName = (a) => a.display_name || a.label;
  const curve = useMemo(() => {
    let eq = 0;
    return mine.filter((t) => t.status === 'closed').sort((a, b) => String(a.closed_at).localeCompare(String(b.closed_at)))
      .map((t) => { eq += t.pnl; return { t: Date.parse(t.closed_at), equity: Math.round(eq * 100) / 100 }; });
  }, [mine]);
  const reasons = Object.keys(all.reasons).map((r) => ({ name: r, e: evaluate(mine.filter((t) => t.status === 'closed' && (t.reason || 'signal') === r)) }));
  const sides = ['long', 'short'].map((s) => ({ name: s === 'long' ? 'Longs' : 'Shorts', e: evaluate(mine.filter((t) => t.side === s)) })).filter((r) => r.e.trades);

  const exportTrades = () => {
    const nm = (list, id) => list.find((x) => x.id === id);
    downloadText(`quantbot-copy-trades-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([...mine].sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at))), [
      ['opened_at', (t) => t.opened_at], ['closed_at', (t) => t.closed_at], ['account', (t) => { const a = nm(accounts, t.account_id); return a ? accName(a) : ''; }],
      ['account_name', (t) => nm(accounts, t.account_id)?.label], ['login', (t) => nm(accounts, t.account_id)?.login], ['group', (t) => nm(groups, t.group_id)?.name],
      ['script', (t) => nm(scripts, t.script_id)?.name], ['trade_id', (t) => t.trade_id], ['symbol', (t) => t.symbol], ['side', (t) => t.side], ['qty', (t) => t.qty],
      ['entry', (t) => t.entry], ['sl', (t) => t.sl], ['tp', (t) => t.tp], ['exit', (t) => t.exit],
      ['points', (t) => (t.exit != null ? Math.round((t.exit - t.entry) * (t.side === 'long' ? 1 : -1) * 100) / 100 : '')], ['point_value', (t) => t.point_value],
      ['pnl', (t) => t.pnl], ['xp', (t) => t.xp], ['reason', (t) => t.reason], ['status', (t) => t.status], ['order', (t) => t.forwarded],
    ]));
  };

  if (!mine.length) return <p className="text-sm text-muted-foreground py-4" data-testid="evaluate">No copied trades yet. Once a script&apos;s alerts come in, its results per script, account and exit show here.</p>;
  return (
    <div className="space-y-4" data-testid="evaluate">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1">{all.trades} closed trade{all.trades === 1 ? '' : 's'}{all.open ? `, ${all.open} open` : ''}; amounts are summed across accounts.</p>
        <Button size="sm" variant="outline" className="h-8" onClick={exportTrades}><Download className="w-3.5 h-3.5 mr-1" />Export trades CSV</Button>
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Tile label="Net P&L" value={signedMoney(all.net)} className={tone(all.net)} />
        <Tile label="Win rate" value={all.trades ? pct(all.winRate) : '-'} hint={`${all.wins} wins, ${all.losses} losses`} />
        <Tile label="Profit factor" value={all.trades ? pf(all.profitFactor) : '-'} hint="Gross profit / gross loss" />
        <Tile label="Per trade" value={signedMoney(all.expectancy)} className={tone(all.expectancy)} hint="Average P&L per closed trade" />
        <Tile label="Avg win / loss" value={`${money(all.avgWin)} / ${money(-all.avgLoss)}`} />
        <Tile label="Max drawdown" value={money(-all.maxDrawdown)} className={all.maxDrawdown ? 'text-red-400' : ''} hint="Biggest drop from a high, trade by trade" />
        <Tile label="Best / worst" value={`${signedMoney(all.best)} / ${signedMoney(all.worst)}`} />
        <Tile label="Avg hold" value={hold(all.avgHoldMin)} />
      </div>
      {curve.length > 1 && (
        <div className="rounded-xl border border-border/70 p-3">
          <p className="text-xs font-medium mb-1">Equity (closed trades, all accounts)</p>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={curve}>
              <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} {...axisProps} />
              <YAxis tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`} width={70} {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={dateTimeLabel} formatter={(v) => [signedMoney(v), 'Equity']} />
              <Area {...CHART_ANIM} dataKey="equity" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <Table title="By script" rows={by('script_id', scripts, (s) => s.name)} />
      <Table title="By account" rows={by('account_id', accounts.map((a) => ({ ...a, sub: `${a.label} · ${a.status || 'active'}` })), accName)} />
      {!scope && <Table title="By group" rows={by('group_id', groups, (g) => g.name)} />}
      <Table title="By exit" rows={reasons} />
      <Table title="Longs vs shorts" rows={sides} />
    </div>
  );
}
