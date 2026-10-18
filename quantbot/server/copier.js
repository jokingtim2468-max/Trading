// Copy trading: a script's signal (QuantBot webhook) is copied to every account in each group the script is dropped
// on. Accounts are traded on paper at the signal's price; an account with an order URL (e.g. TradersPost) also gets
// the order sent there. Closed trades earn XP for the account and the script, and move the account to passed / failed.
// Everything that happens is written to the activity log (CopyEvent) and the log file, so a run can be evaluated.
import { pointValue, xpForTrade, applyClose, dayIn, levelFromXp, tierOf, groupScriptIds, mapSymbol, sizeFor, copyQty, PLANS, ACCOUNT_STEP, SCRIPT_STEP } from './lib/copyRules.js';
import { blackoutAt } from './lib/blackout.js';

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

// news: () => calendar events (server/news.js) for the groups' news blackouts
export function createCopier({ db, log = () => {}, forward = defaultForward, news = () => [] }) {
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

  // An order for the account's MT5 terminal (the QuantBot Copier EA polls for it and places it)
  async function queueMt5(account, action, trade, refs) {
    if (account.platform !== 'MT5' || !account.mt5_on) return;
    const order = await run('Mt5Order', 'create', {
      account_id: account.id, trade_id: trade.id, action, symbol: trade.symbol, side: trade.side, lots: trade.qty,
      sl: trade.sl ?? null, tp: trade.tp ?? null, status: 'pending', ticket: trade.mt5_ticket || '',
    });
    await note('order', `${who(account)}: ${action} ${action === 'open' ? `${trade.side === 'long' ? 'buy' : 'sell'} ${trade.qty} lots ` : ''}${trade.symbol} queued for MT5`, { ...refs, account_id: account.id, trade_id: trade.id }, { mt5_order: order.id, action });
  }

  async function close(account, script, trade, price, reason, at, refs) {
    const dir = trade.side === 'long' ? 1 : -1;
    const points = (price - trade.entry) * dir;
    const pnl = Math.round(points * trade.qty * trade.point_value * 100) / 100;
    const xp = xpForTrade(pnl);
    const done = await run('AccountTrade', 'update', trade.id, { exit: price, pnl, xp, reason, status: 'closed', closed_at: at });
    const before = { ...account };
    const zone = account.day_zone || PLANS[account.plan]?.dayZone || 'America/New_York';
    const next = applyClose(account, pnl, xp, dayIn(Date.parse(at), zone));
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
        : next.status_reason === 'daily loss' ? `lost ${usd(next.day_start - next.balance)} today, the daily loss limit is ${usd(Number(account.daily_loss))}`
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
  // opts.groupId: send only to that group, whatever scripts it holds (the Terminal page's "Trade on")
  async function onSignal(sig, scriptId, opts = {}) {
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
    const all = (await run('CopyGroup', 'filter', {})).filter((g) => (opts.groupId ? g.id === opts.groupId : groupScriptIds(g).includes(script.id)));
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
        // News, weekday, time-window and date blocks: no new trades (stops, targets and closes still follow)
        const block = blackoutAt(g.blackout, news(), Date.parse(at), sig.symbol);
        if (block) { await note('block', `${g.name}: ${sig.event} ${sig.symbol} not copied. ${block.reason}`, gr, block, 'warn'); continue; }
        for (const a of members.filter((x) => (x.status || 'active') !== 'active')) {
          await note('skip', `${who(a)} skipped: account ${a.status}`, { ...gr, account_id: a.id }, null, 'warn');
        }
        const made = g.trades_made || 0, max = g.max_trades || 100;
        if (made >= max) { await note('limit', `${g.name} is at its max of ${max} trades: ${sig.event} not copied`, gr, { made, max }, 'warn'); continue; }
        await run('CopyGroup', 'update', g.id, { trades_made: made + 1 });
        const side = sig.event === 'buy' ? 'long' : 'short';
        for (const a of accounts) {
          const ar = { ...gr, account_id: a.id };
          const symbol = mapSymbol(a.symbol_map, sig.symbol);
          const pv = pointValue(symbol);
          const unit = a.platform === 'MT5' ? 'lots' : 'contracts';
          for (const t of await openOf(a)) {
            await note('close', `${who(a)}: opposite signal, closing the open ${t.side} first`, { ...ar, trade_id: t.id });
            const done = await close(a, script, t, sig.price, 'reverse', at, gr);
            await queueMt5(a, 'close', done, gr);
          }
          if ((a.status || 'active') !== 'active') continue;
          // One trade per account: an open trade from another script means this one is skipped
          const other = (await run('AccountTrade', 'filter', { account_id: a.id, status: 'open' })).find((t) => t.script_id !== script.id);
          if (other) {
            const by = (await run('Script', 'filter', {})).find((x) => x.id === other.script_id);
            await note('skip', `${who(a)} skipped ${sig.event} ${sig.symbol}: there is already a ${by?.name || 'another script'} ${other.side} on ${other.symbol} on this account (one trade per account)`, ar, { other_trade: other.id, other_script: other.script_id }, 'warn');
            continue;
          }
          const { stop, risk, byRisk, qty } = copyQty(a, sig, pv);
          const sizing = byRisk
            ? `risk $${risk} / (${Math.round(stop * 100) / 100} stop x $${pv}) = ${qty}${unit === 'lots' ? ' lots' : ''}`
            : `${risk > 0 ? 'no stop in the signal, so ' : ''}script qty ${sig.qty || 1} x account qty ${a.copy_qty || 1} = ${qty}`;
          if (!(qty > 0)) {
            const one = unit === 'lots' ? '0.01 lots' : '1 contract';
            await note('skip', `${who(a)} skipped ${sig.event} ${symbol}: ${one} risks $${Math.round(stop * pv * (unit === 'lots' ? 0.01 : 1) * 100) / 100}, more than the $${risk} risk per trade`, ar, { stop, point_value: pv, risk_usd: risk }, 'warn');
            continue;
          }
          const trade = await run('AccountTrade', 'create', {
            account_id: a.id, group_id: g.id, script_id: script.id, trade_id: sig.trade_id, symbol, side, qty,
            point_value: pv, entry: sig.price, sl: sig.sl, tp: sig.tp, status: 'open', opened_at: at,
            risk_open: stop ? Math.round(stop * pv * qty * 100) / 100 : null,
          });
          touched++;
          const riskUsd = trade.risk_open;
          await note('open', `${who(a)} ${side === 'long' ? 'bought' : 'sold'} ${qty}${unit === 'lots' ? ' lots' : ''} ${symbol} @ ${sig.price}${sig.sl != null ? ` SL ${sig.sl}` : ''}${sig.tp != null ? ` TP ${sig.tp}` : ''} (${sizing}${riskUsd != null ? `; risking ${usd(riskUsd)}` : ''}) - group trade ${made + 1}/${max}`,
            { ...ar, trade_id: trade.id }, { side, qty, entry: sig.price, sl: sig.sl, tp: sig.tp, stop, point_value: pv, risk_usd: risk, risk: riskUsd, sizing, balance: a.balance, trade_number: made + 1, max });
          await send(a, 'open', sig, trade, { ...ar, trade_id: trade.id });
          await queueMt5(a, 'open', trade, gr);
        }
      } else if (sig.event === 'set_sl' || sig.event === 'set_tp') {
        for (const a of accounts) {
          const open = await openOf(a);
          if (!open.length) await note('skip', `${who(a)}: ${sig.event} but no open trade from ${script.name}`, { ...gr, account_id: a.id }, null, 'warn');
          for (const t of open) {
            const key = sig.event === 'set_sl' ? 'sl' : 'tp';
            const moved = await run('AccountTrade', 'update', t.id, { [key]: sig[key] });
            touched++;
            await queueMt5(a, 'modify', moved, gr);
            await note('move', `${who(a)}: ${key.toUpperCase()} ${t[key] ?? 'none'} -> ${sig[key]} on ${t.side} ${t.qty} ${t.symbol}`, { ...gr, account_id: a.id, trade_id: t.id }, { [key]: sig[key], from: t[key] });
          }
        }
      } else if (sig.event === 'close') {
        for (const a of accounts) {
          const open = (await openOf(a)).filter((t) => !(sig.trade_id && t.trade_id && sig.trade_id !== t.trade_id));
          if (!open.length) await note('skip', `${who(a)}: close but no open trade from ${script.name}${sig.trade_id ? ` [${sig.trade_id}]` : ''}`, { ...gr, account_id: a.id }, null, 'warn');
          const part = Number(sig.fraction) > 0 && Number(sig.fraction) < 1 ? Number(sig.fraction) : 1;
          for (const t of open) {
            // Part of it: the closed part becomes its own closed trade, the rest stays open
            const cut = part < 1 ? sizeFor(t.qty * part, a.platform) : t.qty;
            if (!(cut > 0)) { await note('skip', `${who(a)}: ${Math.round(part * 100)}% of ${t.qty} is under the smallest size, nothing closed`, { ...gr, account_id: a.id, trade_id: t.id }, null, 'warn'); continue; }
            if (cut < t.qty) {
              await run('AccountTrade', 'update', t.id, { qty: Math.round((t.qty - cut) * 100) / 100 });
              const { id: _id, created_date: _c, updated_date: _u, ...rest } = t;
              const piece = await run('AccountTrade', 'create', { ...rest, qty: cut });
              const done = await close(a, script, piece, sig.price, `${sig.reason || 'signal'} (part)`, at, gr);
              touched++;
              await queueMt5(a, 'close_part', { ...done, id: t.id, qty: cut }, gr);
              continue;
            }
            const done = await close(a, script, t, sig.price, sig.reason || 'signal', at, gr);
            touched++;
            await send(a, 'close', sig, done, { ...gr, account_id: a.id, trade_id: t.id });
            await queueMt5(a, 'close', done, gr);
          }
        }
      }
    }
    return { script: script.name, accounts: touched };
  }

  return { onSignal, note };
}
