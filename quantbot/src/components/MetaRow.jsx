// Facts about a run, test or file as label / value pairs, so each reads on its own instead of a dot-joined string.
// items: [label, value] pairs; a pair with no value is skipped.
export default function MetaRow({ items, className = '' }) {
  return (
    <dl className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs ${className}`}>
      {items.filter(([, v]) => v != null && v !== '').map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5 min-w-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd data-meta={label} className="text-foreground/90 font-medium tabular-nums truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
