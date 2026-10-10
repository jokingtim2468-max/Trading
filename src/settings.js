// Settings that actually drive the app. MT5 terminal options (Expert
// Advisors, Notifications, Email, FTP...) can't be changed by an outside
// program, so they are shown read-only from the live terminal instead
// (Settings → MT5: Terminal) rather than as dead toggles.
export const SETTINGS_SCHEMA = {
  Appearance: {
    theme: { label: 'Color scheme', type: 'select', options: [], def: 'TradingView Dark' },
    chartType: { label: 'Chart type', type: 'select', options: ['Candles', 'Hollow candles', 'Bars', 'Line', 'Area', 'Baseline', 'Heikin Ashi'], def: 'Candles' },
    upColor: { label: 'Bull body', type: 'color', def: '#089981' },
    downColor: { label: 'Bear body', type: 'color', def: '#F23645' },
    upBorder: { label: 'Bull border / wick', type: 'color', def: '#089981' },
    downBorder: { label: 'Bear border / wick', type: 'color', def: '#F23645' },
    background: { label: 'Background', type: 'color', def: '#131722' },
    gridColor: { label: 'Grid lines', type: 'color', def: '#1E222D' },
    textColor: { label: 'Scales text', type: 'color', def: '#B2B5BE' },
    crosshair: { label: 'Crosshair', type: 'select', options: ['Normal', 'Magnet'], def: 'Normal' },
    showVolume: { label: 'Volume', type: 'bool', def: true },
    logScale: { label: 'Logarithmic price scale', type: 'bool', def: false },
    timezone: { label: 'Time zone', type: 'select', options: ['Local', 'UTC'], def: 'Local' },
  },
  'MT5: Charts': {
    showAskLine: { label: 'Show Ask line', type: 'bool', def: true },
    showBidLine: { label: 'Show Bid line', type: 'bool', def: true },
    showPeriodSeparators: { label: 'Show period separators', type: 'bool', def: false },
    showOHLC: { label: 'Show OHLC', type: 'bool', def: true },
    autoScroll: { label: 'Chart autoscroll', type: 'bool', def: true },
    chartShift: { label: 'Chart shift', type: 'bool', def: true },
    maxBars: { label: 'Max bars in chart', type: 'select', options: ['1000', '2000', '5000', '10000'], def: '2000' },
  },
  'MT5: Server': {
    bridgeUrl: { label: 'Bridge URL', type: 'text', def: 'http://127.0.0.1:8765' },
    server: { label: 'Trade server (data account)', type: 'text', def: '' },
    login: { label: 'Login', type: 'text', def: '' },
    password: { label: 'Password (sent only to the local bridge)', type: 'password', def: '' },
    savePassword: { label: 'Remember password on this PC', type: 'bool', def: false },
    terminalPath: { label: 'terminal64.exe path', type: 'text', def: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe' },
  },
  Trading: {
    tvPrefix: { label: 'TradingView broker prefix (e.g. FTMO)', type: 'text', def: '' },
    showTradeWidget: { label: 'Show SELL / BUY panel on charts', type: 'bool', def: true },
  },
};

// Color schemes. TradingView's own two plus MT5's three built-in schemes
// (F8 → Colors) and Midnight Galaxy.
export const THEMES = {
  'TradingView Dark': {
    css: { bg: '#131722', panel: '#1E222D', border: '#2A2E39', hover: '#2A2E39', text: '#D1D4DC', muted: '#787B86', accent: '#2962FF', accentText: '#FFFFFF', font: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif' },
    chart: { background: '#131722', gridColor: '#1E222D', textColor: '#B2B5BE', upColor: '#089981', downColor: '#F23645', upBorder: '#089981', downBorder: '#F23645' },
  },
  'TradingView Light': {
    css: { bg: '#FFFFFF', panel: '#F0F3FA', border: '#E0E3EB', hover: '#F0F3FA', text: '#131722', muted: '#6A6D78', accent: '#2962FF', accentText: '#FFFFFF', font: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif' },
    chart: { background: '#FFFFFF', gridColor: '#F0F3FA', textColor: '#131722', upColor: '#089981', downColor: '#F23645', upBorder: '#089981', downBorder: '#F23645' },
  },
  'MT5 Green On Black': {
    css: { bg: '#000000', panel: '#0E0E0E', border: '#2E3A3A', hover: '#1A2424', text: '#FFFFFF', muted: '#8FA3A3', accent: '#00C000', accentText: '#000000', font: 'Tahoma, Verdana, sans-serif' },
    chart: { background: '#000000', gridColor: '#1C2A2A', textColor: '#FFFFFF', upColor: '#000000', downColor: '#FFFFFF', upBorder: '#00FF00', downBorder: '#00FF00' },
  },
  'MT5 Color On Black': {
    css: { bg: '#000000', panel: '#0E0E0E', border: '#333333', hover: '#1C1C1C', text: '#FFFFFF', muted: '#9A9A9A', accent: '#1E90FF', accentText: '#FFFFFF', font: 'Tahoma, Verdana, sans-serif' },
    chart: { background: '#000000', gridColor: '#1F1F1F', textColor: '#FFFFFF', upColor: '#00B050', downColor: '#E8262F', upBorder: '#00B050', downBorder: '#E8262F' },
  },
  'MT5 Black On White': {
    css: { bg: '#FFFFFF', panel: '#F2F2F2', border: '#C8C8C8', hover: '#E6E6E6', text: '#000000', muted: '#606060', accent: '#0A5FD6', accentText: '#FFFFFF', font: 'Tahoma, Verdana, sans-serif' },
    chart: { background: '#FFFFFF', gridColor: '#E4E4E4', textColor: '#000000', upColor: '#FFFFFF', downColor: '#000000', upBorder: '#000000', downBorder: '#000000' },
  },
  'Midnight Galaxy': {
    css: { bg: '#1A1226', panel: '#2B1E3E', border: '#3A2D55', hover: '#3A2D55', text: '#E6E6FA', muted: '#A490C2', accent: '#A490C2', accentText: '#1A1226', font: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif' },
    chart: { background: '#1A1226', gridColor: '#251A36', textColor: '#C9C0E0', upColor: '#26A69A', downColor: '#EF5350', upBorder: '#26A69A', downBorder: '#EF5350' },
  },
};
SETTINGS_SCHEMA.Appearance.theme.options = Object.keys(THEMES);

export function applyThemeCss(name) {
  const t = (THEMES[name] || THEMES['TradingView Dark']).css;
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) r.setProperty(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`, v);
}

const KEY = 'mt5tv.settings';
export function loadSettings() {
  const out = {};
  for (const sec of Object.values(SETTINGS_SCHEMA)) for (const [k, f] of Object.entries(sec)) out[k] = f.def;
  try { Object.assign(out, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
  if (!THEMES[out.theme]) out.theme = 'TradingView Dark';
  return out;
}
export function saveSettings(s) {
  const copy = { ...s };
  if (!copy.savePassword) copy.password = '';
  try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch { /* ignore */ }
}
