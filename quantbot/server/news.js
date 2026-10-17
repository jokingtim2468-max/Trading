// Economic calendar for news blackouts: Forex Factory's weekly feed and FTMO's calendar (which also marks FTMO's
// restricted events). Both publish the current week, so QuantBot fetches them every 30 minutes and keeps what it has
// seen in data/news.json (the last 120 days), which also covers the start of a new week.
import fs from 'node:fs';
import path from 'node:path';

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FTMO_URL = 'https://gw2.ftmo.com/public-api/v1/economic-calendar';
const EVERY = 30 * 60000;
const KEEP_DAYS = 120;

const impactOf = (v) => {
  const s = String(v || '').toLowerCase();
  return s.startsWith('high') ? 'high' : s.startsWith('med') ? 'medium' : s.startsWith('holiday') ? 'holiday' : s.startsWith('non') ? 'none' : 'low';
};

export function parseFF(list) {
  return (Array.isArray(list) ? list : []).filter((e) => e?.date && e?.country).map((e) => ({
    source: 'ff', title: String(e.title || ''), currency: String(e.country).toUpperCase(), impact: impactOf(e.impact),
    time: new Date(e.date).toISOString(), restricted: false,
  }));
}
export function parseFTMO(body) {
  return (Array.isArray(body?.items) ? body.items : []).filter((e) => e?.date && e?.instrument).map((e) => ({
    source: 'ftmo', title: String(e.title || ''), currency: String(e.instrument).toUpperCase(), impact: impactOf(e.impact),
    time: new Date(e.date).toISOString(), restricted: !!e.restriction,
  }));
}

export function createNews({ dataDir, log = () => {}, fetch: get = globalThis.fetch }) {
  const file = path.join(dataDir, 'news.json');
  let state = { events: [], fetched: {}, errors: {} };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  let timer = null;

  const key = (e) => `${e.source}|${e.currency}|${e.title}|${e.time}`;
  function merge(fresh, source) {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    // The fresh week replaces what was stored for those days (times can move), older days stay
    const days = new Set(fresh.map((e) => e.time.slice(0, 10)));
    const kept = state.events.filter((e) => !(e.source === source && days.has(e.time.slice(0, 10))) && Date.parse(e.time) >= cutoff);
    const all = new Map([...kept, ...fresh].map((e) => [key(e), e]));
    state.events = [...all.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  async function pull(source, url, parse) {
    try {
      const res = await get(url, { headers: { accept: 'application/json', 'user-agent': 'QuantBot' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const events = parse(await res.json());
      merge(events, source);
      state.fetched[source] = new Date().toISOString();
      delete state.errors[source];
      return events.length;
    } catch (e) {
      state.errors[source] = e.message;
      log(`news: ${source === 'ff' ? 'Forex Factory' : 'FTMO'} calendar failed: ${e.message}`);
      return 0;
    }
  }

  // FTMO answers a week at a time when asked by date: this week and next week (empty until FTMO publishes it)
  const ftmoWeek = (offset) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offset * 7);
    const end = new Date(d.getTime() + 6 * 86400000);
    return `${FTMO_URL}?dateFrom=${d.toISOString().slice(0, 10)}&dateTo=${end.toISOString().slice(0, 10)}`;
  };

  async function refresh() {
    const [ff, ftmo, ftmoNext] = await Promise.all([pull('ff', FF_URL, parseFF), pull('ftmo', ftmoWeek(0), parseFTMO), pull('ftmo', ftmoWeek(1), parseFTMO)]);
    try { fs.writeFileSync(file, JSON.stringify(state)); } catch (e) { log(`news: could not save: ${e.message}`); }
    return { ff, ftmo: ftmo + ftmoNext };
  }

  return {
    events: () => state.events,
    status: () => ({ fetched: state.fetched, errors: state.errors, count: state.events.length }),
    refresh,
    start() { refresh(); timer = setInterval(refresh, EVERY); timer.unref?.(); },
    stop() { clearInterval(timer); },
  };
}
