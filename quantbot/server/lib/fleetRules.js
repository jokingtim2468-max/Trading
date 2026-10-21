// Account profiles (presets), the safety guard and the payout audit.
// Presets: server/presets/account_iterations_presets.json (the master spec's numbers per firm / model / size).
// Safety guard: an account set from a preset stops opening trades for the rest of its day once it is down its daily
// loss floor, up its daily profit cap, or has lost kill_switch_losses trades that day (the 2-strike kill switch).
// Payout audit: the five checks before a withdrawal (payout cycle, drawdown buffer, consistency, flat, the record).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayIn, money2 } from './copyRules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86400000;
let cache = null;
export function loadPresets() {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(here, '..', 'presets', 'account_iterations_presets.json'), 'utf8'));
  return cache;
}
export const findPreset = (id) => loadPresets().presets.find((p) => p.id === id) || null;
export const presetFor = (firm, model, size) => loadPresets().presets.find((p) => p.firm === firm && p.model === model && p.size === Number(size)) || null;

const CODES = { 'Lucid Trading': 'LUCID', FTMO: 'FTMO', The5ers: 'T5', 'Alpha Capital': 'ALPHA', FundedNext: 'FN' };
const MODEL_CODES = {
  LucidFlex: 'FLEX', LucidPro: 'PRO', 'LucidFlex Funded': 'FLEXF', 'LucidPro Funded': 'PROF',
  'Evaluation (2-Step)': 'EVAL', 'Verification (2-Step)': 'VERIF', 'Funded Account': 'FUNDED', '1-Step Challenge': '1STEP', 'Funded (1-Step)': 'FUNDED1',
  'High Stakes Step 1': 'HS1', 'High Stakes Step 2': 'HS2', 'High Stakes Funded': 'HSF', HyperGrowth: 'HG', Evaluation: 'EVAL',
};
// Alpha Pro variants: "Pro 8% Phase 1" -> PRO8-P1, "Pro 10% Qualified" -> PRO10-Q
const modelCode = (m) => MODEL_CODES[m] || String(m).replace(/^Pro (\d+)% (Phase (\d)|Qualified)$/, (_, v, s, n) => `PRO${v}-${n ? `P${n}` : 'Q'}`).replace(/[^A-Z0-9-]/gi, '').toUpperCase().slice(0, 10);
// LUCID-FLEX-100K-01: the next free number for that firm, model and size
export function accountId(preset, taken = []) {
  const base = `${CODES[preset.firm] || 'ACC'}-${modelCode(preset.model)}-${preset.size / 1000}K`;
  for (let n = 1; n < 1000; n++) { const id = `${base}-${String(n).padStart(2, '0')}`; if (!taken.includes(id)) return id; }
  return `${base}-${Date.now()}`;
}
export const profileName = (preset) => `1m Exhaustion Pro (${preset.model.replace(/^Lucid/, '')} 1:${preset.tp_ratio.toFixed(1)})`;

// The account fields a preset sets (the copier, rule guard and payout audit read them)
export function presetFields(preset, firmInfo = {}) {
  const funded = preset.stage === 'funded';
  return {
    preset_id: preset.id, firm: preset.firm, model: preset.model, stage: preset.stage, profile_name: profileName(preset),
    start_balance: preset.size, target: funded ? null : preset.profit_target ?? null, max_loss: preset.max_drawdown ?? null,
    trailing: preset.drawdown_type === 'eod_trailing', daily_loss: preset.broker_daily_limit ?? null, day_zone: firmInfo.day_zone || 'America/New_York',
    risk_usd: preset.risk_usd, tp_ratio: preset.tp_ratio, daily_cap: preset.daily_profit_cap ?? null, daily_floor: preset.daily_loss_floor ?? null,
    kill_losses: preset.kill_switch_losses ?? 2, stop_floor: preset.stop_floor_pts, buffer_usd: preset.buffer_usd ?? null,
    payout_days: preset.payout_days ?? null, consistency: (funded ? preset.consistency_funded : preset.consistency_eval) ?? firmInfo.consistency ?? null,
  };
}

// Safety guard: why this account may not open a new trade today (null = it may). closedToday: its trades closed today.
export function safetyBlock(a, closedToday) {
  const pnl = closedToday.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const losses = closedToday.filter((t) => t.pnl < 0).length;
  if (Number(a.daily_floor) < 0 && pnl <= Number(a.daily_floor)) return `daily loss floor: ${pnl < 0 ? '-' : ''}$${money2(pnl)} today (floor -$${money2(a.daily_floor)})`;
  if (Number(a.daily_cap) > 0 && pnl >= Number(a.daily_cap)) return `daily profit cap reached: +$${money2(pnl)} today (cap $${money2(a.daily_cap)})`;
  if (Number(a.kill_losses) > 0 && losses >= Number(a.kill_losses)) return `kill switch: ${losses} losing trades today`;
  return null;
}
export const closedOnDay = (trades, a, now = Date.now()) => {
  const today = dayIn(now, a.day_zone || 'America/New_York');
  return trades.filter((t) => t.status === 'closed' && t.closed_at && dayIn(Date.parse(t.closed_at), a.day_zone || 'America/New_York') === today);
};

// The five payout checks. closed: the account's closed trades; open: how many trades are still open.
// -> { ok, withdraw, retain, profit, rules: [{ rule, ok, detail }], needed }
export function payoutAudit(a, closed, open, now = Date.now()) {
  const start = Number(a.start_balance) || 0, balance = a.balance != null ? Number(a.balance) : start;
  const profit = Math.round((balance - start) * 100) / 100;
  const rules = [];
  // 1. Payout cycle: days since the first trade of this cycle (after the last payout, else since funded / first trade)
  const cycleStart = Date.parse(a.last_payout_at || '') || Date.parse(a.funded_at || '') || Math.min(...closed.map((t) => Date.parse(t.opened_at || t.closed_at)).filter(Number.isFinite), now);
  const days = Number(a.payout_days) || 14;
  const waited = (now - cycleStart) / DAY;
  rules.push({ rule: `${days}-day payout cycle`, ok: waited >= days, detail: waited >= days ? `${Math.floor(waited)} days since the cycle started` : `unlocks ${new Date(cycleStart + days * DAY).toISOString().slice(0, 10)} (${Math.ceil(days - waited)} days left)` });
  // 2. Drawdown buffer: never take out everything; keep buffer_usd (else 2.5% of the account) above the start
  const retain = Number(a.buffer_usd) > 0 ? Number(a.buffer_usd) : Math.round(start * 0.025);
  const withdraw = Math.max(0, Math.round((profit - retain) * 100) / 100);
  rules.push({ rule: 'Drawdown buffer', ok: withdraw > 0, detail: withdraw > 0 ? `keeps $${money2(retain)}, withdraws $${money2(withdraw)} of $${money2(profit)} profit` : `profit $${money2(Math.max(profit, 0))} isn't above the $${money2(retain)} buffer yet` });
  // 3. Consistency: no single day over the cap of the cycle's profit
  const cap = Number(a.consistency) || 0;
  let needed = 0;
  if (cap > 0) {
    const daysPnl = new Map();
    for (const t of closed) {
      const x = Date.parse(t.closed_at);
      if (!(x >= cycleStart)) continue;
      const k = dayIn(x, a.day_zone || 'America/New_York');
      daysPnl.set(k, (daysPnl.get(k) || 0) + (Number(t.pnl) || 0));
    }
    const total = [...daysPnl.values()].reduce((s, v) => s + v, 0), best = Math.max(0, ...daysPnl.values());
    const pct = total > 0 ? (best / total) * 100 : 0;
    needed = total > 0 && pct > cap ? Math.ceil((best / (cap / 100) - total) * 100) / 100 : 0;
    rules.push({ rule: `${cap}% consistency`, ok: total > 0 && pct <= cap, detail: total <= 0 ? 'no profit this cycle' : pct <= cap ? `best day ${pct.toFixed(1)}% of the cycle's profit` : `best day ${pct.toFixed(1)}% of profit; make $${money2(needed)} more over other days to bring it to ${cap}%` });
  } else rules.push({ rule: 'Consistency', ok: true, detail: 'no consistency rule on this account' });
  // 4. Flat: no open trade
  rules.push({ rule: 'Flat account', ok: open === 0, detail: open === 0 ? 'no open trades' : `${open} trade${open === 1 ? '' : 's'} still open: close them first` });
  const ok = rules.every((r) => r.ok);
  return { ok, withdraw: ok ? withdraw : 0, could: withdraw, retain, profit, rules, needed };
}
