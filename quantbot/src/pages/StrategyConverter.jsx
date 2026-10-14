import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, History, MessageSquare } from 'lucide-react';
import * as api from '@/lib/quantApi';
import { client } from '@/api/client';
import { missingKey, defaultModel } from '@/lib/models';
import useStrategyLab from '@/hooks/useStrategyLab';
import { daysAgo, today } from '@/lib/backtest/data';
import TesterToolbar from '@/components/tester/TesterToolbar';
import TestSettings from '@/components/tester/TestSettings';
import StrategyForm from '@/components/tester/StrategyForm';
import VersionPills from '@/components/tester/report/VersionPills';
import RunReport from '@/components/tester/report/RunReport';
import FixPanel from '@/components/tester/report/FixPanel';
import Leaderboard from '@/components/tester/report/Leaderboard';
import NoKeyBanner from '@/components/quant/NoKeyBanner';
import ChartLoader from '@/components/quant/ChartLoader';

export default function StrategyConverter() {
  const [cfg, setCfg] = useState({
    strategy: '', rules: '', target: 'MT5', model: 'claude-opus-5-5', windowId: '1w', timeframe: 'M15',
    customFrom: daysAgo(90), customTo: today(), botName: '', datasetIds: ['market-XAUUSD', 'market-US100', 'market-NQ'], balance: 10000,
  });
  const set = (key, value) => setCfg((c) => ({ ...c, [key]: value }));
  const [keyStatus, setKeyStatus] = useState(null);
  const lab = useStrategyLab(cfg);

  useEffect(() => {
    Promise.all([api.getKeyStatus(), client.auth.me()]).then(([status, user]) => {
      setKeyStatus(status);
      set('model', defaultModel(status, user));
    });
  }, []);

  const missing = missingKey(cfg.model, keyStatus);
  const needsKey = !!missing;
  const active = lab.runs[lab.activeIdx];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Strategy Converter</h1>
        <Link to="/test-history" className="ml-auto flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-accent">
          <History className="w-4 h-4 text-primary" />History
        </Link>
      </header>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
        <TesterToolbar
          cfg={cfg} set={set} onRun={lab.run} onStop={lab.stop} running={lab.running}
          disabled={!cfg.strategy.trim() || !cfg.botName.trim() || cfg.balance < 100 || needsKey}
        />
        <TestSettings cfg={cfg} set={set} datasets={lab.datasets} />
        {needsKey && <div className="-mx-4 md:-mx-6"><NoKeyBanner provider={missing} onSaved={setKeyStatus} /></div>}
        <StrategyForm strategy={cfg.strategy} onStrategy={(v) => set('strategy', v)} rules={cfg.rules} onRules={(v) => set('rules', v)} />
        {lab.running && (
          <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
            <ChartLoader className="w-20 h-12" />{lab.phase}
          </div>
        )}
        {lab.error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{lab.error}</div>}
        {lab.chatId && !lab.running && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 animate-in fade-in zoom-in-95 duration-pop ease-pop motion-reduce:animate-none">
            <MessageSquare className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-[200px] text-sm">
              <div className="font-medium">Chat ready to fine-tune {cfg.botName}</div>
              <div className="text-muted-foreground">It has the results and code, and the AI can read every test, trade and candle behind them.</div>
            </div>
            <Link to={`/?chat=${lab.chatId}`} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
              Fine-tune in chat
            </Link>
          </div>
        )}
        {lab.runs.length > 0 && <VersionPills runs={lab.runs} activeIdx={lab.activeIdx} onSelect={lab.setActiveIdx} />}
        {active && (
          <>
            <RunReport key={active.id} run={active} />
            <FixPanel
              run={active} running={lab.running || needsKey}
              onPromptChange={(t) => lab.updateFixPrompt(lab.activeIdx, t)}
              onFix={(n) => lab.fix(active, n)}
            />
          </>
        )}
        <Leaderboard
          title="Leaderboard: every market and version"
          rows={lab.runs.map((r) => ({ id: r.id, name: `${r.ds.symbol} ${r.ds.timeframe}`, version: `v${r.version}`, metrics: r.metrics, mc: r.mc }))}
          activeId={active?.id}
          onSelect={(id) => lab.setActiveIdx(lab.runs.findIndex((r) => r.id === id))}
        />
      </div>
    </div>
  );
}