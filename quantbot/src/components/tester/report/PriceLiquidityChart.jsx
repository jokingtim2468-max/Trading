import { ComposedChart, Area, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, dateTick, dateTimeLabel, CHART_ANIM } from './ChartCard';
import { downsample } from '@/lib/backtest/metrics';
import { tradeSignals } from '@/lib/backtest/signals';

// Legend glyphs drawn like the chart's own markers
const GLYPH = { triangle: 'M6 1 L11 11 L1 11 Z', diamond: 'M6 0 L12 6 L6 12 L0 6 Z', star: 'M6 0 L7.6 4.3 L12 4.5 L8.5 7.3 L9.7 12 L6 9.3 L2.3 12 L3.5 7.3 L0 4.5 L4.4 4.3 Z', cross: 'M1 3 L3 1 L6 4 L9 1 L11 3 L8 6 L11 9 L9 11 L6 8 L3 11 L1 9 L4 6 Z' };
const Legend = () => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
    {MARKERS.map((m) => (
      <span key={m.type} className="flex items-center gap-1">
        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d={GLYPH[m.shape]} fill={m.fill} /></svg>{m.type}
      </span>
    ))}
  </div>
);

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
    <ChartCard title="Price, signals & tick-volume liquidity" right={<Legend />}>
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