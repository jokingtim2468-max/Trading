import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, History, ArrowLeftRight } from 'lucide-react';
import { MODELS } from '@/lib/models';
import useScriptTester from '@/hooks/useScriptTester';
import { DEFAULT_DATASET_IDS } from '@/lib/backtest/builtinData';
import TesterControls from '@/components/scripttester/TesterControls';
import ScriptCard from '@/components/scripttester/ScriptCard';
import ScriptResults from '@/components/scripttester/ScriptResults';
import ChartLoader from '@/components/quant/ChartLoader';

export default function StrategyTester() {
  const t = useScriptTester();
  const [chatId, setChatId] = useState('');
  const [datasetIds, setDatasetIds] = useState(DEFAULT_DATASET_IDS);
  useEffect(() => { if (!chatId && t.chats[0]) setChatId(t.chats[0].id); }, [t.chats]);
  const modelLabel = MODELS.find((m) => m.id === t.model)?.label;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center gap-1 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold ml-2">Strategy Tester</h1>
        <Link to="/strategy-converter" className="ml-auto flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-accent">
          <ArrowLeftRight className="w-4 h-4 text-primary" />Converter
        </Link>
        <Link to="/test-history" className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-accent">
          <History className="w-4 h-4 text-primary" />History
        </Link>
      </header>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
        {!t.ready ? <div className="flex justify-center py-16"><ChartLoader className="w-20 h-12" /></div> : (
          <div className="space-y-2">
            <TesterControls
              chats={t.chats} datasets={t.datasets} chatId={chatId} datasetIds={datasetIds}
              onChat={setChatId} onDatasets={setDatasetIds} onRun={() => t.run(chatId, datasetIds)} running={t.running}
            />
            <p className="text-xs text-muted-foreground px-1">
              Tests the newest script in the chat on the full history of the timeframe. Settings are built into the tester:
              $10,000 balance, the script's own inputs, 1% risk if it sets none. Script read by {modelLabel} (change it in Settings).
            </p>
          </div>
        )}
        {t.running && (
          <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
            <ChartLoader className="w-20 h-12" />{t.phase}
          </div>
        )}
        {t.error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{t.error}</div>}
        {t.results.map((r) => (
          <div key={r.ds.id} className="space-y-5">
            <h2 className="font-heading text-base font-semibold">{r.ds.symbol} {r.ds.timeframe}</h2>
            <ScriptCard result={r} />
            <ScriptResults result={r} />
          </div>
        ))}
      </div>
    </div>
  );
}