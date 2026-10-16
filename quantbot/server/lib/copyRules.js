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
// Lucid's max loss trails the best end-of-day balance and locks at the start + $100.
export const PLANS = {
  none: { label: 'Just track it', start: 50000, target: null, maxLoss: null, trailing: false },
  lucid25: { label: 'LucidPro 25K', start: 25000, target: 1250, maxLoss: 1000, trailing: true },
  lucid50: { label: 'LucidPro 50K', start: 50000, target: 3000, maxLoss: 2000, trailing: true },
  lucid100: { label: 'LucidPro 100K', start: 100000, target: 6000, maxLoss: 3000, trailing: true },
  lucid150: { label: 'LucidPro 150K', start: 150000, target: 9000, maxLoss: 4500, trailing: true },
  custom: { label: 'Custom', start: 10000, target: 1000, maxLoss: 500, trailing: false },
};

// Dollars per 1.0 price move for one contract / lot, from the symbol (TradingView tickers like MGC1!, COMEX:GC1!)
const POINT_VALUES = [
  [/^MGC/, 10], [/^GC/, 100], [/^MNQ/, 2], [/^NQ/, 20], [/^MES/, 5], [/^ES/, 50], [/^MYM/, 0.5], [/^YM/, 5],
  [/^M2K/, 5], [/^RTY/, 50], [/^MCL/, 100], [/^CL/, 1000], [/^(XAUUSD|GOLD)/, 100], [/^(US100|NAS100|USTEC|NDX)/, 1],
];
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

// New York date of a moment (the trading day)
export const nyDay = (ms) => {
  const d = new Date(ms);
  const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return `${ny.getFullYear()}-${String(ny.getMonth() + 1).padStart(2, '0')}-${String(ny.getDate()).padStart(2, '0')}`;
};

// An account after a closed trade: balance, trailing max-loss floor (moved at each new day), XP, passed / failed
export function applyClose(acc, pnl, xp, day) {
  const start = Number(acc.start_balance) || 0;
  let { balance = start, peak_eod: peak = start, floor, day_key: dayKey } = acc;
  const maxLoss = Number(acc.max_loss) || 0, target = Number(acc.target) || 0;
  if (floor == null) floor = maxLoss ? start - maxLoss : null;
  if (dayKey && dayKey !== day && maxLoss && acc.trailing) {
    peak = Math.max(peak, balance);
    floor = Math.min(peak - maxLoss, start + 100);
  }
  balance += pnl;
  const status = maxLoss && balance <= floor ? 'failed' : target && balance >= start + target ? 'passed' : (acc.status || 'active');
  return { balance, peak_eod: peak, floor, day_key: day, xp: (Number(acc.xp) || 0) + xp, status };
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
