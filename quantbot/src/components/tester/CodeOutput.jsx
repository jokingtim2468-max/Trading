import { Download } from 'lucide-react';
import CodeBlock from '@/components/CodeBlock';

export default function CodeOutput({ code, target }) {
  const ext = target === 'MT5' ? 'mq5' : 'pine';
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `strategy.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <CodeBlock
      code={code} language={target === 'MT5' ? 'MQL5 Expert Advisor' : 'Pine Script v5'} className="my-0 bg-card"
      actions={(
        <button type="button" onClick={download} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground">
          <Download className="w-3.5 h-3.5" />.{ext}
        </button>
      )}
    />
  );
}
