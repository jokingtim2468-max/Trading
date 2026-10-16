// Trading accounts: MetaTrader 5, and futures accounts on CQG prop platforms (Tradovate, and TradingView, which
// trades through a Tradovate login). Futures accounts copy each other with Tradovate's Group Trade.
export const PLATFORMS = [
  { id: 'MT5', title: 'MetaTrader 5', short: 'MT5', family: 'MT5' },
  { id: 'Tradovate', title: 'Tradovate', short: 'Tradovate', family: 'Futures' },
  { id: 'TradingView', title: 'TradingView', short: 'TradingView', family: 'Futures' },
];
export const platformOf = (id) => PLATFORMS.find((p) => p.id === id) || PLATFORMS[1];
// Groups hold accounts of one family: MT5 with MT5, futures (Tradovate / TradingView) together
export const familyOf = (platform) => (platform === 'MT5' ? 'MT5' : 'Futures');
export const groupFamily = (g) => (g.platform === 'MT5' ? 'MT5' : 'Futures');
export const FAMILIES = { MT5: 'MetaTrader 5', Futures: 'Futures (Tradovate / TradingView)' };

// Suggestions only; any server name your broker gives you works
export const MT5_SERVERS = ['MetaQuotes-Demo', 'ICMarketsSC-Demo', 'ICMarketsSC-MT5', 'FTMO-Demo', 'FTMO-Server'];

export const TRADOVATE_SERVERS = [
  { id: 'demo', label: 'Demo (prop and evaluation accounts)' },
  { id: 'live', label: 'Live' },
];

// Prop firms whose account names have a recognisable start (shown as a hint, never required)
const FIRM_PREFIXES = [
  [/^(LT|LFE|LUC)/i, 'Lucid Trading'], [/^(APEX|PA-APEX)/i, 'Apex Trader Funding'], [/^(TPT|TPTX)/i, 'Take Profit Trader'],
  [/^(MFFU|MFF)/i, 'MyFundedFutures'], [/^(ETF)/i, 'Elite Trader Funding'], [/^(TDY|TRADEDAY)/i, 'TradeDay'], [/^(TS|TOPSTEP)/i, 'Topstep'],
];

// Guesses the platform from what was typed: MT5 logins are plain numbers on a broker server, Tradovate accounts are
// names with letters (LTT04821, DEMO123456). TradingView accounts look exactly like Tradovate ones (they are
// Tradovate accounts), so pick TradingView by hand when you trade them there.
// -> { platform, firm, reason } or null when there's nothing to go on
export function detectPlatform({ login = '', server = '' } = {}) {
  const id = String(login).trim();
  if (!id && !String(server).trim()) return null;
  if (String(server).trim() || /^\d{4,12}$/.test(id)) {
    return { platform: 'MT5', firm: '', reason: String(server).trim() ? 'it has an MT5 server' : 'MT5 logins are numbers' };
  }
  if (/[a-z]/i.test(id)) {
    const firm = FIRM_PREFIXES.find(([re]) => re.test(id))?.[1] || '';
    return { platform: 'Tradovate', firm, reason: `${firm ? `${firm} account names` : 'Futures account names'} have letters` };
  }
  return null;
}

// Sorting for the account list
export const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'platform', label: 'Platform' },
  { id: 'group', label: 'Group' },
  { id: 'newest', label: 'Newest first' },
  { id: 'rank', label: 'Rank' },
];
export function sortAccounts(list, sort, groups = []) {
  const groupName = (a) => groups.find((g) => g.id === a.group_id)?.name || '~';
  const by = {
    name: (a, b) => a.label.localeCompare(b.label),
    platform: (a, b) => a.platform.localeCompare(b.platform) || a.label.localeCompare(b.label),
    group: (a, b) => groupName(a).localeCompare(groupName(b)) || a.label.localeCompare(b.label),
    newest: (a, b) => String(b.created_date).localeCompare(String(a.created_date)),
    rank: (a, b) => (Number(b.xp) || 0) - (Number(a.xp) || 0) || a.label.localeCompare(b.label),
  }[sort] || (() => 0);
  return [...list].sort(by);
}

// Members of a group in copy order: the lead first, then the rest by name
export function groupMembers(group, accounts) {
  const members = accounts.filter((a) => a.group_id === group.id);
  const lead = members.find((a) => a.id === group.lead_account_id) || members[0];
  return lead ? [lead, ...members.filter((a) => a !== lead).sort((a, b) => a.label.localeCompare(b.label))] : [];
}
