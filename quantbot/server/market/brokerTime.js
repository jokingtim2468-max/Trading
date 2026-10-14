// Broker server time as MT5 brokers like FTMO use it: UTC+2, or UTC+3 while New York is on daylight saving,
// so every trading day closes at 17:00 New York (00:00 server time).
const HOUR = 3600000;

// Day of month of the n-th Sunday (n = 1..5) of a UTC month
function nthSunday(y, m, n) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

function lastSunday(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

// US daylight saving: 2nd Sunday of March to 1st Sunday of November since 2007, before that 1st Sunday of
// April to last Sunday of October. Switches happen at 02:00 New York time.
export function newYorkDst(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  const start = y >= 2007 ? Date.UTC(y, 2, nthSunday(y, 2, 2), 7) : Date.UTC(y, 3, nthSunday(y, 3, 1), 7);
  const end = y >= 2007 ? Date.UTC(y, 10, nthSunday(y, 10, 1), 6) : Date.UTC(y, 9, lastSunday(y, 9), 6);
  return utcMs >= start && utcMs < end;
}

export const brokerOffsetHours = (utcMs) => (newYorkDst(utcMs) ? 3 : 2);

// Server-time clock reading, stored as if it were UTC (the same way MT5 exports bar times)
export const toBroker = (utcMs) => utcMs + brokerOffsetHours(utcMs) * HOUR;
