import { useEffect, useState } from 'react';
import { client } from '@/api/client';
import { viewRange } from '@/lib/pnl';

const { Trade } = client.entities;

// Per-day / week / month P&L totals for the visible period, computed on the server
export default function usePnlData(view, anchor, bot) {
  const [data, setData] = useState({ rows: new Map(), wins: 0, loading: true });

  useEffect(() => {
    if (!anchor) return;
    let live = true;
    const { field, from, to } = viewRange(view, anchor);
    const query = { [field]: { $gte: from, $lt: to }, ...(bot ? { bot_name: bot } : {}) };
    setData((d) => ({ ...d, loading: true }));
    Promise.all([
      Trade.aggregate({ query, groupBy: field, sum: 'pnl', sort: field, limit: 1000 }),
      Trade.count({ ...query, pnl: { $gt: 0 } }),
    ]).then(([agg, wins]) => {
      if (!live) return;
      setData({ rows: new Map(agg.rows.map((r) => [r[field], { pnl: r.sum_pnl, trades: r.count }])), wins, loading: false });
    });
    return () => { live = false; };
  }, [view, anchor, bot]);

  return data;
}