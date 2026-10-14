import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import ChartCard, { axisProps, tooltipStyle } from './ChartCard';

export default function TradePnlChart({ trades }) {
  const data = trades.map((t, k) => ({ n: k + 1, pnl: Number(t.pnl.toFixed(2)) }));
  return (
    <ChartCard title="P&L per trade">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data}>
          <XAxis dataKey="n" {...axisProps} />
          <YAxis width={60} tickFormatter={(v) => `$${v}`} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(n) => `Trade #${n}`} formatter={(v) => [`$${v}`, 'P&L']} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Bar dataKey="pnl">
            {data.map((d) => <Cell key={d.n} fill={d.pnl >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}