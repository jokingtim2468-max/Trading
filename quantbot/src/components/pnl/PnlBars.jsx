import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import ChartCard, { axisProps, tooltipStyle } from '@/components/tester/report/ChartCard';
import { shortLabel } from '@/lib/pnl';

export default function PnlBars({ rows, view }) {
  let cum = 0;
  const data = [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, c]) => {
    cum += c.pnl;
    return { label: shortLabel(view, key), pnl: Number(c.pnl.toFixed(2)), cum: Number(cum.toFixed(2)) };
  });
  if (!data.length) return null;
  return (
    <ChartCard title={`P&L per ${view}`} right="Line: running total">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data}>
          <XAxis dataKey="label" {...axisProps} />
          <YAxis width={60} tickFormatter={(v) => `$${v}`} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`$${v}`, n]} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Bar dataKey="pnl" name="P&L">
            {data.map((d, k) => <Cell key={k} fill={d.pnl >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} />)}
          </Bar>
          <Line dataKey="cum" name="Running total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}