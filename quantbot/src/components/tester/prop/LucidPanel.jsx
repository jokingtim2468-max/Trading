import { useMemo } from 'react';
import useLucidSettings from '@/hooks/useLucidSettings';
import { simulateLucid } from '@/lib/prop/lucidPro';
import { lucidMonteCarlo } from '@/lib/prop/lucidMonteCarlo';
import LucidSettings from './LucidSettings';
import LucidRules from './LucidRules';
import LucidStageCard from './LucidStageCard';
import LucidOdds from './LucidOdds';
import LucidChart from './LucidChart';

export default function LucidPanel({ trades, contractSize = 100 }) {
  const [s, set] = useLucidSettings();
  const sim = useMemo(() => simulateLucid(trades, s, contractSize), [trades, s, contractSize]);
  const odds = useMemo(() => lucidMonteCarlo(trades, s, contractSize), [trades, s, contractSize]);
  return (
    <div className="space-y-4">
      <LucidSettings s={s} set={set} />
      <LucidRules plan={sim.plan} size={s.size} dllOn={s.dllOn} />
      <div className="grid md:grid-cols-2 gap-4">
        <LucidStageCard kind="eval" stage={sim.eval} plan={sim.plan} size={s.size} />
        <LucidStageCard kind="funded" stage={sim.funded} plan={sim.plan} size={s.size} />
      </div>
      {odds && <LucidOdds odds={odds} />}
      <LucidChart sim={sim} />
      <p className="text-xs text-muted-foreground">
        Runs this backtest's dollar P&L through a LucidPro account. Trading days end at 5 PM New York (about 22:00 UTC).
        The max loss limit is checked against each trade's worst open loss; the daily loss limit against closed trades.
        Size check treats {Number(s.lotsPerMini) || 1} lot as 1 mini contract.
      </p>
    </div>
  );
}