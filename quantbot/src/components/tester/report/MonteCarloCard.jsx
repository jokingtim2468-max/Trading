import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import ChartCard, { axisProps, tooltipStyle } from './ChartCard';
import MonteCarloStats from './MonteCarloStats';

const money = (v) => `$${Math.round(v).toLocaleString()}`;

export default function MonteCarloCard({ mc, balance }) {
  if (!mc) {
    return <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">Monte Carlo needs at least 5 trades in the test window.</div>;
  }
  const data = [{ trade: 0, band: [balance, balance], p50: balance }, ...mc.bands.map((b) => ({ trade: b.trade, band: [b.p5, b.p95], p50: b.p50 }))];
  return (
    <ChartCard title={`Monte Carlo robustness (${mc.iterations.toLocaleString()} resampled runs)`} right="5th to 95th percentile equity">
      <MonteCarloStats mc={mc} />
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="trade" type="number" domain={[0, 'dataMax']} {...axisProps} />
          <YAxis domain={['auto', 'auto']} tickFormatter={money} width={70} {...axisProps} />
          <Tooltip
            contentStyle={tooltipStyle} labelFormatter={(v) => `After ${v} trades`}
            formatter={(v, n) => [Array.isArray(v) ? `${money(v[0])} to ${money(v[1])}` : money(v), n]}
          />
          <ReferenceLine y={balance} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
          <Area dataKey="band" name="5th-95th pct" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.18} />
          <Line dataKey="p50" name="Median" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-2">
        Trades are resampled with replacement. Score weights: 40% profitable runs, 20% worst-5% outcome, 25% 95th percentile drawdown, 15% sample size ({mc.trades} trades).
      </p>
    </ChartCard>
  );
}