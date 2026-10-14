import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const STATUS = {
  pass: { icon: CheckCircle2, cls: 'text-green-500', label: 'Pass' },
  fail: { icon: XCircle, cls: 'text-destructive', label: 'Fail' },
  warn: { icon: AlertTriangle, cls: 'text-yellow-500', label: 'Check' },
};

export default function RuleResults({ summary, results }) {
  const passed = results.filter((r) => r.status === 'pass').length;
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold">Rule test</h3>
        <span className="text-sm text-muted-foreground">{passed} / {results.length} passed</span>
      </div>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      <ul className="space-y-2">
        {results.map((r, i) => {
          const s = STATUS[r.status] || STATUS.warn;
          return (
            <li key={i} className="flex gap-3 rounded-lg border border-border p-3">
              <s.icon className={`w-5 h-5 shrink-0 mt-0.5 ${s.cls}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.rule} <span className={`text-xs ml-1 ${s.cls}`}>{s.label}</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}