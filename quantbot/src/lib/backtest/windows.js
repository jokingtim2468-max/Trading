const DAY = 86400000;

export const WINDOWS = [
  { id: '1d', label: '1 day unseen', ms: DAY },
  { id: '1w', label: '1 week unseen', ms: 7 * DAY },
  { id: '1m', label: '1 month unseen', ms: 30 * DAY },
  { id: '1y', label: '1 year unseen', ms: 365 * DAY },
  { id: 'custom', label: 'Custom range' },
];

// Latest stretch of bars this bot has never been tested on, spanning `ms`
export function findUnseenWindow(time, used, ms) {
  const barMs = time.length > 1 ? time[1] - time[0] : 0;
  const seen = (t) => used.some((u) => t >= u.start && t <= u.end);
  let runEnd = -1;
  for (let i = time.length - 1; i >= 0; i--) {
    if (seen(time[i])) { runEnd = -1; continue; }
    if (runEnd < 0) runEnd = i;
    if (time[runEnd] - time[i] >= ms - barMs) return { from: i, to: runEnd };
  }
  return null;
}

export function customWindow(time, fromDate, toDate) {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T23:59:59Z`);
  let from = -1, to = -1;
  for (let i = 0; i < time.length; i++) {
    if (time[i] >= start && time[i] <= end) { if (from < 0) from = i; to = i; }
  }
  return from < 0 ? null : { from, to };
}

export const overlapsSeen = (time, w, used) =>
  used.some((u) => time[w.from] <= u.end && time[w.to] >= u.start);

export const fmtDate = (t) => new Date(t).toISOString().slice(0, 10);