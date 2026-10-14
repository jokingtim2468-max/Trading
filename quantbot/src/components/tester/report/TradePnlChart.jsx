import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, CHART_ANIM } from './ChartCard';

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function TradePnlChart({ trades }) {
  const data = trades.map((t, k) => ({ n: k + 1, pnl: Number(t.pnl.toFixed(2)) }));
  return (
    <ChartCard title="P&L per trade">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data}>
          <XAxis dataKey="n" {...axisProps} />
          <YAxis width={70} tickFormatter={money} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(n) => `Trade #${n}`} formatter={(v) => [money(v), 'P&L']} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" ifOverflow="extendDomain" />
          <Bar {...CHART_ANIM} dataKey="pnl" maxBarSize={48}>
            {data.map((d) => <Cell key={d.n} fill={d.pnl >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}