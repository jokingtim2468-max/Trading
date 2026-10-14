import { ComposedChart, Area, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, dateTick, dateTimeLabel, CHART_ANIM } from './ChartCard';
import { downsample } from '@/lib/backtest/metrics';
import { tradeSignals } from '@/lib/backtest/signals';

const MARKERS = [
  { type: 'BUY', shape: 'triangle', fill: 'hsl(var(--chart-2))' },
  { type: 'SELL', shape: 'triangle', fill: 'hsl(var(--destructive))' },
  { type: 'CLOSE', shape: 'diamond', fill: 'hsl(var(--chart-4))' },
  { type: 'TP', shape: 'star', fill: 'hsl(var(--chart-1))' },
  { type: 'SL', shape: 'cross', fill: 'hsl(var(--chart-5))' },
];

export default function PriceLiquidityChart({ price, trades }) {
  const data = downsample(price, 700);
  const maxVol = Math.max(...data.map((d) => d.volume));
  const signals = tradeSignals(trades);
  return (
    <ChartCard title="Price, signals & tick-volume liquidity" right="BUY green ▲ · SELL red ▲ · CLOSE yellow ◆ · TP blue ★ · SL orange ✕">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} {...axisProps} />
          <YAxis yAxisId="p" domain={['auto', 'auto']} width={60} {...axisProps} />
          <YAxis yAxisId="v" orientation="right" domain={[0, maxVol * 4]} hide />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={dateTimeLabel} />
          <Area {...CHART_ANIM} yAxisId="v" dataKey="volume" name="Tick volume" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.25} dot={false} />
          <Line {...CHART_ANIM} yAxisId="p" dataKey="close" name="Close" stroke="hsl(var(--foreground))" strokeWidth={1.2} dot={false} />
          {MARKERS.map((m) => (
            <Scatter {...CHART_ANIM}
              key={m.type} yAxisId="p" name={m.type} dataKey="close" shape={m.shape} fill={m.fill}
              data={signals.filter((s) => s.type === m.type).map((s) => ({ t: s.t, close: s.price }))}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}