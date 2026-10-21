import { useEffect, useState } from 'react';
import { MODELS } from '@/lib/models';
import useScriptTester from '@/hooks/useScriptTester';
import { daysAgo, today, firstDate } from '@/lib/backtest/data';
import TesterControls from '@/components/scripttester/TesterControls';
import AccountPicker from '@/components/scripttester/AccountPicker';
import { presetOf } from '@/lib/backtest/propRules';
import ScriptCard from '@/components/scripttester/ScriptCard';
import ScriptResults from '@/components/scripttester/ScriptResults';
import ChartLoader from '@/components/quant/ChartLoader';
import Leaderboard from '@/components/tester/report/Leaderboard';

// The Strategy Lab's Test tab: the newest script in a chat, backtested on the chosen markets and dates
export function TesterPanel() {
  const t = useScriptTester();
  const [chatId, setChatId] = useState('');
  const [datasetIds, setDatasetIds] = useState(['market-XAUUSD', 'market-US100', 'market-NQ']);
  const [range, setRange] = useState({ tf: 'M15', from: daysAgo(365), to: today() });
  // The account the test runs on: $10K by default, optionally a prop firm's rules
  const [account, setAccount] = useState({ size: 10000, firm: null, model: null });
  const [presets, setPresets] = useState(null);
  useEffect(() => { fetch('/api/presets').then((r) => r.json()).then(setPresets).catch(() => setPresets({ sizes: [10000], presets: [] })); }, []);
  const preset = account.firm && account.firm !== 'all' && account.model ? presetOf(presets, account.firm, account.model, account.size) : null;
  useEffect(() => { if (!chatId && t.chats[0]) setChatId(t.chats[0].id); }, [t.chats]);
  // Dates can go back to the latest start among the picked built-in markets
  const picked = t.datasets.filter((d) => d.market && datasetIds.includes(d.id));
  const min = picked.map((d) => firstDate(d, range.tf)).sort().at(-1);
  const modelLabel = MODELS.find((m) => m.id === t.model)?.label;

  return (
    <>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
        <h2 className="font-heading text-lg font-semibold">Strategy Tester</h2>
        {!t.ready ? <div className="flex justify-center py-16"><ChartLoader className="w-20 h-12" /></div> : (
          <div className="space-y-2">
            <TesterControls
              chats={t.chats} datasets={t.datasets} chatId={chatId} datasetIds={datasetIds}
              onChat={setChatId} onDatasets={setDatasetIds} running={t.running}
              range={range} rangeLimits={{ min, max: today() }} onRange={(p) => setRange((r) => ({ ...r, ...p }))}
              onRun={() => t.run(chatId, datasetIds, range, { size: account.size, preset, all: account.firm === 'all' ? presets.presets : null })} onStop={t.stop}
            />
            {presets && <AccountPicker presets={presets} value={account} onChange={setAccount} allowAll />}
            <p className="text-xs text-muted-foreground px-1">
              Tests the newest script in the chat on the chosen dates. XAUUSD, US100 and NQ history downloads from Dukascopy the first
              time a range is used (broker time, UTC+2/+3). M1 tests cover up to 370 days. The balance is the account size above
              (default $10,000); the script's own inputs, 1% risk if it sets none. Script read by {modelLabel} (change it in Settings).
            </p>
          </div>
        )}
        {t.running && (
          <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
            <ChartLoader className="w-20 h-12" />{t.phase}
          </div>
        )}
        {t.error && <div role="alert" data-testid="tester-error" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{t.error}</div>}
        {t.results.map((r) => (
          <div key={r.ds.id} id={`result-${r.ds.id}`} className="space-y-5 scroll-mt-4">
            <h2 className="font-heading text-base font-semibold">{r.ds.symbol} {r.ds.timeframe}</h2>
            <ScriptCard result={r} />
            <ScriptResults result={r} />
          </div>
        ))}
        {t.results.length > 0 && !t.running && (
          <Leaderboard
            title="Leaderboard: every market in this test"
            rows={t.results.map((r) => ({ id: r.ds.id, name: `${r.ds.symbol} ${r.ds.timeframe}`, metrics: r.metrics, mc: r.mc }))}
            onSelect={(id) => document.getElementById(`result-${id}`)?.scrollIntoView({ behavior: 'smooth' })}
          />
        )}
      </div>
    </>
  );
}
