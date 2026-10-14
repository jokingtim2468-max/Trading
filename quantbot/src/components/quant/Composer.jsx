import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODELS } from '@/lib/models';

const STYLES = ['Concise', 'Code only'];
const triggerCls = 'h-8 w-auto gap-2 border-border bg-transparent text-xs text-muted-foreground';

export default function Composer({ onSend, disabled, style, onStyleChange, model, onModelChange }) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="px-4 md:px-6 pb-5">
      <div className="max-w-3xl mx-auto bg-card border border-border rounded-2xl shadow-lg shadow-black/30 focus-within:border-muted-foreground/40 transition-colors">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Reply to QuantBot..."
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
            <Select value={model} onValueChange={onModelChange}>
              <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
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