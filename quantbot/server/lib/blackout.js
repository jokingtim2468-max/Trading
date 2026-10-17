// When a group takes no new trades: around news (Forex Factory and FTMO economic calendars, FTMO's restricted
// events), on blocked weekdays, in blocked time windows and on blocked dates or weeks. Times are in the group's time
// zone, which is this PC's time zone unless set otherwise. Shared by the server's copier and the app.

export const pcZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const IMPACTS = ['high', 'medium', 'low', 'holiday'];

export const DEFAULT_BLACKOUT = {
  news: true, sources: ['ff', 'ftmo'], impacts: ['high'], currencies: [], before: 5, after: 5,
  ftmo_restricted: true, ftmo_minutes: 2,
  days: [], windows: [], dates: [], tz: '',
};
export const blackoutOf = (group) => ({ ...DEFAULT_BLACKOUT, ...(group?.blackout || {}) });

// Calendar tags an event can target for this symbol: its currencies plus FTMO's instrument groups
// (FTMO events list instruments like "USD + US INDICES + XAUUSD + DXY")
export function tagsFor(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/^[A-Z_]+:/, '').replace(/[^A-Z0-9]/g, '');
  const tags = new Set(currenciesFor(symbol));
  if (/^(XAU|GOLD|MGC|GC)/.test(s)) tags.add('XAUUSD');
  if (/^(XAG|SILVER|SI)/.test(s)) tags.add('XAGUSD');
  if (/^(MNQ|NQ|MES|ES|MYM|YM|M2K|RTY|US100|NAS100|USTEC|NDX|US500|SPX|US30|DJI)/.test(s)) tags.add('US INDICES');
  if (/^(MCL|CL|USOIL|WTI|UKOIL|BRENT)/.test(s)) tags.add('CRUDE OIL');
  return tags;
}
export const eventTargets = (e) => String(e.currency || '').toUpperCase().split('+').map((x) => x.trim()).filter(Boolean);

// Currencies whose news moves a symbol: FX pairs by their two currencies; gold, US indices and US futures by USD
export function currenciesFor(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/^[A-Z_]+:/, '').replace(/[^A-Z0-9]/g, '');
  const fx = s.match(/^(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)/);
  if (fx) return [fx[1], fx[2]];
  if (/^(XAU|XAG|GOLD|SILVER|MGC|GC|SI|MNQ|NQ|MES|ES|MYM|YM|M2K|RTY|US100|NAS100|USTEC|NDX|US500|SPX|US30|DJI|MCL|CL|USOIL|WTI)/.test(s)) return ['USD'];
  if (/^(GER|DE40|DAX|EU50|FRA)/.test(s)) return ['EUR'];
  if (/^(UK100|FTSE)/.test(s)) return ['GBP'];
  if (/^(JP225|NIKKEI)/.test(s)) return ['JPY'];
  return ['USD'];
}

// Wall-clock parts of a moment in a time zone
export function partsIn(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: WEEKDAYS.indexOf(p.weekday), hhmm: `${p.hour}:${p.minute}` };
}
const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const timeIn = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

// News events that block this symbol, each with its blocked window [from, to] in ms
export function newsWindows(rules, events, symbol) {
  const r = { ...DEFAULT_BLACKOUT, ...rules };
  const tags = r.currencies?.length ? new Set(r.currencies.map((c) => c.toUpperCase())) : tagsFor(symbol);
  const out = [];
  for (const e of events || []) {
    if (!eventTargets(e).some((t) => tags.has(t))) continue;
    const t = Date.parse(e.time);
    if (!Number.isFinite(t)) continue;
    const label = `${e.currency} ${e.title} (${e.source === 'ftmo' ? 'FTMO' : 'Forex Factory'}, ${e.impact}${e.restricted ? ', FTMO restricted' : ''})`;
    if (r.ftmo_restricted && e.restricted) {
      const m = Number(r.ftmo_minutes) || 2;
      out.push({ from: t - m * 60000, to: t + m * 60000, reason: `FTMO restricted news: ${label}`, event: e });
    }
    if (r.news && r.sources?.includes(e.source) && r.impacts?.includes(e.impact)) {
      const allDay = e.impact === 'holiday';
      out.push({
        from: allDay ? t : t - (Number(r.before) || 0) * 60000, to: allDay ? t + 24 * 3600000 : t + (Number(r.after) || 0) * 60000,
        reason: `News: ${label}`, event: e,
      });
    }
  }
  return out;
}

// Why new trades are blocked at this moment, or null
export function blackoutAt(rules, events, ms, symbol, defaultTz = pcZone()) {
  const r = { ...DEFAULT_BLACKOUT, ...rules };
  const tz = r.tz || defaultTz;
  const at = partsIn(ms, tz);
  const zone = ` (${tz})`;
  for (const d of r.dates || []) {
    if (d.from && at.date >= d.from && at.date <= (d.to || d.from)) return { kind: 'date', reason: `Blocked ${d.from === (d.to || d.from) ? d.from : `${d.from} to ${d.to}`}${d.note ? `: ${d.note}` : ''}` };
  }
  if ((r.days || []).includes(at.weekday)) return { kind: 'day', reason: `${WEEKDAYS[at.weekday]} is blocked${zone}` };
  for (const w of r.windows || []) {
    const a = toMin(w.from), b = toMin(w.to);
    if (a == null || b == null || (w.days?.length && !w.days.includes(at.weekday))) continue;
    const inside = a <= b ? at.minutes >= a && at.minutes < b : at.minutes >= a || at.minutes < b;
    if (inside) return { kind: 'window', reason: `${w.from}-${w.to} is blocked${w.note ? ` (${w.note})` : ''}, now ${at.hhmm}${zone}` };
  }
  const hit = newsWindows(r, events, symbol).find((w) => ms >= w.from && ms <= w.to);
  if (hit) return { kind: 'news', reason: `${hit.reason} at ${timeIn(Date.parse(hit.event.time), tz)}${zone}: no new trades ${timeIn(hit.from, tz).split(', ').pop()}-${timeIn(hit.to, tz).split(', ').pop()}` };
  return null;
}

// The next news blocks for a symbol (for the app), soonest first
export function upcomingNews(rules, events, symbol, fromMs, limit = 6) {
  return newsWindows(rules, events, symbol).filter((w) => w.to >= fromMs).sort((a, b) => a.from - b.from).slice(0, limit);
}
