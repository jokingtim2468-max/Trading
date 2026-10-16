// Copy trading in the app: the same XP, rank, plan and name rules the server's copier uses, plus overview sums
export {
  XP_TABLE, xpForTrade, ACCOUNT_STEP, SCRIPT_STEP, levelFromXp, TIERS, tierOf, PLANS, pointValue, randomName, randomSeed, evaluate,
} from '../../server/lib/copyRules.js';

export const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signedMoney = (v) => (v > 0 ? `+${money(v)}` : money(v));

// A group's overview: P&L split into profit and loss, trades made against the max, accounts passed / failed / current
export function groupStats(group, members, trades) {
  const closed = trades.filter((t) => t.status === 'closed');
  const profit = closed.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const loss = closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const count = (s) => members.filter((a) => (a.status || 'active') === s).length;
  return {
    pnl: Math.round((profit + loss) * 100) / 100, profit: Math.round(profit * 100) / 100, loss: Math.round(loss * 100) / 100,
    wins: closed.filter((t) => t.pnl > 0).length, losses: closed.filter((t) => t.pnl < 0).length,
    open: trades.length - closed.length,
    made: group.trades_made || 0, max: group.max_trades || 100,
    passed: count('passed'), failed: count('failed'), current: count('active'),
  };
}

// Script webhook addresses: each script gets its own, so signals go to the groups it is dropped on
export function scriptHooks(config, scriptId) {
  if (!config?.key) return { local: '', public: '' };
  const t = config.tunnel || {};
  return {
    local: config.localUrl ? `${config.localUrl}/s/${scriptId}` : '',
    public: t.state === 'on' && t.url ? `${t.url}/hook/${config.key}/s/${scriptId}` : '',
  };
}

// Suggested risk per trade for a plan: 15% of its max loss ($300 on a Lucid 50K)
export const planRisk = (plan) => (plan?.maxLoss ? Math.round(plan.maxLoss * 0.15) : '');

// Something done in the app (script dropped on a group, account moved, reset...) for the activity log
export async function logSetup(message, refs = {}, data = undefined) {
  const { client } = await import('@/api/client');
  try { await client.entities.CopyEvent.create({ kind: 'setup', level: 'info', message, ...refs, ...(data ? { data } : {}) }); } catch { /* the log never blocks the action */ }
}

// CSV text from rows and [header, value(row)] columns; Excel-safe quoting
export function toCsv(rows, columns) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(([h]) => cell(h)).join(','), ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(','))].join('\n');
}

export function downloadText(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
