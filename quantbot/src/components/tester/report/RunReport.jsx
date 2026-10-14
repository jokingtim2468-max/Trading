import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MetricsGrid from './MetricsGrid';
import EquityChart from './EquityChart';
import TradePnlChart from './TradePnlChart';
import PriceLiquidityChart from './PriceLiquidityChart';
import CvdChart from './CvdChart';
import VolumeProfileChart from './VolumeProfileChart';
import TradesTable from './TradesTable';
import RunLog from './RunLog';
import RuleResults from '../RuleResults';
import CodeOutput from '../CodeOutput';
import MonteCarloCard from './MonteCarloCard';
import MetaRow from '@/components/MetaRow';
import LucidPanel from '../prop/LucidPanel';

export default function RunReport({ run }) {
  return (
    <div className="space-y-4">
      <MetaRow items={[['Version', `v${run.version}`], ['Tested on', run.windowText]]} />
      <MetricsGrid m={run.metrics} />
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
          <TabsTrigger value="montecarlo">Monte Carlo{run.mc ? ` (${run.mc.grade})` : ''}</TabsTrigger>
          <TabsTrigger value="lucid">Lucid Pro</TabsTrigger>
          <TabsTrigger value="trades">Trades ({run.trades.length})</TabsTrigger>
          <TabsTrigger value="log">Log ({run.log.length})</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <EquityChart equity={run.equity} balance={run.balance} />
          <TradePnlChart trades={run.trades} />
          <RuleResults summary={run.summary} results={run.results} />
        </TabsContent>
        <TabsContent value="liquidity" className="space-y-4">
          <PriceLiquidityChart price={run.price} trades={run.trades} />
          <div className="grid lg:grid-cols-2 gap-4">
            <CvdChart price={run.price} />
            <VolumeProfileChart price={run.price} />
          </div>
        </TabsContent>
        <TabsContent value="montecarlo"><MonteCarloCard mc={run.mc} balance={run.balance} /></TabsContent>
        <TabsContent value="lucid"><LucidPanel trades={run.trades} contractSize={run.contractSize} /></TabsContent>
        <TabsContent value="trades"><TradesTable trades={run.trades} /></TabsContent>
        <TabsContent value="log"><RunLog log={run.log} /></TabsContent>
        <TabsContent value="code" className="space-y-4">
          <CodeOutput code={run.code} target={run.target} />
          <details className="bg-card border border-border rounded-xl p-4">
            <summary className="text-sm font-medium cursor-pointer">Simulation code used by the tester</summary>
            <pre className="mt-3 text-xs font-mono overflow-auto max-h-[400px]">{run.sim_code}</pre>
          </details>
        </TabsContent>
      </Tabs>
    </div>
  );
}