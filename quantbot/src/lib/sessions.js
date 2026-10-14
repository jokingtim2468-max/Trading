// Trading sessions for the home screen clock. Each session runs on its own city's clock (so daylight saving is
// handled by the time zone), Monday to Friday. Server time is MT5 broker time: New York time + 7 hours.
export const SESSIONS = [
  { id: 'tokyo', name: 'Tokyo', tz: 'Asia/Tokyo', open: 9 * 60, close: 18 * 60 },
  { id: 'london', name: 'London', tz: 'Europe/London', open: 8 * 60, close: 17 * 60 },
  { id: 'newyork', name: 'New York', tz: 'America/New_York', open: 8 * 60, close: 17 * 60 },
];

const DAY = 1440;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// -> { weekday 0-6, minutes since local midnight } in a time zone
export function wallClock(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { weekday: WEEKDAYS[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// -> { open, minutes } : open now and minutes until it closes, or closed and minutes until it opens
export function sessionState(session, date = new Date()) {
  const { weekday, minutes } = wallClock(date, session.tz);
  const weekdayOpen = (d) => d >= 1 && d <= 5;
  if (weekdayOpen(weekday) && minutes >= session.open && minutes < session.close) {
    return { open: true, minutes: session.close - minutes };
  }
  // Next weekday opening at or after now
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = (weekday + ahead) % 7;
    if (!weekdayOpen(d)) continue;
    const wait = ahead * DAY + session.open - minutes;
    if (wait > 0) return { open: false, minutes: wait };
  }
  return { open: false, minutes: 0 };
}

// MT5 server time (UTC+2 / UTC+3, always New York + 7 h) as HH:MM and weekday
export function serverClock(date = new Date()) {
  const { weekday, minutes } = wallClock(date, 'America/New_York');
  const m = (minutes + 7 * 60) % DAY;
  const day = (weekday + (minutes + 7 * 60 >= DAY ? 1 : 0)) % 7;
  return { weekday: day, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` };
}

export const duration = (min) => (min >= DAY ? `${Math.floor(min / DAY)}d ${Math.floor((min % DAY) / 60)}h`
  : min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`);
