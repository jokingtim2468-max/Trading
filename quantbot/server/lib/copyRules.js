// Copy trading rules shared by the server (copier) and the app: XP and ranks, account plans, contract sizes, names.

// XP for one closed trade, from its profit in dollars (losses count as "5 or below")
export const XP_TABLE = [[5, 10], [10, 20], [20, 30], [Infinity, 50]];
export const xpForTrade = (pnl) => XP_TABLE.find(([upTo]) => pnl <= upTo)[1];

// Scripts a group trades: script_ids, plus script_id from groups made before groups could hold several
export const groupScriptIds = (g) => [...new Set([...(Array.isArray(g?.script_ids) ? g.script_ids : []), g?.script_id].filter(Boolean))];

// Rank steps: the first rank-up costs one step, each next one a step more (100, 200, 300 ... for accounts)
export const ACCOUNT_STEP = 100;
export const SCRIPT_STEP = 1000;
export function levelFromXp(xp, step) {
  let level = 0, used = 0;
  while (xp - used >= step * (level + 1)) { used += step * (level + 1); level++; }
  const need = step * (level + 1);
  return { level, into: xp - used, need, progress: (xp - used) / need };
}

// Tiers drawn as the ring around the picture, three levels each
export const TIERS = [
  { name: 'Unranked', color: '#6b7280' },
  { name: 'Iron', color: '#8b8f98' },
  { name: 'Bronze', color: '#c27c4e' },
  { name: 'Silver', color: '#c9d1dc' },
  { name: 'Gold', color: '#f2c14e' },
  { name: 'Platinum', color: '#5ee0c8' },
  { name: 'Diamond', color: '#6fa8ff' },
  { name: 'Master', color: '#b57bff' },
  { name: 'Legend', color: '#ff5d73' },
];
export function tierOf(level) {
  if (level <= 0) return { ...TIERS[0], index: 0, division: '' };
  const index = Math.min(TIERS.length - 1, Math.ceil(level / 3));
  const division = index === TIERS.length - 1 ? `${level - (TIERS.length - 2) * 3}` : ['I', 'II', 'III'][(level - 1) % 3];
  return { ...TIERS[index], index, division };
}

// Account plans: a starting balance, a profit target that passes the account and a max loss that fails it.
// Lucid's max loss trails the best end-of-day balance and locks at the start + $100 (New York trading day).
// FTMO (2-Step): 10% target in the Challenge, 5% in the Verification, none once funded; a 5% daily loss and a fixed
// 10% max loss from the starting balance; its day resets at midnight Prague time.
const ftmo = (k) => ({ label: `FTMO ${k / 1000}K`, firm: 'FTMO', start: k, target: k * 0.1, maxLoss: k * 0.1, dailyLoss: k * 0.05, trailing: false, dayZone: 'Europe/Prague', stages: { challenge: k * 0.1, verification: k * 0.05, funded: null } });
const lucid = (k, target, maxLoss) => ({ label: `LucidPro ${k / 1000}K`, firm: 'Lucid', start: k, target, maxLoss, trailing: true, dayZone: 'America/New_York', stages: { evaluation: target, funded: null } });
export const PLANS = {
  none: { label: 'Just track it', start: 50000, target: null, maxLoss: null, trailing: false },
  lucid25: lucid(25000, 1250, 1000),
  lucid50: lucid(50000, 3000, 2000),
  lucid100: lucid(100000, 6000, 3000),
  lucid150: lucid(150000, 9000, 4500),
  ftmo10: ftmo(10000),
  ftmo25: ftmo(25000),
  ftmo50: ftmo(50000),
  ftmo100: ftmo(100000),
  ftmo200: ftmo(200000),
  custom: { label: 'Custom', start: 10000, target: 1000, maxLoss: 500, trailing: false },
};
export const STAGE_LABELS = { evaluation: 'Evaluation', challenge: 'Challenge', verification: 'Verification', funded: 'Funded' };
export const planFirm = (planId) => PLANS[planId]?.firm || null;

// Firm limits: Lucid allows 5 funded accounts per person; FTMO allows any number of accounts but at most $400,000
// of funded capital at once. Payouts: FTMO pays on request every 14 days (80% split, 90% with its scaling plan).
export const FIRMS = {
  Lucid: { maxFunded: 5, maxFundedCapital: null, payoutDays: null, split: 0.9 },
  FTMO: { maxFunded: null, maxFundedCapital: 400000, payoutDays: 14, split: 0.8 },
};
const live = (a) => (a.status || 'active') !== 'failed';
// Why an account can't be funded (null when it can): counts the trader's other live funded accounts at that firm
export function firmLimitError(accounts, candidate) {
  const firm = planFirm(candidate.plan);
  const rules = FIRMS[firm];
  if (!rules || candidate.stage !== 'funded') return null;
  const others = accounts.filter((a) => a.id !== candidate.id && planFirm(a.plan) === firm && a.stage === 'funded' && live(a));
  if (rules.maxFunded && others.length + 1 > rules.maxFunded) return `${firm} allows ${rules.maxFunded} funded accounts per person; you already have ${others.length}.`;
  if (rules.maxFundedCapital) {
    const used = others.reduce((sum, a) => sum + (Number(a.start_balance) || 0), 0);
    if (used + (Number(candidate.start_balance) || 0) > rules.maxFundedCapital) {
      return `${firm} allows $${rules.maxFundedCapital.toLocaleString('en-US')} of funded capital at once; you have $${used.toLocaleString('en-US')} funded, so this $${(Number(candidate.start_balance) || 0).toLocaleString('en-US')} account doesn't fit.`;
    }
  }
  return null;
}
// How much of each firm's funded limit is used: [{ firm, funded, max, capital, maxCapital }]
export function firmUsage(accounts) {
  return Object.entries(FIRMS).map(([firm, r]) => {
    const funded = accounts.filter((a) => planFirm(a.plan) === firm && a.stage === 'funded' && live(a));
    return { firm, funded: funded.length, max: r.maxFunded, capital: funded.reduce((s, a) => s + (Number(a.start_balance) || 0), 0), maxCapital: r.maxFundedCapital };
  }).filter((u) => accounts.some((a) => planFirm(a.plan) === u.firm));
}

// Dollars per 1.0 price move for one contract / lot, from the symbol (TradingView tickers like MGC1!, COMEX:GC1!)
const POINT_VALUES = [
  [/^MGC/, 10], [/^GC/, 100], [/^MNQ/, 2], [/^NQ/, 20], [/^MES/, 5], [/^ES/, 50], [/^MYM/, 0.5], [/^YM/, 5],
  [/^M2K/, 5], [/^RTY/, 50], [/^MCL/, 100], [/^CL/, 1000], [/^(XAUUSD|GOLD)/, 100], [/^(US100|NAS100|USTEC|NDX)/, 1],
];
// The account's own symbol for a signal's symbol: "MGC1!=XAUUSD, MNQ1!=US100.cash" (case and exchange prefix ignored)
export function mapSymbol(map, symbol) {
  const bare = (x) => String(x || '').trim().toUpperCase().replace(/^[A-Z_]+:/, '');
  for (const pair of String(map || '').split(/[,;\n]/)) {
    const [from, to] = pair.split('=').map((x) => x?.trim());
    if (from && to && bare(from) === bare(symbol)) return to;
  }
  return symbol;
}
// Whole contracts for futures, 0.01 lots for MT5
export const sizeFor = (raw, platform) => (platform === 'MT5' ? Math.floor(raw * 100 + 1e-9) / 100 : Math.floor(raw + 1e-9));

// An account's size for a signal: by dollar risk (the signal's risk_usd, else the account's) when there's a stop,
// else the signal's qty times the account's
export function copyQty(a, sig, pv) {
  const stop = sig.sl != null && sig.price != null ? Math.abs(sig.price - sig.sl) : 0;
  const risk = Number(sig.risk_usd) > 0 ? Number(sig.risk_usd) : Number(a.risk_usd) || 0;
  const byRisk = risk > 0 && stop > 0;
  return { stop, risk, byRisk, qty: sizeFor(byRisk ? risk / (stop * pv) : (Number(sig.qty) || 1) * (Number(a.copy_qty) || 1), a.platform) };
}

// How much an account can still lose before a firm rule fails it: to the max loss floor and to today's daily loss
// limit (a new day in the account's zone starts the day again from the balance)
export function accountRoom(a, now = Date.now()) {
  const start = Number(a.start_balance) || 0;
  const balance = a.balance != null ? Number(a.balance) : start;
  const maxLoss = Number(a.max_loss) || 0, daily = Number(a.daily_loss) || 0;
  const floor = a.floor != null ? Number(a.floor) : maxLoss ? start - maxLoss : null;
  const zone = a.day_zone || PLANS[a.plan]?.dayZone || 'America/New_York';
  const dayStart = a.day_key === dayIn(now, zone) && a.day_start != null ? Number(a.day_start) : balance;
  const toFloor = floor == null ? Infinity : balance - floor;
  const toDaily = daily ? daily - (dayStart - balance) : Infinity;
  const room = Math.min(toFloor, toDaily);
  return { balance, floor, dailyFloor: daily ? dayStart - daily : null, toFloor, toDaily, room, rule: toDaily < toFloor ? 'daily loss limit' : 'max drawdown' };
}

export function pointValue(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/^[A-Z_]+:/, '');
  return POINT_VALUES.find(([re]) => re.test(s))?.[1] ?? 1;
}

// Random account names ("Crimson Falcon") and a picture seed
const ADJECTIVES = ['Crimson', 'Silent', 'Golden', 'Midnight', 'Rapid', 'Iron', 'Lunar', 'Electric', 'Shadow', 'Arctic', 'Blazing', 'Cosmic', 'Feral', 'Hidden', 'Jade', 'Noble', 'Obsidian', 'Phantom', 'Quantum', 'Royal', 'Scarlet', 'Solar', 'Stormy', 'Swift', 'Velvet', 'Wild', 'Amber', 'Cobalt', 'Emerald', 'Frozen'];
const NOUNS = ['Falcon', 'Tiger', 'Viper', 'Wolf', 'Raven', 'Panther', 'Hawk', 'Cobra', 'Lynx', 'Phoenix', 'Shark', 'Bison', 'Fox', 'Orca', 'Jaguar', 'Mantis', 'Stallion', 'Kraken', 'Dragon', 'Owl', 'Rhino', 'Scorpion', 'Badger', 'Eagle', 'Grizzly', 'Hornet', 'Leopard', 'Marlin', 'Puma', 'Yeti'];
export function randomName(rand = Math.random) {
  return `${ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)]} ${NOUNS[Math.floor(rand() * NOUNS.length)]}`;
}
export const randomSeed = (rand = Math.random) => Math.floor(rand() * 2 ** 31).toString(36);

// Date of a moment in a time zone (the account's trading day: New York for Lucid, Prague for FTMO)
export function dayIn(ms, zone = 'America/New_York') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const nyDay = (ms) => dayIn(ms, 'America/New_York');

// An account after a closed trade: balance, trailing max-loss floor (moved at each new day), daily loss, XP,
// passed / failed (and why)
export function applyClose(acc, pnl, xp, day) {
  const start = Number(acc.start_balance) || 0;
  let { balance = start, peak_eod: peak = start, floor, day_key: dayKey, day_start: dayStart } = acc;
  const maxLoss = Number(acc.max_loss) || 0, target = Number(acc.target) || 0, dailyLoss = Number(acc.daily_loss) || 0;
  if (floor == null) floor = maxLoss ? start - maxLoss : null;
  if (dayKey !== day) {
    if (dayKey && maxLoss && acc.trailing) {
      peak = Math.max(peak, balance);
      floor = Math.min(peak - maxLoss, start + 100);
    }
    dayStart = balance;
  }
  if (dayStart == null) dayStart = balance;
  balance += pnl;
  let status = acc.status || 'active', reason = acc.status_reason || '';
  if (maxLoss && balance <= floor) { status = 'failed'; reason = 'max loss'; }
  else if (dailyLoss && balance - dayStart <= -dailyLoss) { status = 'failed'; reason = 'daily loss'; }
  else if (target && balance >= start + target) { status = 'passed'; reason = 'target'; }
  return { balance, peak_eod: peak, floor, day_key: day, day_start: dayStart, xp: (Number(acc.xp) || 0) + xp, status, status_reason: reason };
}

// Evaluation of closed copied trades: win rate, profit factor, expectancy, drawdown, best / worst, average hold
export function evaluate(trades) {
  const closed = trades.filter((t) => t.status === 'closed').sort((a, b) => String(a.closed_at).localeCompare(String(b.closed_at)));
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0);
  const gross = wins.reduce((s, t) => s + t.pnl, 0), lost = losses.reduce((s, t) => s + t.pnl, 0);
  let equity = 0, peak = 0, maxDd = 0;
  for (const t of closed) { equity += t.pnl; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity); }
  const holds = closed.map((t) => (Date.parse(t.closed_at) - Date.parse(t.opened_at)) / 60000).filter((m) => Number.isFinite(m) && m >= 0);
  const reasons = {};
  for (const t of closed) reasons[t.reason || 'signal'] = (reasons[t.reason || 'signal'] || 0) + 1;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    trades: closed.length, open: trades.length - closed.length, wins: wins.length, losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    net: r2(gross + lost), grossProfit: r2(gross), grossLoss: r2(lost),
    avgWin: wins.length ? r2(gross / wins.length) : 0, avgLoss: losses.length ? r2(lost / losses.length) : 0,
    profitFactor: lost ? gross / -lost : gross > 0 ? Infinity : 0,
    expectancy: closed.length ? r2((gross + lost) / closed.length) : 0,
    maxDrawdown: r2(maxDd),
    best: closed.length ? Math.max(...closed.map((t) => t.pnl)) : 0, worst: closed.length ? Math.min(...closed.map((t) => t.pnl)) : 0,
    avgHoldMin: holds.length ? Math.round(holds.reduce((s, m) => s + m, 0) / holds.length) : 0,
    longs: closed.filter((t) => t.side === 'long').length, shorts: closed.filter((t) => t.side === 'short').length,
    xp: closed.reduce((s, t) => s + (t.xp || 0), 0), reasons,
  };
}
