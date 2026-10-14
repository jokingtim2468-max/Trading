export default function ChartCard({ title, right, children }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {right && <div className="text-xs text-muted-foreground">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export const axisProps = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false, axisLine: false };
export const tooltipStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };
export const dateTick = (t) => new Date(t).toISOString().slice(5, 10);
export const dateTimeLabel = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');