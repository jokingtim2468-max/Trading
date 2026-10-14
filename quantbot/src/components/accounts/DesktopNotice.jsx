import { Monitor, Zap } from 'lucide-react';

export default function DesktopNotice({ available }) {
  if (available) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-primary" />Copying runs on this PC while QuantBot is open. Passwords are encrypted and never leave this PC.
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm flex gap-3">
      <Monitor className="w-4 h-4 text-primary shrink-0 mt-0.5" />
      <p>The copy-trading engine (MT5 / Tradovate logins) isn't part of this app yet. You can add accounts and arrange copy groups here; passwords and live copying will switch on once the engine is added.</p>
    </div>
  );
}