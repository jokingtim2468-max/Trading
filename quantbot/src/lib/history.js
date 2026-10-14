import { client } from '@/api/client';

export const toSimTrade = (r) => ({
  side: r.side, entry: r.entry, exit: r.exit, lots: r.lots, pnl: r.pnl, reason: r.reason,
  entryTime: Date.parse(r.entry_time), exitTime: Date.parse(r.exit_time), mae: r.mae ?? 0, mfe: r.mfe ?? 0,
});

// All trades of one saved run, in exit order
export async function loadRunTrades(runId) {
  const out = [];
  let cursor;
  do {
    const page = await client.entities.Trade.filter({ run_id: runId }, { sort: 'exit_time', limit: 1000, ...(cursor ? { cursor } : {}) });
    out.push(...page.items.map(toSimTrade));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return out;
}

export function equityFromTrades(trades, balance, start) {
  let bal = balance;
  const pts = [{ t: start, equity: bal, balance: bal }];
  for (const t of trades) { bal += t.pnl; pts.push({ t: t.exitTime, equity: bal, balance: bal }); }
  return pts;
}

export function parseLog(text = '') {
  return text.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^\[(INFO|WARN|ERROR)\] (\d{4}-\d\d-\d\dT\d\d:\d\d)? ?(.*)$/);
    return m ? { level: m[1].toLowerCase(), t: m[2] ? Date.parse(`${m[2]}Z`) : null, msg: m[3] } : { level: 'info', t: null, msg: line };
  });
}