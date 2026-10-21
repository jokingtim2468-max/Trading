import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MetricsGrid from '@/components/tester/report/MetricsGrid';
import EquityChart from '@/components/tester/report/EquityChart';
import TradePnlChart from '@/components/tester/report/TradePnlChart';
import TradesTable from '@/components/tester/report/TradesTable';
import RunLog from '@/components/tester/report/RunLog';
import RuleResults from '@/components/tester/RuleResults';
import CodeOutput from '@/components/tester/CodeOutput';
import CodeBlock from '@/components/CodeBlock';
import TradeReplay from '@/components/scripttester/TradeReplay';

const PILL = { passed: 'bg-chart-2/15 text-chart-2 border-chart-2/40', failed: 'bg-destructive/15 text-destructive border-destructive/40', 'in progress': 'bg-chart-4/15 text-chart-4 border-chart-4/40', active: 'bg-primary/15 text-primary border-primary/40' };

// Would this have passed the chosen prop-firm account, and when / why not
function PropResult({ prop }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3" data-testid="prop-result">
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${PILL[prop.status] || PILL.active}`}>{prop.status === 'passed' ? 'Passed 🎯' : prop.status}</span>
      <div className="text-sm flex-1 min-w-[240px]">
        <b>{prop.firm} {prop.model} ${prop.size.toLocaleString()}</b>{prop.date ? ` — ${prop.date}` : ''}: {prop.reason}
        <div className="text-xs text-muted-foreground">{prop.tradingDays} trading day{prop.tradingDays === 1 ? '' : 's'} · lowest balance ${prop.lowestBalance.toLocaleString()} · ended at ${prop.finalBalance.toLocaleString()}. Judged on closed trades; floating losses inside a trade can fail a real account sooner.</div>
      </div>
    </div>
  );
}

export default function ScriptResults({ result }) {
  return (
    <div className="space-y-4">
      {result.prop && <PropResult prop={result.prop} />}
      <MetricsGrid m={result.metrics} />
      <Tabs defaultValue={result.bars ? 'replay' : 'equity'}>
        <TabsList className="flex-wrap h-auto">
          {result.bars && <TabsTrigger value="replay">Replay</TabsTrigger>}
          <TabsTrigger value="equity">Equity</TabsTrigger>
          <TabsTrigger value="trades">Trades ({result.trades.length})</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="log">Log ({result.log.length})</TabsTrigger>
          <TabsTrigger value="code">Script</TabsTrigger>
        </TabsList>
        {result.bars && <TabsContent value="replay"><TradeReplay bars={result.bars} trades={result.trades} balance={result.balance} /></TabsContent>}
        <TabsContent value="equity" className="space-y-4">
          <EquityChart equity={result.equity} balance={result.balance} />
          <TradePnlChart trades={result.trades} />
        </TabsContent>
        <TabsContent value="trades"><TradesTable trades={result.trades} /></TabsContent>
        <TabsContent value="signals"><RuleResults results={result.results} /></TabsContent>
        <TabsContent value="log"><RunLog log={result.log} /></TabsContent>
        <TabsContent value="code" className="space-y-4">
          <CodeOutput code={result.script.code} target={result.script.language} />
          {result.simCode && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Test code the simulator ran</h3>
              <p className="text-xs text-muted-foreground">
                The script translated into JavaScript by {result.modelLabel}. If the results look wrong, paste this into the chat with the Log.
              </p>
              <CodeBlock code={result.simCode.trim()} language="javascript" />
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}