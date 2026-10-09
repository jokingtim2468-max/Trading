// Default MT5 symbol universe (standard Market Watch names). When the MT5
// bridge is connected, the live broker symbol list replaces this one.
export const MT5_SYMBOLS = [
  { name: 'XAUUSD', desc: 'Gold vs US Dollar', group: 'Metals', digits: 2, base: 2650 },
  { name: 'XAGUSD', desc: 'Silver vs US Dollar', group: 'Metals', digits: 3, base: 31 },
  { name: 'XPTUSD', desc: 'Platinum vs US Dollar', group: 'Metals', digits: 2, base: 980 },
  { name: 'XPDUSD', desc: 'Palladium vs US Dollar', group: 'Metals', digits: 2, base: 1050 },
  { name: 'EURUSD', desc: 'Euro vs US Dollar', group: 'Forex Majors', digits: 5, base: 1.09 },
  { name: 'GBPUSD', desc: 'Great Britain Pound vs US Dollar', group: 'Forex Majors', digits: 5, base: 1.30 },
  { name: 'USDJPY', desc: 'US Dollar vs Japanese Yen', group: 'Forex Majors', digits: 3, base: 149 },
  { name: 'USDCHF', desc: 'US Dollar vs Swiss Franc', group: 'Forex Majors', digits: 5, base: 0.86 },
  { name: 'AUDUSD', desc: 'Australian Dollar vs US Dollar', group: 'Forex Majors', digits: 5, base: 0.67 },
  { name: 'USDCAD', desc: 'US Dollar vs Canadian Dollar', group: 'Forex Majors', digits: 5, base: 1.37 },
  { name: 'NZDUSD', desc: 'New Zealand Dollar vs US Dollar', group: 'Forex Majors', digits: 5, base: 0.61 },
  { name: 'EURGBP', desc: 'Euro vs Great Britain Pound', group: 'Forex Crosses', digits: 5, base: 0.84 },
  { name: 'EURJPY', desc: 'Euro vs Japanese Yen', group: 'Forex Crosses', digits: 3, base: 162 },
  { name: 'GBPJPY', desc: 'Great Britain Pound vs Japanese Yen', group: 'Forex Crosses', digits: 3, base: 194 },
  { name: 'AUDJPY', desc: 'Australian Dollar vs Japanese Yen', group: 'Forex Crosses', digits: 3, base: 99 },
  { name: 'EURAUD', desc: 'Euro vs Australian Dollar', group: 'Forex Crosses', digits: 5, base: 1.62 },
  { name: 'EURCHF', desc: 'Euro vs Swiss Franc', group: 'Forex Crosses', digits: 5, base: 0.94 },
  { name: 'GBPCHF', desc: 'Great Britain Pound vs Swiss Franc', group: 'Forex Crosses', digits: 5, base: 1.12 },
  { name: 'CADJPY', desc: 'Canadian Dollar vs Japanese Yen', group: 'Forex Crosses', digits: 3, base: 109 },
  { name: 'USDSEK', desc: 'US Dollar vs Swedish Krona', group: 'Forex Exotics', digits: 5, base: 10.4 },
  { name: 'USDNOK', desc: 'US Dollar vs Norwegian Krone', group: 'Forex Exotics', digits: 5, base: 10.7 },
  { name: 'USDMXN', desc: 'US Dollar vs Mexican Peso', group: 'Forex Exotics', digits: 5, base: 19.5 },
  { name: 'USDZAR', desc: 'US Dollar vs South African Rand', group: 'Forex Exotics', digits: 5, base: 17.6 },
  { name: 'USDTRY', desc: 'US Dollar vs Turkish Lira', group: 'Forex Exotics', digits: 5, base: 34.2 },
  { name: 'US30', desc: 'Dow Jones Industrial Average', group: 'Indices', digits: 1, base: 42000 },
  { name: 'US500', desc: 'S&P 500 Index', group: 'Indices', digits: 1, base: 5750 },
  { name: 'NAS100', desc: 'Nasdaq 100 Index', group: 'Indices', digits: 1, base: 20100 },
  { name: 'GER40', desc: 'DAX 40 Index', group: 'Indices', digits: 1, base: 19200 },
  { name: 'UK100', desc: 'FTSE 100 Index', group: 'Indices', digits: 1, base: 8250 },
  { name: 'JP225', desc: 'Nikkei 225 Index', group: 'Indices', digits: 0, base: 38500 },
  { name: 'USOIL', desc: 'WTI Crude Oil', group: 'Energies', digits: 2, base: 73 },
  { name: 'UKOIL', desc: 'Brent Crude Oil', group: 'Energies', digits: 2, base: 77 },
  { name: 'XNGUSD', desc: 'Natural Gas', group: 'Energies', digits: 3, base: 2.7 },
  { name: 'BTCUSD', desc: 'Bitcoin vs US Dollar', group: 'Crypto', digits: 2, base: 62000 },
  { name: 'ETHUSD', desc: 'Ethereum vs US Dollar', group: 'Crypto', digits: 2, base: 2450 },
  { name: 'LTCUSD', desc: 'Litecoin vs US Dollar', group: 'Crypto', digits: 2, base: 65 },
  { name: 'XRPUSD', desc: 'Ripple vs US Dollar', group: 'Crypto', digits: 5, base: 0.53 },
];

// MT5 timeframes (all 21) in TradingView-style toolbar labels.
export const TIMEFRAMES = [
  ['M1', 60], ['M2', 120], ['M3', 180], ['M4', 240], ['M5', 300], ['M6', 360],
  ['M10', 600], ['M12', 720], ['M15', 900], ['M20', 1200], ['M30', 1800],
  ['H1', 3600], ['H2', 7200], ['H3', 10800], ['H4', 14400], ['H6', 21600],
  ['H8', 28800], ['H12', 43200], ['D1', 86400], ['W1', 604800], ['MN1', 2592000],
];

export const DEFAULT_FAVORITES = ['XAUUSD'];
