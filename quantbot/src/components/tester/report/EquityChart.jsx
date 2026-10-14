import { AreaChart, Area, Line, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, dateTick, dateTimeLabel, CHART_ANIM } from './ChartCard';

export default function EquityChart({ equity, balance }) {
  let peak = balance;
  const data = equity.map((p) => {
    peak = Math.max(peak, p.equity);
    return { ...p, dd: -((peak - p.equity) / peak) * 100 };
  });
  const money = (v) => `$${Math.round(v).toLocaleString()}`;
  return (
    <ChartCard title="Equity & balance" right="Drawdown shown below">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} {...axisProps} />
          <YAxis domain={['auto', 'auto']} tickFormatter={money} width={70} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={dateTimeLabel} formatter={(v, n) => [money(v), n]} />
          <Area {...CHART_ANIM} dataKey="equity" name="Equity" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} dot={false} />
          <Line {...CHART_ANIM} dataKey="balance" name="Balance" stroke="hsl(var(--chart-4))" strokeWidth={1} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={data}>
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} width={70} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={dateTimeLabel} formatter={(v) => [`${v.toFixed(2)}%`, 'Drawdown']} />
          <Area {...CHART_ANIM} dataKey="dd" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}