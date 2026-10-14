import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '@/api/client';
import { SESSIONS, sessionState, serverClock, duration } from '@/lib/sessions';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const money = (v) => (v == null ? 'n/a' : `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

// Which sessions are trading now, in MT5 server time, plus the bot tested last: what a trader checks before working
export default function MarketDesk() {
  const [now, setNow] = useState(() => new Date());
  const [last, setLast] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    client.entities.TestSession.filter({}, { sort: '-last_run_at', limit: 1 }).then((p) => setLast(p.items[0] || null)).catch(() => {});
  }, []);

  const server = serverClock(now);
  const states = SESSIONS.map((s) => ({ ...s, ...sessionState(s, now) }));
  const overlap = states.find((s) => s.id === 'london').open && states.find((s) => s.id === 'newyork').open;
  const weekend = server.weekday === 0 || server.weekday === 6;

  return (
    <div className="w-full max-w-3xl grid gap-3 md:grid-cols-[1.4fr_1fr]">
      <section aria-label="Trading sessions" className="rounded-xl border border-border bg-card shadow-raised p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Sessions</h2>
          <span className="text-xs text-muted-foreground">
            Server time <span className="font-heading text-base text-foreground tabular-nums ml-1" data-testid="server-time">{server.time}</span>
            <span className="ml-1.5">{DAYS[server.weekday]}</span>
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {states.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-sm">
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.open ? 'bg-chart-2 shadow-[0_0_8px_hsl(var(--chart-2))]' : 'bg-border'}`} />
              <span className="w-20">{s.name}</span>
              <span className="flex-1 h-1 rounded-full bg-border/60 overflow-hidden">
                {s.open && <span className="block h-full bg-chart-2/70" style={{ width: `${100 - (s.minutes / (s.close - s.open)) * 100}%` }} />}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums w-28 text-right">
                {s.open ? `closes in ${duration(s.minutes)}` : `opens in ${duration(s.minutes)}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {weekend ? 'Markets are closed for the weekend. A good time to backtest.'
            : overlap ? 'London and New York overlap: the busiest hours for gold and the Nasdaq.'
              : 'Gold and the Nasdaq move most in the London and New York sessions.'}
        </p>
      </section>

      <section aria-label="Last test" className="rounded-xl border border-border bg-card shadow-raised p-4 flex flex-col">
        <h2 className="text-sm font-medium">Last test</h2>
        {last ? (
          <>
            <div className="mt-2 font-heading text-lg font-semibold truncate">{last.bot_name}</div>
            <div className="text-xs text-muted-foreground">
              {last.symbol} {last.timeframe}, {last.versions || 0} version{last.versions === 1 ? '' : 's'}
            </div>
            <div className={`mt-2 font-heading text-2xl tabular-nums ${last.latest_net >= 0 ? 'text-chart-2' : 'text-destructive'}`}>{money(last.latest_net)}</div>
            <Link to="/test-history" className="mt-auto pt-3 text-sm text-primary hover:underline self-start">Open in Test history</Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground flex-1">
              Nothing tested yet. Paste a strategy into the Converter: it builds the bot, tests it on gold, US100 and NQ, then opens a chat to fine-tune it.
            </p>
            <Link to="/strategy-converter" className="mt-3 text-sm text-primary hover:underline self-start">Open the Converter</Link>
          </>
        )}
      </section>
    </div>
  );
}
