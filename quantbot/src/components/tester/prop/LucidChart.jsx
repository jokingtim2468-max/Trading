import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, CHART_ANIM } from '../report/ChartCard';

const money = (v) => `$${Math.round(v).toLocaleString()}`;

export default function LucidChart({ sim }) {
  const evalPts = sim.eval.curve.map((p, k) => ({ n: k + 1, balance: p.balance, floor: p.floor }));
  const fundPts = (sim.funded?.curve || []).map((p, k) => ({ n: evalPts.length + k + 1, balance: p.balance, floor: p.floor }));
  const data = [...evalPts, ...fundPts];
  if (!data.length) return null;
  return (
    <ChartCard title="Account balance vs max loss limit" right="By trading day">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="n" {...axisProps} />
          <YAxis domain={['auto', 'auto']} tickFormatter={money} width={70} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Day ${v}`} formatter={(v, n) => [money(v), n]} />
          {fundPts.length > 0 && (
            <ReferenceLine x={fundPts[0].n} stroke="hsl(var(--chart-2))" strokeDasharray="4 4" label={{ value: 'Funded', fill: 'hsl(var(--chart-2))', fontSize: 11, position: 'insideTopLeft' }} />
          )}
          <Line {...CHART_ANIM} dataKey="balance" name="Balance" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line {...CHART_ANIM} dataKey="floor" name="Max loss limit" stroke="hsl(var(--destructive))" strokeDasharray="4 4" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}