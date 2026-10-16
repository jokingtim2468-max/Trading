// Copy trading: a script's signal (QuantBot webhook) is copied to every account in each group the script is dropped
// on. Accounts are traded on paper at the signal's price; an account with an order URL (e.g. TradersPost) also gets
// the order sent there. Closed trades earn XP for the account and the script, and move the account to passed / failed.
import { pointValue, xpForTrade, applyClose, nyDay } from './lib/copyRules.js';

// TradersPost-style order message for an account's order URL
export function orderMessage(event, sig, trade) {
  if (event === 'open') {
    return {
      ticker: trade.symbol, action: trade.side === 'long' ? 'buy' : 'sell', quantity: trade.qty, price: trade.entry,
      ...(trade.sl != null ? { stopLoss: { type: 'stop', stopPrice: trade.sl } } : {}),
      ...(trade.tp != null ? { takeProfit: { limitPrice: trade.tp } } : {}),
    };
  }
  return { ticker: trade.symbol, action: 'exit', price: sig.price };
}

async function defaultForward(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  return `${res.status}`;
}

export function createCopier({ db, log = () => {}, forward = defaultForward }) {
  const run = (...a) => db.run(...a);

  async function scriptFor(sig, scriptId) {
    if (scriptId) { try { return await run('Script', 'get', scriptId); } catch { return null; } }
    const name = String(sig.strategy || '').trim().toLowerCase();
    return (await run('Script', 'filter', {})).find((s) => s.name.trim().toLowerCase() === name) || null;
  }

  async function send(account, event, sig, trade) {
    if (!/^https?:\/\//i.test(account.forward_url || '')) return;
    try {
      const status = await forward(account.forward_url, orderMessage(event, sig, trade));
      await run('AccountTrade', 'update', trade.id, { forwarded: `${event} sent (${status})` });
    } catch (e) {
      log(`copy: order to ${account.display_name || account.label} failed: ${e.message}`);
      await run('AccountTrade', 'update', trade.id, { forwarded: `${event} failed: ${e.message}` });
    }
  }

  async function close(account, script, trade, price, reason, at) {
    const dir = trade.side === 'long' ? 1 : -1;
    const pnl = Math.round((price - trade.entry) * dir * trade.qty * trade.point_value * 100) / 100;
    const xp = xpForTrade(pnl);
    const done = await run('AccountTrade', 'update', trade.id, { exit: price, pnl, xp, reason, status: 'closed', closed_at: at });
    const next = applyClose(account, pnl, xp, nyDay(Date.parse(at)));
    await run('TradingAccount', 'update', account.id, next);
    Object.assign(account, next);
    const s = await run('Script', 'get', script.id);
    await run('Script', 'update', script.id, { xp: (s.xp || 0) + xp, trades: (s.trades || 0) + 1, pnl: Math.round(((s.pnl || 0) + pnl) * 100) / 100 });
    if (next.status !== 'active') log(`copy: ${account.display_name || account.label} ${next.status} at $${next.balance.toFixed(2)}`);
    return done;
  }

  // sig: a saved Signal; scriptId: from the webhook path (/hook/<key>/s/<scriptId>), else matched by strategy name
  async function onSignal(sig, scriptId) {
    const script = await scriptFor(sig, scriptId);
    if (!script) return { script: null, accounts: 0 };
    const at = sig.created_date || new Date().toISOString();
    const groups = (await run('CopyGroup', 'filter', { script_id: script.id })).filter((g) => g.enabled !== false);
    let touched = 0;
    for (const g of groups) {
      const accounts = (await run('TradingAccount', 'filter', { group_id: g.id })).filter((a) => (a.status || 'active') === 'active');
      const openOf = async (a) => (await run('AccountTrade', 'filter', { account_id: a.id, script_id: script.id, status: 'open' }));
      if (sig.event === 'buy' || sig.event === 'sell') {
        const made = g.trades_made || 0, max = g.max_trades || 100;
        if (made >= max) { log(`copy: ${g.name} is at its max of ${max} trades, signal not copied`); continue; }
        await run('CopyGroup', 'update', g.id, { trades_made: made + 1 });
        const side = sig.event === 'buy' ? 'long' : 'short';
        const pv = pointValue(sig.symbol);
        for (const a of accounts) {
          for (const t of await openOf(a)) await close(a, script, t, sig.price, 'reverse', at);
          if ((a.status || 'active') !== 'active') continue;
          const stop = sig.sl != null ? Math.abs(sig.price - sig.sl) : 0;
          const qty = a.risk_usd > 0 && stop > 0 ? Math.floor(a.risk_usd / (stop * pv)) : (sig.qty || 1) * (a.copy_qty || 1);
          if (!(qty > 0)) { log(`copy: ${a.display_name || a.label} skipped: 1 contract risks more than $${a.risk_usd}`); continue; }
          const trade = await run('AccountTrade', 'create', {
            account_id: a.id, group_id: g.id, script_id: script.id, trade_id: sig.trade_id, symbol: sig.symbol, side, qty,
            point_value: pv, entry: sig.price, sl: sig.sl, tp: sig.tp, status: 'open', opened_at: at,
          });
          touched++;
          await send(a, 'open', sig, trade);
        }
      } else if (sig.event === 'set_sl' || sig.event === 'set_tp') {
        for (const a of accounts) for (const t of await openOf(a)) {
          await run('AccountTrade', 'update', t.id, sig.event === 'set_sl' ? { sl: sig.sl } : { tp: sig.tp });
          touched++;
        }
      } else if (sig.event === 'close') {
        for (const a of accounts) for (const t of await openOf(a)) {
          if (sig.trade_id && t.trade_id && sig.trade_id !== t.trade_id) continue;
          const done = await close(a, script, t, sig.price, sig.reason || 'signal', at);
          touched++;
          await send(a, 'close', sig, done);
        }
      }
    }
    return { script: script.name, accounts: touched };
  }

  return { onSignal };
}
