// Would this backtest pass a prop-firm account? Walks the closed trades in time order against a preset's rules
// (profit target, max drawdown — static or end-of-day trailing — daily loss limit, consistency) and says when and
// why it passed or failed. Closed-trade balances, day boundaries in UTC; intraday floating loss isn't modelled, so
// a real account can fail slightly earlier than this says. Pure, unit-tested.
const r2 = (v) => Math.round(v * 100) / 100;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

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
    if (balance <= floor) { result = { status: 'failed', date: d, reason: `max drawdown: balance $${r2(balance).toLocaleString()} hit the ${trailing ? 'trailing ' : ''}floor $${r2(floor).toLocaleString()}` }; break; }
    if (dailyLimit && dayPnl <= -dailyLimit) { result = { status: 'failed', date: d, reason: `daily loss limit: -$${r2(-dayPnl).toLocaleString()} on ${d} (limit $${dailyLimit.toLocaleString()})` }; break; }
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
        ? { status: 'in progress', reason: `target reached but the best day ($${r2(best).toLocaleString()}) is over the ${cons}% consistency cap: $${r2(best / (cons / 100) - profit).toLocaleString()} more profit needed` }
        : { status: 'passed', date: result.date, reason: `profit target $${target.toLocaleString()} reached, consistency met` };
    } else {
      result = { status: target ? 'in progress' : 'active', reason: target ? `$${r2(Math.max(0, target - profit)).toLocaleString()} short of the $${target.toLocaleString()} target when the test ended` : 'funded account: never hit the drawdown floor' };
    }
  }
  const tradingDays = new Set(ts.filter((t) => !result.date || dayOf(t.exitTime) <= result.date).map((t) => dayOf(t.exitTime))).size;
  return {
    ...result, firm: preset.firm, model: preset.model, size: start, target, maxDD, trailing, dailyLimit, consistency: cons || null,
    finalBalance: r2(balance), lowestBalance: r2(lowest), tradingDays, timeline,
  };
}
