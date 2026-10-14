import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MetricsGrid from '@/components/tester/report/MetricsGrid';
import EquityChart from '@/components/tester/report/EquityChart';
import TradePnlChart from '@/components/tester/report/TradePnlChart';
import TradesTable from '@/components/tester/report/TradesTable';
import RunLog from '@/components/tester/report/RunLog';
import RuleResults from '@/components/tester/RuleResults';
import CodeOutput from '@/components/tester/CodeOutput';
import ChartLoader from '@/components/quant/ChartLoader';
import SavedFixPrompt from './SavedFixPrompt';
import MetaRow from '@/components/MetaRow';
import { loadRunTrades, equityFromTrades, parseLog } from '@/lib/history';

export default function SavedRunReport({ run, balance }) {
  const [trades, setTrades] = useState(null);
  useEffect(() => { loadRunTrades(run.id).then(setTrades); }, [run.id]);
  const startBal = balance ?? run.metrics.finalBalance - run.metrics.net;
  const log = parseLog(run.log);

  return (
    <div className="space-y-4">
      <MetaRow items={[
        ['Version', `v${run.version}`], ['Market', run.symbol],
        ['Tested on', `${run.window_label ? `${run.window_label}: ` : ''}${run.start?.slice(0, 10)} to ${run.end?.slice(0, 10)}`],
        ['Saved', run.created_date?.slice(0, 16).replace('T', ' ')],
      ]} />
      <MetricsGrid m={run.metrics} />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trades">Trades{trades ? ` (${trades.length})` : ''}</TabsTrigger>
          <TabsTrigger value="log">Log ({log.length})</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="fix">Fix prompt</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          {!trades ? <div className="flex justify-center py-10"><ChartLoader className="w-20 h-12" /></div> : (
            <>
              <EquityChart equity={equityFromTrades(trades, startBal, Date.parse(run.start))} balance={startBal} />
              <TradePnlChart trades={trades} />
            </>
          )}
          <RuleResults summary={run.summary} results={run.results || []} />
        </TabsContent>
        <TabsContent value="trades"><TradesTable trades={trades || []} /></TabsContent>
        <TabsContent value="log"><RunLog log={log} /></TabsContent>
        <TabsContent value="code" className="space-y-4">
          <CodeOutput code={run.code || ''} target={run.target} />
          <details className="bg-card border border-border rounded-xl p-4">
            <summary className="text-sm font-medium cursor-pointer">Simulation code used by the tester</summary>
            <pre className="mt-3 text-xs font-mono overflow-auto max-h-[400px]">{run.sim_code}</pre>
          </details>
        </TabsContent>
        <TabsContent value="fix"><SavedFixPrompt text={run.fix_prompt} /></TabsContent>
      </Tabs>
    </div>
  );
}