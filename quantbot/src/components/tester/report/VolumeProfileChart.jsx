import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import ChartCard, { axisProps, tooltipStyle, CHART_ANIM } from './ChartCard';

const BINS = 30;

function profile(price) {
  const lo = Math.min(...price.map((b) => b.low)), hi = Math.max(...price.map((b) => b.high));
  const size = (hi - lo) / BINS || 1;
  const vol = new Array(BINS).fill(0);
  for (const b of price) {
    const a = Math.min(BINS - 1, Math.floor((b.low - lo) / size)), z = Math.min(BINS - 1, Math.floor((b.high - lo) / size));
    for (let k = a; k <= z; k++) vol[k] += b.volume / (z - a + 1);
  }
  const poc = vol.indexOf(Math.max(...vol));
  const total = vol.reduce((x, y) => x + y, 0);
  let inVa = vol[poc], down = poc, up = poc;
  while (inVa < total * 0.7 && (down > 0 || up < BINS - 1)) {
    const nextUp = up < BINS - 1 ? vol[up + 1] : -1, nextDown = down > 0 ? vol[down - 1] : -1;
    if (nextUp >= nextDown) inVa += vol[++up]; else inVa += vol[--down];
  }
  const mid = (k) => lo + size * (k + 0.5);
  const rows = vol.map((v, k) => ({ price: mid(k).toFixed(2), volume: Math.round(v), kind: k === poc ? 'poc' : k >= down && k <= up ? 'va' : 'out' })).reverse();
  return { rows, poc: mid(poc), vah: mid(up), val: mid(down) };
}

const FILL = { poc: 'hsl(var(--primary))', va: 'hsl(var(--chart-3))', out: 'hsl(var(--muted-foreground))' };

export default function VolumeProfileChart({ price }) {
  const p = profile(price);
  return (
    <ChartCard title="Volume profile" right={`POC ${p.poc.toFixed(2)} · VAH ${p.vah.toFixed(2)} · VAL ${p.val.toFixed(2)}`}>
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={p.rows} layout="vertical" margin={{ left: 10 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="price" width={70} interval={2} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v.toLocaleString(), 'Tick volume']} />
          <Bar {...CHART_ANIM} dataKey="volume" radius={[0, 3, 3, 0]}>
            {p.rows.map((r, k) => <Cell key={k} fill={FILL[r.kind]} fillOpacity={r.kind === 'out' ? 0.35 : 0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}