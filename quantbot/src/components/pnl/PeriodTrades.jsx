import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import TradesTable from '@/components/tester/report/TradesTable';
import { toSimTrade } from '@/lib/history';

export default function PeriodTrades({ field, value, label, bot }) {
  const [page, setPage] = useState(null);
  useEffect(() => {
    setPage(null);
    client.entities.Trade.filter({ [field]: value, ...(bot ? { bot_name: bot } : {}) }, { sort: 'exit_time', limit: 300 })
      .then((p) => setPage({ trades: p.items.map(toSimTrade), more: p.has_more }));
  }, [field, value, bot]);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Trades closed {label}</h3>
      {!page ? <p className="text-sm text-muted-foreground">Loading...</p> : <TradesTable trades={page.trades} />}
      {page?.more && <p className="text-xs text-muted-foreground">Showing the first 300 trades.</p>}
    </div>
  );
}