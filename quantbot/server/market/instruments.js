// The markets QuantBot downloads itself. Start dates are when Dukascopy's history begins for each data type.
// point and contract_size match FTMO's MT5 symbols (spread is measured in points).
export const INSTRUMENTS = {
  XAUUSD: {
    symbol: 'XAUUSD', code: 'XAU-USD', name: 'Gold vs US Dollar', point: 0.01, contract_size: 100,
    minuteStart: '2003-05-05', hourStart: '2003-05-05', dayStart: '1999-06-03',
  },
  US100: {
    symbol: 'US100', code: 'USATECH.IDX-USD', name: 'US 100 Tech Index', point: 0.01, contract_size: 1,
    minuteStart: '2011-09-18', hourStart: '2011-09-18', dayStart: '1990-11-07',
  },
  // Nasdaq-100 E-mini futures: the same Nasdaq-100 prices as US100 (Dukascopy has no CME data), on NQ's contract:
  // 0.25 tick, $20 per point, and a 1-tick spread like the futures order book instead of the CFD spread
  NQ: {
    symbol: 'NQ', code: 'USATECH.IDX-USD', name: 'Nasdaq 100 futures (NQ)', point: 0.25, contract_size: 20, spreadPoints: 1,
    minuteStart: '2011-09-18', hourStart: '2011-09-18', dayStart: '1990-11-07',
  },
};

export const TIMEFRAMES = {
  M1: { minutes: 1, source: 'minute' },
  M5: { minutes: 5, source: 'minute' },
  M15: { minutes: 15, source: 'minute' },
  M30: { minutes: 30, source: 'minute' },
  H1: { minutes: 60, source: 'hour' },
  H4: { minutes: 240, source: 'hour' },
  D1: { minutes: 1440, source: 'hour' },
};

// Longest range one test may load per timeframe (M1 over 20 years is too much for a browser)
export const MAX_RANGE_DAYS = { M1: 370 };

export function instrument(symbol) {
  const inst = INSTRUMENTS[String(symbol).toUpperCase()];
  if (!inst) throw new Error(`Unknown market ${symbol}`);
  return inst;
}

export function timeframe(tf) {
  const t = TIMEFRAMES[String(tf).toUpperCase()];
  if (!t) throw new Error(`Unknown timeframe ${tf}`);
  return t;
}

// First date a timeframe has data for (D1 reaches further back through Dukascopy's daily bars)
export const firstDate = (inst, tf) => (tf === 'D1' ? inst.dayStart : timeframe(tf).source === 'hour' ? inst.hourStart : inst.minuteStart);
