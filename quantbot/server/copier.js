// Copy trading: a script's signal (QuantBot webhook) is copied to every account in each group the script is dropped
// on. Accounts are traded on paper at the signal's price; an account with an order URL (e.g. TradersPost) also gets
// the order sent there. Closed trades earn XP for the account and the script, and move the account to passed / failed.
// Everything that happens is written to the activity log (CopyEvent) and the log file, so a run can be evaluated.
import { pointValue, xpForTrade, applyClose, nyDay, levelFromXp, tierOf, ACCOUNT_STEP, SCRIPT_STEP } from './lib/copyRules.js';

const KEEP = 20000;
const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v) => (v > 0 ? `+${usd(v)}` : usd(v));
const rankName = (xp, step) => { const l = levelFromXp(xp, step).level; const t = tierOf(l); return { level: l, name: `${t.name}${t.division ? ` ${t.division}` : ''}` }; };

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `${res.status}`;
}

export function createCopier({ db, log = () => {}, forward = defaultForward }) {
  const run = (...a) => db.run(...a);
  let written = 0;

  // One activity log line: saved for the app and written to the log file
  async function note(kind, message, refs = {}, data = undefined, level = 'info') {
    log(`copy ${kind}: ${message}`);
    try {
      await run('CopyEvent', 'create', { kind, level, message, ...refs, ...(data ? { data } : {}) });
      if (++written % 500 === 0) {
        const total = await run('CopyEvent', 'count', {});
        if (total > KEEP + 500) {
          const old = await run('CopyEvent', 'filter', {}, 'created_date', total - KEEP);
          await run('CopyEvent', 'deleteMany', { id: { $in: old.map((e) => e.id) } });
        }
      }
    } catch (e) { log(`copy log failed: ${e.message}`); }
  }

  const who = (a) => a.display_name || a.label;

  async function scriptFor(sig, scriptId) {
    if (scriptId) { try { return await run('Script', 'get', scriptId); } catch { return null; } }
    const name = String(sig.strategy || '').trim().toLowerCase();
    return (await run('Script', 'filter', {})).find((s) => s.name.trim().toLowerCase() === name) || null;
  }

  async function send(account, event, sig, trade, refs) {
    if (!/^https?:\/\//i.test(account.forward_url || '')) return;
    const body = orderMessage(event, sig, trade);
    try {
      const status = await forward(account.forward_url, body);
      await run('AccountTrade', 'update', trade.id, { forwarded: `${event} sent (${status})` });
      await note('order', `${who(account)}: ${body.action} ${body.quantity ?? ''} ${body.ticker} sent to the order URL (${status})`.replace('  ', ' '), refs, { url: account.forward_url, body, status });
    } catch (e) {
      await run('AccountTrade', 'update', trade.id, { forwarded: `${event} failed: ${e.message}` });
      await note('order', `${who(account)}: order to the order URL failed: ${e.message}`, refs, { url: account.forward_url, body }, 'error');
    }
  }

  async function close(account, script, trade, price, reason, at, refs) {
    const dir = trade.side === 'long' ? 1 : -1;
    const points = (price - trade.entry) * dir;
    const pnl = Math.round(points * trade.qty * trade.point_value * 100) / 100;
    const xp = xpForTrade(pnl);
    const done = await run('AccountTrade', 'update', trade.id, { exit: price, pnl, xp, reason, status: 'closed', closed_at: at });
    const before = { ...account };
    const next = applyClose(account, pnl, xp, nyDay(Date.parse(at)));
    await run('TradingAccount', 'update', account.id, next);
    Object.assign(account, next);
    const r = { ...refs, account_id: account.id, trade_id: trade.id };
    await note('close', `${who(account)} closed ${trade.side === 'long' ? 'long' : 'short'} ${trade.qty} ${trade.symbol} ${trade.entry} -> ${price} (${reason}): ${signed(pnl)}, +${xp} XP, balance ${usd(next.balance)}`, r,
      { side: trade.side, qty: trade.qty, entry: trade.entry, exit: price, points: Math.round(points * 100) / 100, point_value: trade.point_value, pnl, xp, reason, balance: next.balance, floor: next.floor, opened_at: trade.opened_at, closed_at: at }, pnl < 0 ? 'warn' : 'info');
    if (before.floor != null && next.floor !== before.floor) {
      await note('floor', `${who(account)}: max loss floor moved ${usd(before.floor)} -> ${usd(next.floor)} (best end-of-day balance ${usd(next.peak_eod)})`, r, { from: before.floor, to: next.floor, peak_eod: next.peak_eod });
    }
    const was = rankName(Number(before.xp) || 0, ACCOUNT_STEP), now = rankName(next.xp, ACCOUNT_STEP);
    if (now.level > was.level) await note('rank', `${who(account)} reached level ${now.level} (${now.name}) with ${next.xp} XP`, r, { from: was, to: now, xp: next.xp });
    if (next.status !== (before.status || 'active')) {
      const why = next.status === 'passed' ? `balance ${usd(next.balance)} reached the target ${usd((Number(account.start_balance) || 0) + (Number(account.target) || 0))}`
        : `balance ${usd(next.balance)} hit the max loss floor ${usd(next.floor)}`;
      await note('status', `${who(account)} ${next.status.toUpperCase()}: ${why}`, r, { status: next.status, balance: next.balance, floor: next.floor, target: account.target }, next.status === 'failed' ? 'error' : 'info');
    }
    const s = await run('Script', 'get', script.id);
    const sxp = (s.xp || 0) + xp;
    await run('Script', 'update', script.id, { xp: sxp, trades: (s.trades || 0) + 1, pnl: Math.round(((s.pnl || 0) + pnl) * 100) / 100 });
    const sWas = rankName(s.xp || 0, SCRIPT_STEP), sNow = rankName(sxp, SCRIPT_STEP);
    if (sNow.level > sWas.level) await note('rank', `Script ${script.name} reached level ${sNow.level} (${sNow.name}) with ${sxp} XP`, { script_id: script.id }, { from: sWas, to: sNow, xp: sxp });
    return done;
  }

  // sig: a saved Signal; scriptId: from the webhook path (/hook/<key>/s/<scriptId>), else matched by strategy name
  async function onSignal(sig, scriptId) {
    const script = await scriptFor(sig, scriptId);
    const sigText = `${sig.event} ${sig.symbol || ''}${sig.price != null ? ` @ ${sig.price}` : ''}${sig.sl != null ? ` SL ${sig.sl}` : ''}${sig.tp != null ? ` TP ${sig.tp}` : ''}${sig.trade_id ? ` [${sig.trade_id}]` : ''}`;
    if (!script) {
      if (scriptId || (await run('Script', 'count', {})) > 0) {
        await note('ignore', `Signal ${sigText} from "${sig.strategy || 'no strategy name'}": no script ${scriptId ? `with id ${scriptId}` : 'has that name'}, not copied`, { signal_id: sig.id }, { signal: sig }, 'warn');
      }
      return { script: null, accounts: 0 };
    }
    const refs = { script_id: script.id, signal_id: sig.id };
    const at = sig.created_date || new Date().toISOString();
    const all = await run('CopyGroup', 'filter', { script_id: script.id });
    const groups = all.filter((g) => g.enabled !== false);
    await note('signal', `${script.name}: ${sigText} -> ${groups.length ? groups.map((g) => g.name).join(', ') : 'no group'}`, refs, { signal: sig, groups: groups.map((g) => g.id) });
    for (const g of all.filter((x) => x.enabled === false)) await note('skip', `${g.name} is paused: ${sig.event} not copied`, { ...refs, group_id: g.id }, null, 'warn');
    if (!all.length) await note('skip', `${script.name} isn't on any group: drag it onto one to copy its trades`, refs, null, 'warn');
    if (!['buy', 'sell', 'set_sl', 'set_tp', 'close'].includes(sig.event)) {
      await note('ignore', `${sig.event} isn't copied (accounts copy market buy / sell, SL / TP moves and closes)`, refs, null, 'warn');
      return { script: script.name, accounts: 0 };
    }
    let touched = 0;
    for (const g of groups) {
      const gr = { ...refs, group_id: g.id };
      const members = await run('TradingAccount', 'filter', { group_id: g.id });
      const accounts = members.filter((a) => (a.status || 'active') === 'active');
      const openOf = async (a) => (await run('AccountTrade', 'filter', { account_id: a.id, script_id: script.id, status: 'open' }));
      if (!members.length) await note('skip', `${g.name} has no accounts`, gr, null, 'warn');
      if (sig.event === 'buy' || sig.event === 'sell') {
        for (const a of members.filter((x) => (x.status || 'active') !== 'active')) {
          await note('skip', `${who(a)} skipped: account ${a.status}`, { ...gr, account_id: a.id }, null, 'warn');
        }
        const made = g.trades_made || 0, max = g.max_trades || 100;
        if (made >= max) { await note('limit', `${g.name} is at its max of ${max} trades: ${sig.event} not copied`, gr, { made, max }, 'warn'); continue; }
        await run('CopyGroup', 'update', g.id, { trades_made: made + 1 });
        const side = sig.event === 'buy' ? 'long' : 'short';
        const pv = pointValue(sig.symbol);
        for (const a of accounts) {
          const ar = { ...gr, account_id: a.id };
          for (const t of await openOf(a)) {
            await note('close', `${who(a)}: opposite signal, closing the open ${t.side} first`, { ...ar, trade_id: t.id });
            await close(a, script, t, sig.price, 'reverse', at, gr);
          }
          if ((a.status || 'active') !== 'active') continue;
          const stop = sig.sl != null ? Math.abs(sig.price - sig.sl) : 0;
          const byRisk = a.risk_usd > 0 && stop > 0;
          const qty = byRisk ? Math.floor(a.risk_usd / (stop * pv)) : (sig.qty || 1) * (a.copy_qty || 1);
          const sizing = byRisk
            ? `risk $${a.risk_usd} / (${Math.round(stop * 100) / 100} stop x $${pv}) = ${qty}`
            : `${a.risk_usd > 0 ? 'no stop in the signal, so ' : ''}script qty ${sig.qty || 1} x account qty ${a.copy_qty || 1} = ${qty}`;
          if (!(qty > 0)) {
            await note('skip', `${who(a)} skipped ${sig.event} ${sig.symbol}: 1 contract risks $${Math.round(stop * pv * 100) / 100}, more than the $${a.risk_usd} risk per trade`, ar, { stop, point_value: pv, risk_usd: a.risk_usd }, 'warn');
            continue;
          }
          const trade = await run('AccountTrade', 'create', {
            account_id: a.id, group_id: g.id, script_id: script.id, trade_id: sig.trade_id, symbol: sig.symbol, side, qty,
            point_value: pv, entry: sig.price, sl: sig.sl, tp: sig.tp, status: 'open', opened_at: at,
          });
          touched++;
          const riskUsd = stop ? Math.round(stop * pv * qty * 100) / 100 : null;
          await note('open', `${who(a)} ${side === 'long' ? 'bought' : 'sold'} ${qty} ${sig.symbol} @ ${sig.price}${sig.sl != null ? ` SL ${sig.sl}` : ''}${sig.tp != null ? ` TP ${sig.tp}` : ''} (${sizing}${riskUsd != null ? `; risking ${usd(riskUsd)}` : ''}) - group trade ${made + 1}/${max}`,
            { ...ar, trade_id: trade.id }, { side, qty, entry: sig.price, sl: sig.sl, tp: sig.tp, stop, point_value: pv, risk_usd: a.risk_usd, risk: riskUsd, sizing, balance: a.balance, trade_number: made + 1, max });
          await send(a, 'open', sig, trade, { ...ar, trade_id: trade.id });
        }
      } else if (sig.event === 'set_sl' || sig.event === 'set_tp') {
        for (const a of accounts) {
          const open = await openOf(a);
          if (!open.length) await note('skip', `${who(a)}: ${sig.event} but no open trade from ${script.name}`, { ...gr, account_id: a.id }, null, 'warn');
          for (const t of open) {
            const key = sig.event === 'set_sl' ? 'sl' : 'tp';
            await run('AccountTrade', 'update', t.id, { [key]: sig[key] });
            touched++;
            await note('move', `${who(a)}: ${key.toUpperCase()} ${t[key] ?? 'none'} -> ${sig[key]} on ${t.side} ${t.qty} ${t.symbol}`, { ...gr, account_id: a.id, trade_id: t.id }, { [key]: sig[key], from: t[key] });
          }
        }
      } else if (sig.event === 'close') {
        for (const a of accounts) {
          const open = (await openOf(a)).filter((t) => !(sig.trade_id && t.trade_id && sig.trade_id !== t.trade_id));
          if (!open.length) await note('skip', `${who(a)}: close but no open trade from ${script.name}${sig.trade_id ? ` [${sig.trade_id}]` : ''}`, { ...gr, account_id: a.id }, null, 'warn');
          for (const t of open) {
            const done = await close(a, script, t, sig.price, sig.reason || 'signal', at, gr);
            touched++;
            await send(a, 'close', sig, done, { ...gr, account_id: a.id, trade_id: t.id });
          }
        }
      }
    }
    return { script: script.name, accounts: touched };
  }

  return { onSignal, note };
}
