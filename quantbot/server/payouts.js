// Auto-withdraw: for funded accounts set to it, the profit comes out on the firm's payout schedule (FTMO every
// 14 days, your 80% split). QuantBot records the payout, starts the account again from its starting balance and tells
// you how much to request; the request itself is made in the firm's own dashboard (FTMO has no payout API).
import { FIRMS, planFirm } from './lib/copyRules.js';

const DAY = 86400000;
const usd = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function createPayouts({ db, note = async () => {} }) {
  const run = async (...a) => db.run(...a);

  async function check(now = Date.now()) {
    const due = [];
    for (const a of await run('TradingAccount', 'filter', { auto_withdraw: true })) {
      if (a.stage !== 'funded' || (a.status || 'active') === 'failed') continue;
      const firm = planFirm(a.plan);
      const days = Number(a.payout_days) || FIRMS[firm]?.payoutDays || 14;
      const since = Date.parse(a.last_payout_at || a.funded_at || a.created_date);
      if (!(now - since >= days * DAY)) continue;
      const start = Number(a.start_balance) || 0;
      const profit = Math.round(((Number(a.balance) || start) - start) * 100) / 100;
      if (profit <= 0) continue;
      // Payouts need a flat account
      if ((await run('AccountTrade', 'filter', { account_id: a.id, status: 'open' })).length) continue;
      const split = Number(a.split) || FIRMS[firm]?.split || 0.8;
      const net = Math.round(profit * split * 100) / 100;
      const p = await run('Payout', 'create', {
        account_id: a.id, firm: firm || '', gross: profit, split, net, status: 'due',
        period_from: new Date(since).toISOString(), period_to: new Date(now).toISOString(),
      });
      await run('TradingAccount', 'update', a.id, {
        balance: start, peak_eod: start, day_start: start, last_payout_at: new Date(now).toISOString(),
        withdrawn: Math.round(((Number(a.withdrawn) || 0) + net) * 100) / 100,
      });
      await note('payout', `${a.display_name || a.label}: ${firm || 'payout'} withdrawal due: ${usd(profit)} profit, your ${Math.round(split * 100)}% = ${usd(net)}. Request it in ${firm === 'FTMO' ? "FTMO's Client Area (Withdraw)" : "the firm's dashboard"}; the account starts again at ${usd(start)}.`,
        { account_id: a.id, group_id: a.group_id || '' }, { payout: p.id, gross: profit, split, net, days });
      due.push(p);
    }
    return due;
  }

  return { check };
}
