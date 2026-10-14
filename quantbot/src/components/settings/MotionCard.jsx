import { useState } from 'react';
import { getMotion, setMotion } from '@/lib/motionPref';

const OPTIONS = [
  { value: 'full', title: 'Full animations', text: 'Windows and pop-ups grow from where you click, numbers count up and charts draw in.' },
  { value: 'reduced', title: 'Reduced', text: 'Everything appears straight away. For anyone who gets motion sickness.' },
];

// QuantBot's own motion setting, separate from Windows' "Animation effects"
export default function MotionCard() {
  const [value, setValue] = useState(getMotion);
  const pick = (v) => { setValue(v); setMotion(v); };
  return (
    <div role="radiogroup" aria-label="Motion" className="grid sm:grid-cols-2 gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value} onClick={() => pick(o.value)}
          className={`text-left rounded-xl border p-4 transition-colors ${value === o.value ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent'}`}
        >
          <div className="text-sm font-medium">{o.title}</div>
          <div className="text-xs text-muted-foreground mt-1">{o.text}</div>
        </button>
      ))}
    </div>
  );
}
