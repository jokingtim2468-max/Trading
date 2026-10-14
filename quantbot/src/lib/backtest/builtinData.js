// Candle files shipped inside the app; preselected for every bot / script test
const raw = {
  XAUUSD: () => import('@/data/candles/XAUUSD_M15.csv?raw'),
  US100: () => import('@/data/candles/US100.csv?raw'),
  NQ: () => import('@/data/candles/NQ.csv?raw'),
};

export const BUILTIN_DATASETS = [
  { id: 'builtin-XAUUSD', builtin: true, symbol: 'XAUUSD', timeframe: 'M15', source: 'MT5', contract_size: 100, point: 0.01, start: '2026-01-02', end: '2026-10-01' },
  { id: 'builtin-US100', builtin: true, symbol: 'US100', timeframe: 'MN1', source: 'TradingView', contract_size: 1, point: 0.1, start: '2019-01-01', end: '2026-10-01' },
  { id: 'builtin-NQ', builtin: true, symbol: 'NQ', timeframe: 'MN1', source: 'TradingView', contract_size: 20, point: 0.25, start: '1999-06-01', end: '2026-10-01' },
];

export const DEFAULT_DATASET_IDS = BUILTIN_DATASETS.map((d) => d.id);

export async function loadBuiltinText(ds) {
  return (await raw[ds.symbol]()).default;
}