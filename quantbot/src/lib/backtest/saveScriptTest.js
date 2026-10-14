import { client } from '@/api/client';
import { createTestSession, saveRun } from './persist';

const { TestSession, StrategyRun } = client.entities;

// Saves a script test under the chat's script name so it shows in Test history and the PnL calendar
export async function saveScriptTest(t, trades) {
  const rules = t.rules.join('\n');
  const page = await TestSession.filter({ bot_name: t.name }, { sort: '-last_run_at', limit: 1 });
  const session = page.items[0] || await createTestSession(
    { botName: t.name, strategy: t.summary, rules, target: t.script.language, model: t.model, balance: t.balance }, t.ds,
  );
  const version = (await StrategyRun.count({ bot_name: t.name })) + 1;
  const { saved } = await saveRun(session, {
    bot_name: t.name, version, target: t.script.language, model: t.model, symbol: t.ds.symbol,
    window_label: `Full history ${t.ds.timeframe}`, start: t.start, end: t.end, rules,
    code: t.script.code, sim_code: t.simCode, summary: t.summary, results: t.results, log: t.logText,
    metrics: { ...t.metrics, profitFactor: Number.isFinite(t.metrics.profitFactor) ? t.metrics.profitFactor : null },
  }, trades);
  return { id: saved.id, version };
}