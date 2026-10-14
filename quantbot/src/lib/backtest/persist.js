import { client } from '@/api/client';
import { ymd, weekStart } from '@/lib/pnl';

const { StrategyRun, DataUsage, Trade, TestSession } = client.entities;

export const createTestSession = (config, ds) => TestSession.create({
  bot_name: config.botName, strategy: config.strategy, rules: config.rules, target: config.target, model: config.model,
  symbol: ds.symbol, timeframe: ds.timeframe, balance: config.balance, versions: 0, last_run_at: new Date().toISOString(),
});

// Saves one tested version: the run, its data window, every trade, and the session totals
export async function saveRun(session, record, trades) {
  const saved = await StrategyRun.create({ ...record, session_id: session.id });
  await DataUsage.create({ bot_name: record.bot_name, symbol: record.symbol, start: saved.start, end: saved.end, run_id: saved.id });

  const rows = trades.map((t) => ({
    session_id: session.id, run_id: saved.id, bot_name: record.bot_name, version: record.version, symbol: record.symbol,
    side: t.side, lots: t.lots, entry: t.entry, exit: t.exit, pnl: t.pnl, mae: t.mae, mfe: t.mfe, reason: t.reason,
    entry_time: new Date(t.entryTime).toISOString(), exit_time: new Date(t.exitTime).toISOString(),
    exit_day: ymd(t.exitTime), exit_week: weekStart(t.exitTime), exit_month: ymd(t.exitTime).slice(0, 7),
  }));
  for (let k = 0; k < rows.length; k += 500) await Trade.bulkCreate(rows.slice(k, k + 500));

  const net = record.metrics.net;
  const passed = record.results.filter((r) => r.status === 'pass').length;
  const changes = {
    versions: (session.versions || 0) + 1, latest_net: net, best_net: session.best_net == null ? net : Math.max(session.best_net, net),
    latest_rules: `${passed}/${record.results.length}`, last_run_at: new Date().toISOString(),
  };
  await TestSession.update(session.id, changes);
  return { saved, session: { ...session, ...changes } };
}