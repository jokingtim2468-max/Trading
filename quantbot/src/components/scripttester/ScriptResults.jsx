import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MetricsGrid from '@/components/tester/report/MetricsGrid';
import EquityChart from '@/components/tester/report/EquityChart';
import TradePnlChart from '@/components/tester/report/TradePnlChart';
import TradesTable from '@/components/tester/report/TradesTable';
import RunLog from '@/components/tester/report/RunLog';
import RuleResults from '@/components/tester/RuleResults';
import CodeOutput from '@/components/tester/CodeOutput';

export default function ScriptResults({ result }) {
  return (
    <div className="space-y-4">
      <MetricsGrid m={result.metrics} />
      <Tabs defaultValue="equity">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="equity">Equity</TabsTrigger>
          <TabsTrigger value="trades">Trades ({result.trades.length})</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="log">Log ({result.log.length})</TabsTrigger>
          <TabsTrigger value="code">Script</TabsTrigger>
        </TabsList>
        <TabsContent value="equity" className="space-y-4">
          <EquityChart equity={result.equity} balance={result.balance} />
          <TradePnlChart trades={result.trades} />
        </TabsContent>
        <TabsContent value="trades"><TradesTable trades={result.trades} /></TabsContent>
        <TabsContent value="signals"><RuleResults results={result.results} /></TabsContent>
        <TabsContent value="log"><RunLog log={result.log} /></TabsContent>
        <TabsContent value="code"><CodeOutput code={result.script.code} target={result.script.language} /></TabsContent>
      </Tabs>
    </div>
  );
}