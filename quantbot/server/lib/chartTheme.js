// The Terminal chart's look: one settings object, its presets, and the check every change (preset, the AI chart
// editor, a hand edit) goes through. Shared by the server (stores versions) and the page (draws the chart).
const DARK = {
  background: '#131722', grid: '#1e222d', text: '#b2b5be', up: '#089981', down: '#f23645',
  wickUp: '', wickDown: '', hollow: false, crosshair: '#787b86', prediction: '#e8c468', showGrid: true, showPrediction: true,
};
// The default look: gray background with white rising and black falling candles
export const DEFAULT_CHART = {
  ...DARK, background: '#2f3033', grid: '#3a3b3f', text: '#d1d4dc', up: '#ffffff', down: '#0b0b0c',
  wickUp: '#e0e0e0', wickDown: '#0b0b0c', crosshair: '#9598a1',
};

export const CHART_PRESETS = [
  { id: 'graybw', name: 'Gray · B&W candles', settings: { ...DEFAULT_CHART } },
  { id: 'dark', name: 'Dark', settings: { ...DARK } },
  { id: 'black', name: 'Black background', settings: { ...DARK, background: '#000000', grid: '#141414' } },
  { id: 'gray', name: 'Gray background', settings: { ...DARK, background: '#2f3033', grid: '#3a3b3f', text: '#d1d4dc' } },
  { id: 'bw', name: 'Black & white candles', settings: { ...DARK, background: '#000000', grid: '#161616', up: '#ffffff', down: '#4a4a4a', wickUp: '#d9d9d9', wickDown: '#8a8a8a' } },
  { id: 'light', name: 'Light', settings: { ...DARK, background: '#ffffff', grid: '#f0f3fa', text: '#131722', up: '#089981', down: '#f23645', crosshair: '#9598a1' } },
  { id: 'hollow', name: 'Hollow candles', settings: { ...DARK, hollow: true } },
  { id: 'quantbot', name: 'QuantBot', settings: { ...DARK, background: '#272725', grid: '#31312f', text: '#a8a59f', up: '#21c45d', down: '#ef4343', prediction: '#5fb7f2' } },
];

const COLOR_KEYS = ['background', 'grid', 'text', 'up', 'down', 'wickUp', 'wickDown', 'crosshair', 'prediction'];
const BOOL_KEYS = ['hollow', 'showGrid', 'showPrediction'];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// A change -> the keys it may set, or throws with what's wrong (so nothing but chart settings can be changed)
export function cleanChartChange(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('A chart change must be an object of settings');
  const out = {};
  for (const [k, v] of Object.entries(change)) {
    if (COLOR_KEYS.includes(k)) {
      if (v === '' && (k === 'wickUp' || k === 'wickDown')) { out[k] = ''; continue; }
      if (typeof v !== 'string' || !HEX.test(v.trim())) throw new Error(`${k} must be a color like #131722`);
      out[k] = v.trim().toLowerCase();
    } else if (BOOL_KEYS.includes(k)) {
      if (typeof v !== 'boolean') throw new Error(`${k} must be true or false`);
      out[k] = v;
    } else {
      throw new Error(`"${k}" isn't a chart setting. Settings: ${[...COLOR_KEYS, ...BOOL_KEYS].join(', ')}`);
    }
  }
  if (!Object.keys(out).length) throw new Error('No chart settings in that change');
  return out;
}

export const CHART_KEYS = { colors: COLOR_KEYS, switches: BOOL_KEYS };
