export const PLATFORMS = [
  { id: 'MT5', title: 'MetaTrader 5', subtitle: 'Logs in through MT5 terminals on this PC' },
  { id: 'Tradovate', title: 'TradingView + Tradovate', subtitle: 'The futures accounts TradingView trades through' },
];

// Suggestions only; any server name your broker gives you works
export const MT5_SERVERS = ['MetaQuotes-Demo', 'ICMarketsSC-Demo', 'ICMarketsSC-MT5', 'FTMO-Demo', 'FTMO-Server'];

export const TRADOVATE_SERVERS = [
  { id: 'demo', label: 'Demo (demo.tradovateapi.com)' },
  { id: 'live', label: 'Live (live.tradovateapi.com)' },
];

const FIELDS = ['id', 'platform', 'label', 'login', 'server', 'terminal_path', 'chart_symbol', 'environment', 'account_spec', 'group_id'];

// What the desktop copier needs to know (never passwords)
export const copierAccount = (a) => Object.fromEntries(FIELDS.map((k) => [k, a[k] ?? '']));
export const copierGroup = (g) => ({ id: g.id, name: g.name, platform: g.platform, enabled: g.enabled !== false });