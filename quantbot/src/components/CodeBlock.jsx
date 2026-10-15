import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

export const COLLAPSE_LINES = 25;

// A code block that shows its first 25 lines and a button for the rest (long EAs stay readable in the chat)
export default function CodeBlock({ code, language, actions = null, className = '' }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = String(code).replace(/\n$/, '').split('\n');
  const long = lines.length > COLLAPSE_LINES;
  const shown = long && !open ? lines.slice(0, COLLAPSE_LINES).join('\n') : lines.join('\n');

  const copy = async () => {
    await navigator.clipboard.writeText(String(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`not-prose my-4 rounded-lg border border-border bg-sidebar overflow-hidden font-body ${className}`} data-code-block>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/70 text-xs text-muted-foreground">
        <span>{language || 'code'}{long ? `, ${lines.length} lines` : ''}</span>
        <div className="flex items-center gap-1">
          {actions}
          <button type="button" onClick={copy} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="relative">
        <pre className="code-inner p-4 m-0 text-[13px] leading-6 font-mono overflow-x-auto whitespace-pre bg-transparent border-0 rounded-none"><code>{shown}</code></pre>
        {long && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-sidebar to-transparent" />}
      </div>
      {long && (
        <button
          type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="w-full flex items-center justify-center gap-1.5 border-t border-border/70 py-2 text-xs font-medium text-primary hover:bg-accent"
        >
          {open ? <><ChevronUp className="w-3.5 h-3.5" />Collapse</> : <><ChevronDown className="w-3.5 h-3.5" />Show all {lines.length} lines</>}
        </button>
      )}
    </div>
  );
}

// react-markdown's <pre>: the code element inside carries the text and its language class
export function MarkdownPre({ children }) {
  const child = Array.isArray(children) ? children[0] : children;
  const cls = child?.props?.className || '';
  const text = child?.props?.children;
  return <CodeBlock code={Array.isArray(text) ? text.join('') : String(text ?? '')} language={cls.replace(/^language-/, '')} />;
}
