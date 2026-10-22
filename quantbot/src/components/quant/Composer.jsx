import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocalModels } from '@/lib/models';
import { COMMANDS } from '@/lib/chatCommands';

const STYLES = ['Concise', 'Code only'];
const triggerCls = 'h-8 w-auto gap-2 border-border bg-transparent text-xs text-muted-foreground';

export default function Composer({ onSend, disabled, style, onStyleChange, model, onModelChange }) {
  const models = useLocalModels();
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  // Typing "/" lists QuantBot's own commands (they run in the app, not the model)
  const typed = /^\/[a-z]*$/i.test(text) ? text.slice(1).toLowerCase() : null;
  const matches = typed == null ? [] : COMMANDS.filter((c) => c.name.startsWith(typed));
  const choose = (c) => { setText(`/${c.name}${c.args ? ' ' : ''}`); setPick(0); };

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="px-4 md:px-6 pb-5">
      <div className="max-w-3xl mx-auto relative bg-card border border-border rounded-2xl shadow-float focus-within:border-muted-foreground/40 transition-colors">
        {matches.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-popover shadow-float p-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 calm:animate-none" data-testid="command-list">
            <div className="px-2 pb-1 text-[11px] text-muted-foreground">QuantBot commands: run here, not sent to the model</div>
            {matches.map((c, k) => (
              <button key={c.name} type="button" onMouseDown={(e) => { e.preventDefault(); choose(c); }}
                className={`w-full flex items-baseline gap-3 px-2 py-1.5 rounded-lg text-left text-sm ${k === pick ? 'bg-accent' : 'hover:bg-accent'}`}>
                <span className="font-mono text-primary">/{c.name}</span>
                {c.args && <span className="font-mono text-xs text-muted-foreground">{c.args}</span>}
                <span className="ml-auto text-xs text-muted-foreground text-right">{c.about}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick((k) => (k + 1) % matches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setPick((k) => (k - 1 + matches.length) % matches.length); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && matches[pick] && `/${matches[pick].name}` !== text.trim())) { e.preventDefault(); choose(matches[Math.min(pick, matches.length - 1)]); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder="Reply to QuantBot...  (/ for commands)"
          rows={2}
          className="w-full resize-none bg-transparent px-4 pt-4 text-[15px] outline-none placeholder:text-muted-foreground max-h-60"
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-2">
            <Select value={style} onValueChange={onStyleChange}>
              <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={models.some((m) => m.id === model) ? model : models[0]?.id} onValueChange={onModelChange}>
              <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}