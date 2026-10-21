import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarOff, Newspaper, Plus, X, RefreshCw } from 'lucide-react';
import { client } from '@/api/client';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { blackoutOf, blackoutAt, upcomingNews, timeIn, WEEKDAYS, IMPACTS } from '../../../server/lib/blackout.js';
import { logSetup } from '@/lib/copy';

const SOURCES = [{ id: 'ff', label: 'Forex Factory' }, { id: 'ftmo', label: 'FTMO calendar' }];
const chip = (on) => `px-2.5 py-1 rounded-lg text-xs border whitespace-nowrap ${on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`;

// When the group takes no new trades: news from Forex Factory and FTMO (with FTMO's restricted events), blocked
// weekdays, time windows and dates, all in this PC's time zone. Stops, targets and closes always follow.
export default function BlackoutPanel({ group, symbol, onChanged }) {
  const [rules, setRules] = useState(() => blackoutOf(group));
  const [news, setNews] = useState({ events: [], tz: Intl.DateTimeFormat().resolvedOptions().timeZone, status: {} });
  const [now, setNow] = useState(Date.now());
  const [newWin, setNewWin] = useState({ from: '', to: '' });
  const [newDate, setNewDate] = useState({ from: '', to: '', note: '' });
  const timer = useRef(null);
  const tz = rules.tz || news.tz;

  const load = () => fetch('/api/news').then((r) => r.json()).then(setNews).catch(() => {});
  useEffect(() => { load(); const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { setRules(blackoutOf(group)); }, [group.id]);  

  // Saved a moment after the last change, with one line in the activity log
  const change = (patch, message) => {
    const next = { ...rules, ...patch };
    setRules(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await client.entities.CopyGroup.update(group.id, { blackout: next });
      await logSetup(`${group.name}: ${message}`, { group_id: group.id }, { blackout: next });
      onChanged?.();
    }, 400);
  };
  const toggleIn = (key, value, label) => {
    const list = rules[key] || [];
    const on = !list.includes(value);
    change({ [key]: on ? [...list, value] : list.filter((x) => x !== value) }, `${on ? 'blocks' : 'unblocks'} ${label}`);
  };

  const block = blackoutAt(rules, news.events, now, symbol, news.tz);
  const upcoming = useMemo(() => upcomingNews(rules, news.events, symbol, now, 6), [rules, news.events, symbol, now]);
  const fetched = Object.entries(news.status?.fetched || {}).map(([k, v]) => `${k === 'ff' ? 'Forex Factory' : 'FTMO'} ${timeIn(Date.parse(v), tz)}`).join(' · ');

  return (
    <div className="rounded-xl border border-border/70 p-3 space-y-3" data-testid="blackout-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium flex items-center gap-1.5"><CalendarOff className="w-3.5 h-3.5 text-chart-4" />News and trading hours</p>
        <span className={`text-[11px] rounded-full border px-2 py-0.5 ${block ? 'border-chart-4/50 text-chart-4' : 'border-emerald-500/40 text-emerald-400'}`} data-testid="blackout-now">
          {block ? 'No new trades now' : 'Open for new trades'}
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto" data-testid="blackout-tz">Times in {tz}{rules.tz ? '' : ' (this PC)'}</span>
      </div>
      {block && <p className="text-[11px] text-chart-4">{block.reason}</p>}

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!rules.news} onCheckedChange={(v) => change({ news: v }, v ? 'news blocks on' : 'news blocks off')} aria-label="Block news" />
          <Newspaper className="w-3.5 h-3.5 text-muted-foreground" />Block news
          <span className="text-xs text-muted-foreground">from</span>
          <Input type="number" min={0} value={rules.before} onChange={(e) => change({ before: Number(e.target.value) }, `news block starts ${e.target.value} min before`)} aria-label="Minutes before news" className="h-7 w-14 text-xs" />
          <span className="text-xs text-muted-foreground">min before to</span>
          <Input type="number" min={0} value={rules.after} onChange={(e) => change({ after: Number(e.target.value) }, `news block ends ${e.target.value} min after`)} aria-label="Minutes after news" className="h-7 w-14 text-xs" />
          <span className="text-xs text-muted-foreground">after</span>
        </label>
        {rules.news && (
          <div className="flex flex-wrap gap-1.5 pl-11">
            {SOURCES.map((s) => <button key={s.id} type="button" className={chip(rules.sources.includes(s.id))} onClick={() => toggleIn('sources', s.id, `${s.label} news`)}>{s.label}</button>)}
            <span className="w-px bg-border mx-1" />
            {IMPACTS.map((i) => <button key={i} type="button" className={chip(rules.impacts.includes(i))} onClick={() => toggleIn('impacts', i, `${i} impact news`)}>{i[0].toUpperCase() + i.slice(1)}</button>)}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!rules.ftmo_restricted} onCheckedChange={(v) => change({ ftmo_restricted: v }, v ? "FTMO's restricted events blocked" : "FTMO's restricted events not blocked")} aria-label="Block FTMO restricted events" />
          FTMO restricted events, {rules.ftmo_minutes} min either side
          <span className="text-[11px] text-muted-foreground">(FTMO funded accounts can&apos;t trade these)</span>
        </label>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Blocked days</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Blocked days">
          {WEEKDAYS.map((d, i) => <button key={d} type="button" aria-pressed={rules.days.includes(i)} className={chip(rules.days.includes(i))} onClick={() => toggleIn('days', i, d)}>{d}</button>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Blocked hours (every day)</p>
        <div className="flex flex-wrap gap-1.5">
          {rules.windows.map((w, k) => (
            <span key={k} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs tabular-nums" data-window={`${w.from}-${w.to}`}>
              {w.from}-{w.to}
              <button type="button" aria-label={`Unblock ${w.from}-${w.to}`} onClick={() => change({ windows: rules.windows.filter((_, j) => j !== k) }, `unblocks ${w.from}-${w.to}`)}><X className="w-3 h-3" /></button>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <Input type="time" value={newWin.from} onChange={(e) => setNewWin((w) => ({ ...w, from: e.target.value }))} aria-label="Block from" className="h-7 w-[6.5rem] text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="time" value={newWin.to} onChange={(e) => setNewWin((w) => ({ ...w, to: e.target.value }))} aria-label="Block to" className="h-7 w-[6.5rem] text-xs" />
            <button type="button" aria-label="Add blocked hours" disabled={!newWin.from || !newWin.to} className="p-1 rounded-md hover:bg-accent disabled:opacity-40"
              onClick={() => { change({ windows: [...rules.windows, newWin] }, `blocks ${newWin.from}-${newWin.to} (${tz})`); setNewWin({ from: '', to: '' }); }}><Plus className="w-4 h-4" /></button>
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Blocked dates and weeks</p>
        <div className="flex flex-wrap gap-1.5">
          {rules.dates.map((d, k) => (
            <span key={k} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs tabular-nums" data-date={d.from}>
              {d.from === d.to || !d.to ? d.from : `${d.from} to ${d.to}`}{d.note ? ` · ${d.note}` : ''}
              <button type="button" aria-label={`Unblock ${d.from}`} onClick={() => change({ dates: rules.dates.filter((_, j) => j !== k) }, `unblocks ${d.from}`)}><X className="w-3 h-3" /></button>
            </span>
          ))}
          <span className="flex flex-wrap items-center gap-1">
            <Input type="date" value={newDate.from} onChange={(e) => setNewDate((d) => ({ ...d, from: e.target.value }))} aria-label="Block from date" className="h-7 w-36 text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={newDate.to} onChange={(e) => setNewDate((d) => ({ ...d, to: e.target.value }))} aria-label="Block to date" className="h-7 w-36 text-xs" />
            <Input value={newDate.note} onChange={(e) => setNewDate((d) => ({ ...d, note: e.target.value }))} aria-label="Why" placeholder="Why (optional)" className="h-7 w-32 text-xs" />
            <button type="button" aria-label="Add blocked dates" disabled={!newDate.from} className="p-1 rounded-md hover:bg-accent disabled:opacity-40"
              onClick={() => { const d = { ...newDate, to: newDate.to || newDate.from }; change({ dates: [...rules.dates, d] }, `blocks ${d.from}${d.to !== d.from ? ` to ${d.to}` : ''}${d.note ? ` (${d.note})` : ''}`); setNewDate({ from: '', to: '', note: '' }); }}><Plus className="w-4 h-4" /></button>
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">Next news blocks for {symbol}</p>
          <button type="button" onClick={() => fetch('/api/news/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(load)} className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><RefreshCw className="w-3 h-3" />Refresh</button>
        </div>
        {upcoming.length ? (
          <ul className="text-xs space-y-0.5" data-testid="news-upcoming">
            {upcoming.map((w, k) => (
              <li key={k} className="flex gap-2 min-w-0">
                <span className="tabular-nums text-muted-foreground whitespace-nowrap w-40 shrink-0">{timeIn(w.from, tz)}-{timeIn(w.to, tz).split(', ').pop()}</span>
                <span className={`truncate ${w.event.restricted ? 'text-chart-4' : ''}`} title={w.reason}>{w.reason}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">No news blocks coming up this week.</p>}
        <p className="text-[10px] text-muted-foreground">{fetched ? `Calendars updated ${fetched}` : 'Loading the calendars…'}{Object.keys(news.status?.errors || {}).length ? ` · could not reach ${Object.keys(news.status.errors).map((k) => (k === 'ff' ? 'Forex Factory' : 'FTMO')).join(', ')}` : ''}</p>
      </div>
    </div>
  );
}
