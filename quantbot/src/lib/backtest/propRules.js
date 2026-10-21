// Would this backtest pass a prop-firm account? Walks the closed trades in time order against a preset's rules
// (profit target, max drawdown — static or end-of-day trailing — daily loss limit, consistency) and says when and
// why it passed or failed. Closed-trade balances, day boundaries in UTC; intraday floating loss isn't modelled, so
// a real account can fail slightly earlier than this says. Pure, unit-tested.
const r2 = (v) => Math.round(v * 100) / 100;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// $ amounts in reasons: whole dollars stay whole, otherwise always two decimals ($48,465.80, not $48,465.8)
const usd = (v) => { const x = r2(v); return x.toLocaleString('en-US', { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 }); };

// The account picker: which firms (and which of their models) offer a given account size
export function firmsForSize(presets, size) {
  const out = {};
  for (const p of presets?.presets || []) {
    if (p.size !== Number(size)) continue;
    (out[p.firm] ||= []).includes(p.model) || out[p.firm].push(p.model);
  }
  return out; // { 'FTMO': ['Evaluation (2-Step)', ...], ... }
}

export function presetOf(presets, firm, model, size) {
  return (presets?.presets || []).find((p) => p.firm === firm && p.model === model && p.size === Number(size)) || null;
}

// trades: [{ exitTime, pnl }]. preset: one entry of account_iterations_presets.json.
export function evaluateProp(trades, preset) {
  const start = preset.size;
  const target = preset.profit_target;            // null on funded accounts
  const maxDD = preset.max_drawdown;
  const trailing = preset.drawdown_type === 'eod_trailing';
  const lockAt = /lucid/i.test(preset.firm) ? start + 100 : start; // Lucid's trailing floor stops at start + $100
  const dailyLimit = preset.broker_daily_limit;   // a loss of this much in a day fails the account
  const cons = preset.stage === 'funded' ? preset.consistency_funded : preset.consistency_eval;

  const ts = (trades || []).filter((t) => Number.isFinite(t.exitTime) && Number.isFinite(t.pnl)).sort((a, b) => a.exitTime - b.exitTime);
  let balance = start, peakEod = start, floor = start - maxDD, day = null, dayPnl = 0, lowest = start;
  const days = new Map();
  const timeline = [];
  let result = null;

  const closeDay = () => {
    if (day == null) return;
    days.set(day, r2(dayPnl));
    if (trailing) { peakEod = Math.max(peakEod, balance); floor = Math.min(peakEod - maxDD, lockAt); }
  };

  for (const t of ts) {
    const d = dayOf(t.exitTime);
    if (d !== day) { closeDay(); day = d; dayPnl = 0; }
    balance += t.pnl; dayPnl += t.pnl; lowest = Math.min(lowest, balance);
    timeline.push({ time: t.exitTime, balance: r2(balance), floor: r2(floor) });
    if (balance <= floor) { result = { status: 'failed', date: d, reason: `max drawdown: balance $${usd(balance)} hit the ${trailing ? 'trailing ' : ''}floor $${usd(floor)}` }; break; }
    if (dailyLimit && dayPnl <= -dailyLimit) { result = { status: 'failed', date: d, reason: `daily loss limit: -$${usd(-dayPnl)} on ${d} (limit $${dailyLimit.toLocaleString()})` }; break; }
    if (target && balance - start >= target) {
      days.set(d, r2(dayPnl));
      const profit = balance - start;
      const best = Math.max(...days.values());
      if (cons && best > profit * (cons / 100)) {
        // Target reached but one day is too big a share: keep trading until it's diluted
        if (!result) result = { status: 'diluting', date: d, best, need: r2(best / (cons / 100) - profit) };
      } else { result = { status: 'passed', date: d, reason: `profit target $${target.toLocaleString()} reached` }; break; }
    }
  }
  if (!result || result.status === 'diluting') {
    closeDay();
    const profit = balance - start;
    if (result?.status === 'diluting') {
      const best = Math.max(...days.values());
      result = cons && best > profit * (cons / 100)
        ? { status: 'in progress', reason: `target reached but the best day ($${usd(best)}) is over the ${cons}% consistency cap: $${usd(best / (cons / 100) - profit)} more profit needed` }
        : { status: 'passed', date: result.date, reason: `profit target $${target.toLocaleString()} reached, consistency met` };
    } else {
      result = { status: target ? 'in progress' : 'active', reason: target ? `$${usd(Math.max(0, target - profit))} short of the $${target.toLocaleString()} target when the test ended` : 'funded account: never hit the drawdown floor' };
    }
  }
  const tradingDays = new Set(ts.filter((t) => !result.date || dayOf(t.exitTime) <= result.date).map((t) => dayOf(t.exitTime))).size;
  return {
    ...result, firm: preset.firm, model: preset.model, size: start, target, maxDD, trailing, dailyLimit, consistency: cons || null,
    finalBalance: r2(balance), lowestBalance: r2(lowest), tradingDays, timeline,
  };
}

// A live prop account while you trade (the Terminal's account simulation): closed trades plus the open trades'
// floating P&L, judged the way the firms do it — the max-loss floor (static or trailing the best end-of-day
// balance) and the daily loss limit both count unrealised losses. closed: [{ exitTime, pnl }], floating: $ now,
// now: the current candle's time (ms).
export function simAccount(preset, closed = [], floating = 0, now = Date.now()) {
  const start = preset.size;
  const trailing = preset.drawdown_type === 'eod_trailing';
  const lockAt = /lucid/i.test(preset.firm) ? start + 100 : start;
  const today = dayOf(now);
  const ts = closed.filter((t) => Number.isFinite(t.exitTime)).sort((a, b) => a.exitTime - b.exitTime);
  let balance = start, peakEod = start, day = null, closedToday = 0;
  for (const t of ts) {
    const d = dayOf(t.exitTime);
    if (day && d !== day) peakEod = Math.max(peakEod, balance); // the previous day closed at this balance
    day = d;
    balance += t.pnl;
    if (d === today) closedToday += t.pnl;
  }
  if (day && day !== today) peakEod = Math.max(peakEod, balance);
  const floor = trailing ? Math.min(peakEod - preset.max_drawdown, lockAt) : start - preset.max_drawdown;
  const equity = balance + floating;
  const dayPnl = closedToday + floating;
  const dll = preset.broker_daily_limit || null;
  const profit = balance - start;
  let status = 'active', reason = '';
  if (equity <= floor) { status = 'failed'; reason = `equity $${usd(equity)} hit the ${trailing ? 'trailing ' : ''}max-loss floor $${usd(floor)}`; }
  else if (dll && dayPnl <= -dll) { status = 'failed'; reason = `daily loss limit: -$${usd(-dayPnl)} today (limit $${dll.toLocaleString()})`; }
  else if (preset.profit_target && profit >= preset.profit_target && !floating) {
    const r = evaluateProp(ts, preset);
    status = r.status === 'passed' ? 'passed' : 'active';
    reason = r.status === 'passed' ? `profit target $${preset.profit_target.toLocaleString()} reached` : r.reason;
  }
  return {
    status, reason, start, balance: r2(balance), equity: r2(equity), floor: r2(floor), dayPnl: r2(dayPnl),
    dailyLeft: dll ? r2(dll + dayPnl) : null, roomToFloor: r2(equity - floor),
    toTarget: preset.profit_target ? r2(Math.max(0, preset.profit_target - profit)) : null,
  };
}

// "All accounts": rank every firm/type/size verdict and name the best. Passed first (earliest pass wins), then funded
// accounts that never broke (most profit), then still-in-progress (closest to target), then failed (lasted longest).
const RANK = { passed: 0, active: 1, 'in progress': 2, failed: 3 };
export function rankAccounts(results) {
  const toGo = (r) => (r.target ? r.target - (r.finalBalance - r.size) : 0);
  return [...results].sort((a, b) => {
    if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
    if (a.status === 'passed') return (a.date || '').localeCompare(b.date || '') || a.tradingDays - b.tradingDays;
    if (a.status === 'active') return (b.finalBalance - b.size) - (a.finalBalance - a.size);
    if (a.status === 'in progress') return toGo(a) / a.size - toGo(b) / b.size;
    return (b.date || '').localeCompare(a.date || '');
  });
}
