// Auto-withdraw: for funded accounts set to it, a payout is recorded when all five checks pass (payout cycle, drawdown
// buffer, consistency, flat account, then the record and a notice). Only the profit above the buffer comes out, so the
// account never drops back to its starting balance with no room left. The request itself is made in the firm's own
// dashboard (the firms have no payout API).
import { FIRMS, planFirm } from './lib/copyRules.js';
import { payoutAudit, loadPresets } from './lib/fleetRules.js';

const firmSite = (firm) => loadPresets().firms[firm]?.site || (firm === 'FTMO' ? 'https://ftmo.com' : '');

const DAY = 86400000;
const usd = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// notify(text): optional message to the trader's Discord / Telegram webhook
export function createPayouts({ db, note = async () => {}, notify = async () => {} }) {
  const run = async (...a) => db.run(...a);

  // The five payout checks for one account (see lib/fleetRules.js payoutAudit)
  async function audit(id, now = Date.now()) {
    const a = await run('TradingAccount', 'get', String(id));
    const trades = await run('AccountTrade', 'filter', { account_id: a.id });
    const r = payoutAudit(a, trades.filter((t) => t.status === 'closed'), trades.filter((t) => t.status === 'open').length, now);
    const firm = a.firm || planFirm(a.plan) || '';
    return { account: a.display_name || a.label, firm, ...r, site: firmSite(firm) };
  }

  // Funded accounts on auto-withdraw: when every check passes, the payout is recorded (profit minus the drawdown
  // buffer, never all of it), the balance drops by that amount, and you're told what to request and where
  async function check(now = Date.now()) {
    const due = [];
    for (const a of await run('TradingAccount', 'filter', { auto_withdraw: true })) {
      if (a.stage !== 'funded' || (a.status || 'active') === 'failed') continue;
      const firm = a.firm || planFirm(a.plan) || '';
      const r = await audit(a.id, now);
      if (!r.ok) continue;
      const split = Number(a.split) || FIRMS[planFirm(a.plan)]?.split || 0.8;
      const gross = r.withdraw, net = Math.round(gross * split * 100) / 100;
      const balance = Math.round(((Number(a.balance) || 0) - gross) * 100) / 100;
      const p = await run('Payout', 'create', {
        account_id: a.id, firm, gross, split, net, retained: r.retain, status: 'due', checks: r.rules,
        period_from: a.last_payout_at || a.funded_at || a.created_date, period_to: new Date(now).toISOString(),
      });
      await run('TradingAccount', 'update', a.id, {
        balance, last_payout_at: new Date(now).toISOString(), withdrawn: Math.round(((Number(a.withdrawn) || 0) + net) * 100) / 100,
      });
      const text = `${a.display_name || a.label}: ${firm || 'payout'} withdrawal ready: request ${usd(gross)} (your ${Math.round(split * 100)}% = ${usd(net)}); ${usd(r.retain)} stays in as the drawdown buffer. ${firmSite(firm) ? `Request it at ${firmSite(firm)}.` : "Request it in the firm's dashboard."}`;
      await note('payout', text, { account_id: a.id, group_id: a.group_id || '' }, { payout: p.id, gross, split, net, retained: r.retain });
      await notify(text);
      due.push(p);
    }
    return due;
  }
  return { check, audit };
}
