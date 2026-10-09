// Settings schema. The "MT5" tab mirrors MetaTrader 5's Tools > Options
// dialog (Server, Charts, Trade, Expert Advisors, Notifications, Email, FTP,
// Events, Community, Signals) plus per-chart F8 Properties.
export const SETTINGS_SCHEMA = {
  'Chart (TradingView)': {
    theme: { label: 'Theme', type: 'select', options: ['TradingView Dark', 'Midnight Galaxy'], def: 'TradingView Dark' },
    chartType: { label: 'Chart type', type: 'select', options: ['Candles', 'Hollow candles', 'Bars', 'Line', 'Area', 'Baseline', 'Heikin Ashi'], def: 'Candles' },
    upColor: { label: 'Body up color', type: 'color', def: '#089981' },
    downColor: { label: 'Body down color', type: 'color', def: '#F23645' },
    background: { label: 'Background', type: 'color', def: '#131722' },
    gridColor: { label: 'Grid lines', type: 'color', def: '#1E222D' },
    textColor: { label: 'Scales text', type: 'color', def: '#B2B5BE' },
    crosshair: { label: 'Crosshair mode', type: 'select', options: ['Normal', 'Magnet'], def: 'Normal' },
    showVolume: { label: 'Show volume', type: 'bool', def: true },
    logScale: { label: 'Logarithmic scale', type: 'bool', def: false },
    timezone: { label: 'Timezone', type: 'select', options: ['Exchange', 'UTC', 'Local'], def: 'Local' },
  },
  'MT5: Server': {
    server: { label: 'Trade server', type: 'text', def: '' },
    login: { label: 'Login', type: 'text', def: '' },
    password: { label: 'Password (sent only to local bridge)', type: 'password', def: '' },
    savePassword: { label: 'Save password', type: 'bool', def: false },
    terminalPath: { label: 'terminal64.exe path', type: 'text', def: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe' },
    bridgeUrl: { label: 'Bridge URL', type: 'text', def: 'http://127.0.0.1:8765' },
    enableProxy: { label: 'Enable proxy server', type: 'bool', def: false },
    proxyServer: { label: 'Proxy server', type: 'text', def: '' },
    enableNews: { label: 'Enable news', type: 'bool', def: true },
  },
  'MT5: Charts': {
    showTradeLevels: { label: 'Show trade levels', type: 'bool', def: true },
    dragTradeLevels: { label: 'Drag trade levels', type: 'bool', def: true },
    showTradeHistory: { label: 'Show trade history', type: 'bool', def: true },
    showAskLine: { label: 'Show Ask line', type: 'bool', def: true },
    showBidLine: { label: 'Show Bid line', type: 'bool', def: true },
    showLastLine: { label: 'Show Last line', type: 'bool', def: false },
    showPeriodSeparators: { label: 'Show period separators', type: 'bool', def: false },
    showOHLC: { label: 'Show OHLC', type: 'bool', def: true },
    autoScroll: { label: 'Chart autoscroll', type: 'bool', def: true },
    chartShift: { label: 'Chart shift', type: 'bool', def: true },
    maxBars: { label: 'Max bars in chart', type: 'select', options: ['1000', '5000', '10000', '50000', '100000', 'Unlimited'], def: '5000' },
    colorScheme: { label: 'MT5 color scheme', type: 'select', options: ['Black On White', 'Green On Black', 'Color On Black', 'Custom (TradingView)'], def: 'Custom (TradingView)' },
  },
  'MT5: Trade': {
    defaultVolume: { label: 'Default volume (lots)', type: 'number', def: 0.01, step: 0.01 },
    volumeMode: { label: 'Volume mode', type: 'select', options: ['Default', 'Last used'], def: 'Last used' },
    deviation: { label: 'Max deviation (points)', type: 'number', def: 20 },
    fillingMode: { label: 'Filling', type: 'select', options: ['Fill or Kill', 'Immediate or Cancel', 'Return'], def: 'Immediate or Cancel' },
    oneClickTrading: { label: 'One Click Trading', type: 'bool', def: false },
    defaultSL: { label: 'Default Stop Loss (points, 0 = none)', type: 'number', def: 0 },
    defaultTP: { label: 'Default Take Profit (points, 0 = none)', type: 'number', def: 0 },
    magic: { label: 'Manual magic number', type: 'number', def: 0 },
  },
  'MT5: Expert Advisors': {
    allowAlgoTrading: { label: 'Allow algorithmic trading', type: 'bool', def: false },
    disableOnAccountChange: { label: 'Disable algo trading when the account has been changed', type: 'bool', def: true },
    disableOnProfileChange: { label: 'Disable algo trading when the profile has been changed', type: 'bool', def: true },
    disableOnSymbolChange: { label: 'Disable algo trading when charts symbol or period has been changed', type: 'bool', def: true },
    disableViaPython: { label: 'Disable algo trading when trading via external Python API', type: 'bool', def: false },
    allowDll: { label: 'Allow DLL imports (potentially dangerous)', type: 'bool', def: false },
    allowWebRequest: { label: 'Allow WebRequest for listed URL', type: 'bool', def: false },
    webRequestUrls: { label: 'WebRequest URLs (comma separated)', type: 'text', def: '' },
  },
  'MT5: Notifications': {
    enablePush: { label: 'Enable push notifications', type: 'bool', def: false },
    metaQuotesId: { label: 'MetaQuotes ID', type: 'text', def: '' },
    notifyTrades: { label: 'Notify of trade transactions', type: 'bool', def: true },
  },
  'MT5: Email': {
    enableEmail: { label: 'Enable', type: 'bool', def: false },
    smtpServer: { label: 'SMTP server', type: 'text', def: '' },
    smtpLogin: { label: 'SMTP login', type: 'text', def: '' },
    emailFrom: { label: 'From', type: 'text', def: '' },
    emailTo: { label: 'To', type: 'text', def: '' },
  },
  'MT5: FTP': {
    enableFtp: { label: 'Enable automatic publishing of reports via FTP', type: 'bool', def: false },
    ftpServer: { label: 'FTP server', type: 'text', def: '' },
    ftpPath: { label: 'FTP path', type: 'text', def: '' },
    ftpPassive: { label: 'Passive mode', type: 'bool', def: true },
    ftpEvery: { label: 'Refresh every (minutes)', type: 'number', def: 60 },
  },
  'MT5: Events': {
    enableSounds: { label: 'Enable sound events', type: 'bool', def: true },
    soundConnect: { label: 'Connect / Disconnect', type: 'bool', def: true },
    soundOrder: { label: 'Order filled', type: 'bool', def: true },
    soundAlert: { label: 'Alert', type: 'bool', def: true },
  },
  'MT5: Community': {
    mql5Login: { label: 'MQL5.community login', type: 'text', def: '' },
  },
  'MT5: Signals': {
    enableSignals: { label: 'Enable real-time signal subscription', type: 'bool', def: false },
    copyStopLevels: { label: 'Copy Stop Loss and Take Profit levels', type: 'bool', def: true },
    useEquityPct: { label: 'Use no more than (% of deposit)', type: 'number', def: 95 },
    maxSlippage: { label: 'Max slippage (spreads)', type: 'number', def: 0.5, step: 0.5 },
  },
};

const KEY = 'mt5tv.settings';
export function loadSettings() {
  const out = {};
  for (const sec of Object.values(SETTINGS_SCHEMA)) for (const [k, f] of Object.entries(sec)) out[k] = f.def;
  try { Object.assign(out, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
  return out;
}
export function saveSettings(s) {
  const copy = { ...s };
  if (!copy.savePassword) copy.password = '';
  try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch { /* ignore */ }
}

// App themes: UI chrome colors (CSS variables) plus the chart colors they
// reset when picked. Candle up/down stay green/red for readability.
export const THEMES = {
  'TradingView Dark': {
    css: { bg: '#131722', panel: '#1E222D', border: '#2A2E39', text: '#D1D4DC', muted: '#787B86', accent: '#2962FF', accentText: '#FFFFFF' },
    chart: { background: '#131722', gridColor: '#1E222D', textColor: '#B2B5BE', upColor: '#089981', downColor: '#F23645' },
  },
  'Midnight Galaxy': {
    css: { bg: '#1A1226', panel: '#2B1E3E', border: '#3A2D55', text: '#E6E6FA', muted: '#A490C2', accent: '#A490C2', accentText: '#1A1226' },
    chart: { background: '#1A1226', gridColor: '#251A36', textColor: '#C9C0E0', upColor: '#26A69A', downColor: '#EF5350' },
  },
};

export function applyThemeCss(name) {
  const t = THEMES[name] || THEMES['TradingView Dark'];
  const r = document.documentElement.style;
  r.setProperty('--bg', t.css.bg);
  r.setProperty('--panel', t.css.panel);
  r.setProperty('--border', t.css.border);
  r.setProperty('--text', t.css.text);
  r.setProperty('--muted', t.css.muted);
  r.setProperty('--accent', t.css.accent);
  r.setProperty('--accent-text', t.css.accentText);
}
