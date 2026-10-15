import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// A read-only address with a Copy button
export default function CopyField({ label, value, placeholder }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code aria-label={label} className="flex-1 min-w-0 truncate text-xs font-mono bg-background border border-border rounded-lg px-3 py-2">
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </code>
        <button type="button" onClick={copy} disabled={!value} aria-label={`Copy ${label}`}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
