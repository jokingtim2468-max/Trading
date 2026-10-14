import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import VersionPills from '@/components/tester/report/VersionPills';
import ChartLoader from '@/components/quant/ChartLoader';
import SessionHeader from './SessionHeader';
import SavedRunReport from './SavedRunReport';
import Leaderboard from '@/components/tester/report/Leaderboard';

export default function SessionDetail({ session }) {
  const [runs, setRuns] = useState(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    client.entities.StrategyRun.filter({ session_id: session.id }, { sort: 'version', limit: 100 }).then((page) => {
      setRuns(page.items);
      setIdx(page.items.length - 1);
    });
  }, [session.id]);

  const run = runs?.[idx];
  return (
    <div className="max-w-6xl space-y-4">
      <SessionHeader session={session} />
      {!runs && <div className="flex justify-center py-10"><ChartLoader className="w-20 h-12" /></div>}
      {runs && !runs.length && <p className="text-sm text-muted-foreground">No versions were saved in this session.</p>}
      {run && (
        <>
          <VersionPills runs={runs} activeIdx={idx} onSelect={setIdx} />
          <SavedRunReport key={run.id} run={run} balance={session.balance} />
          <Leaderboard
            title="Leaderboard: every version in this session"
            rows={runs.map((r) => ({ id: r.id, name: r.symbol, version: `v${r.version}`, metrics: r.metrics, mc: r.metrics.mc }))}
            activeId={run.id}
            onSelect={(id) => setIdx(runs.findIndex((r) => r.id === id))}
          />
        </>
      )}
    </div>
  );
}