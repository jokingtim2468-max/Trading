export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (t) => new Date(t).toISOString().slice(0, 10);

// Monday of the UTC week containing t
export function weekStart(t) {
  const d = new Date(t);
  return ymd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
}

export function viewRange(view, { y, m }) {
  if (view === 'day') return { field: 'exit_day', from: `${y}-${pad(m + 1)}-01`, to: m === 11 ? `${y + 1}-01-01` : `${y}-${pad(m + 2)}-01` };
  if (view === 'week') return { field: 'exit_week', from: `${y}-01-01`, to: `${y + 1}-01-01` };
  return { field: 'exit_month', from: `${y}-01`, to: `${y + 1}-01` };
}

// Monday-start weeks covering a month; each cell is YYYY-MM-DD or null
export function monthGrid(y, m) {
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, k) => `${y}-${pad(m + 1)}-${pad(k + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, k) => cells.slice(k * 7, k * 7 + 7));
}

export function weeksOfYear(y) {
  const out = [];
  let t = Date.parse(weekStart(Date.UTC(y, 0, 1)));
  if (new Date(t).getUTCFullYear() < y) t += 7 * 86400000;
  for (; new Date(t).getUTCFullYear() === y; t += 7 * 86400000) out.push(ymd(t));
  return out;
}

export const shiftMonth = ({ y, m }, dir) => { const t = y * 12 + m + dir; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; };
export const usd = (v) => `${v < 0 ? '-' : v > 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const compact = (v) => { const a = Math.abs(v); return `${v < 0 ? '-' : '+'}$${a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a.toFixed(0)}`; };
export const dayLabel = (d) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;
export const shortLabel = (view, key) => (view === 'month' ? MONTHS[+key.slice(5, 7) - 1] : `${MONTHS[+key.slice(5, 7) - 1]} ${+key.slice(8, 10)}`);
export const keyLabel = (view, key) => (view === 'day' ? dayLabel(key) : view === 'week' ? `week of ${dayLabel(key)}` : `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`);