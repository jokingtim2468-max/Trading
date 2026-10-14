import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SavedFixPrompt({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-sm font-medium">Fix prompt generated for this version</span>
        <Button variant="outline" size="sm" onClick={copy} className="h-8 bg-transparent">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}Copy
        </Button>
      </div>
      <pre className="p-4 text-xs font-mono whitespace-pre-wrap max-h-[480px] overflow-auto">{text || 'No fix prompt saved.'}</pre>
    </div>
  );
}