import { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CodeOutput({ code, target }) {
  const [copied, setCopied] = useState(false);
  const ext = target === 'MT5' ? 'mq5' : 'pine';

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `strategy.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-sm font-medium">{target === 'MT5' ? 'MQL5 Expert Advisor' : 'Pine Script v5'}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy} className="h-8 bg-transparent">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}Copy
          </Button>
          <Button variant="outline" size="sm" onClick={download} className="h-8 bg-transparent">
            <Download className="w-3.5 h-3.5" />.{ext}
          </Button>
        </div>
      </div>
      <pre className="p-4 text-xs font-mono overflow-auto max-h-[520px] whitespace-pre">{code}</pre>
    </div>
  );
}