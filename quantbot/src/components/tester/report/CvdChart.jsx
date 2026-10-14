import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, dateTick, dateTimeLabel, CHART_ANIM } from './ChartCard';
import { downsample } from '@/lib/backtest/metrics';

// Cumulative volume delta proxy: tick volume signed by candle direction
export default function CvdChart({ price }) {
  let cvd = 0;
  const data = downsample(price.map((b) => {
    cvd += b.close >= b.open ? b.volume : -b.volume;
    return { t: b.t, cvd };
  }), 700);
  return (
    <ChartCard title="Cumulative volume delta (proxy)" right="Rising = buyers absorbing liquidity">
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data}>
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} {...axisProps} />
          <YAxis width={60} tickFormatter={(v) => `${Math.round(v / 1000)}k`} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={dateTimeLabel} formatter={(v) => [Math.round(v).toLocaleString(), 'CVD']} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Area {...CHART_ANIM} dataKey="cvd" stroke="hsl(var(--chart-5))" fill="hsl(var(--chart-5))" fillOpacity={0.2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}