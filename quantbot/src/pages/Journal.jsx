import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload, Image as ImageIcon, X, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { client } from '@/api/client';
import { parseHistory, dedupeKey, rOf, stats, bySetup, weekStart, weekly, scorecard } from '@/lib/journal';
import { loadBars } from '@/lib/backtest/data';
import { usd } from '@/lib/pnl';
import ChartLoader from '@/components/quant/ChartLoader';

const SETUPS = ['Breakout', 'Pullback', 'Reversal', 'Range', 'News', 'Model level'];
const day = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '–');
const f2 = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toFixed(2));
const Card = ({ k, v, tone }) => (
  <div className="rounded-xl border border-border bg-card px-4 py-3">
    <div className="text-xs text-muted-foreground">{k}</div>
    <div className={`text-lg font-semibold tabular-nums ${tone > 0 ? 'text-chart-2' : tone < 0 ? 'text-destructive' : ''}`}>{v}</div>
  </div>
);

// Every closed trade (Terminal and scripts, logged automatically by the copier) plus imported trade history, with
// a setup and a note per trade, chart pictures from the Terminal, and win rate / average R per setup
export default function Journal() {
  const [rows, setRows] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState('all');
  const [setup, setSetup] = useState('all');
  const [big, setBig] = useState(null);
  const [msg, setMsg] = useState('');
  const [week, setWeek] = useState(() => weekStart(new Date(Date.now() - 7 * 86400000).toISOString()));
  const [events, setEvents] = useState([]);
  const [score, setScore] = useState(null);
  const [importTo, setImportTo] = useState('');
  const file = useRef(null);

  const load = async () => {
    const [a, closed, imported] = await Promise.all([
      client.entities.TradingAccount.list(),
      client.entities.AccountTrade.filter({ status: 'closed' }, '-closed_at', 2000),
      client.entities.JournalTrade.filter({}, '-exit_time', 2000),
    ]);
    setAccounts(a);
    if (!importTo && a[0]) setImportTo(a[0].id);
    const name = (id) => a.find((x) => x.id === id)?.display_name || a.find((x) => x.id === id)?.label || 'Removed account';
    setRows([
      ...closed.map((t) => ({ ...t, kind: 'AccountTrade', account: name(t.account_id), entry_time: t.opened_at, exit_time: t.closed_at, note: t.journal_note || '' })),
      ...imported.map((t) => ({ ...t, kind: 'JournalTrade', account: t.account_label || name(t.account_id), imported: true })),
    ].sort((x, y) => String(y.exit_time).localeCompare(String(x.exit_time))));
  };
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);
  useEffect(() => { client.entities.CopyEvent.filter({}, '-created_date', 5000).then((l) => setEvents(l.filter((e) => e.kind === 'block' || e.kind === 'limit'))).catch(() => {}); }, []);
  // Model scorecard: its saved daily highs / lows against the finished days' real ones
  useEffect(() => {
    (async () => {
      const preds = (await (await fetch('/api/terminal/predictions')).json()).predictions || [];
      if (!preds.length) { setScore({ days: 0 }); return; }
      const today = new Date().toISOString().slice(0, 10);
      const out = { rows: [], days: 0 };
      for (const sym of [...new Set(preds.map((p) => p.symbol))]) {
        const from = preds.filter((p) => p.symbol === sym).map((p) => p.day).sort()[0];
        const d = await loadBars({ market: true, id: sym, symbol: sym }, { tf: 'D1', from, to: today });
        const daily = Array.from(d.time).map((t, i) => ({ day: new Date(t).toISOString().slice(0, 10), high: d.high[i], low: d.low[i] })).filter((x) => x.day < today);
        const sc = scorecard(preds.filter((p) => p.symbol === sym), daily);
        out[sym] = sc; out.rows.push(...sc.rows); out.days += sc.days;
      }
      setScore({ ...scorecard(out.rows, out.rows.map((r) => ({ day: r.day, high: r.actualHigh, low: r.actualLow }))), bySymbol: out });
    })().catch((e) => setScore({ days: 0, error: e.message }));
  }, []);

  const list = useMemo(() => (rows || []).filter((t) => (account === 'all' || t.account_id === account) && (setup === 'all' || (t.setup || 'No setup') === setup)), [rows, account, setup]);
  const all = useMemo(() => stats(list), [list]);
  const setups = useMemo(() => bySetup(list), [list]);
  const rep = useMemo(() => weekly(list, week, events), [list, week, events]);

  const save = async (t, patch) => {
    setRows((r) => r.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const data = t.kind === 'AccountTrade' && 'note' in patch ? { journal_note: patch.note } : patch;
    await client.entities[t.kind].update(t.id, data);
  };

  const onImport = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !importTo) return;
    const { trades, skipped } = parseHistory(await f.text());
    const acc = accounts.find((a) => a.id === importTo);
    const have = new Set((rows || []).filter((t) => t.imported).map((t) => t.dedupe));
    const fresh = trades.map((t) => ({ ...t, dedupe: dedupeKey(importTo, t) })).filter((t) => !have.has(t.dedupe));
    if (fresh.length) {
      await client.entities.JournalTrade.bulkCreate(fresh.map((t) => ({
        ...t, account_id: importTo, account_label: acc?.display_name || acc?.label, platform: acc?.platform, group_id: acc?.group_id,
        exit_day: t.exit_time.slice(0, 10), exit_month: t.exit_time.slice(0, 7), source: f.name, note: '',
      })));
    }
    setMsg(`${fresh.length} trade${fresh.length === 1 ? '' : 's'} imported from ${f.name}${trades.length - fresh.length ? `, ${trades.length - fresh.length} already in the journal` : ''}${skipped ? `, ${skipped} line${skipped === 1 ? '' : 's'} skipped (not a closed trade)` : ''}.`);
    load();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/terminal" className="p-2 rounded-md hover:bg-accent" aria-label="Back"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Journal</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Every closed trade, logged automatically, plus imported history</span>
        <Link to="/pnl" className="ml-auto text-sm text-primary hover:underline">PnL calendar</Link>
      </header>
      {!rows ? <div className="flex justify-center py-20"><ChartLoader className="w-20 h-12" /></div> : (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5" data-testid="journal">
          <div className="flex flex-wrap items-center gap-2">
            <select value={account} onChange={(e) => setAccount(e.target.value)} className="h-9 px-2 rounded-lg border border-border bg-card text-sm" aria-label="Account" data-testid="journal-account">
              <option value="all">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name || a.label}</option>)}
            </select>
            <select value={setup} onChange={(e) => setSetup(e.target.value)} className="h-9 px-2 rounded-lg border border-border bg-card text-sm" aria-label="Setup">
              <option value="all">All setups</option>
              {[...new Set([...SETUPS, ...(rows || []).map((t) => t.setup).filter(Boolean), 'No setup'])].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <select value={importTo} onChange={(e) => setImportTo(e.target.value)} className="h-9 px-2 rounded-lg border border-border bg-card text-sm" aria-label="Import into account">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name || a.label}</option>)}
              </select>
              <input ref={file} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={onImport} data-testid="journal-file" />
              <button type="button" disabled={!importTo} onClick={() => file.current?.click()} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"><Upload className="w-4 h-4" />Import history</button>
            </div>
          </div>
          {msg && <p className="text-sm text-muted-foreground" data-testid="journal-msg">{msg}</p>}
          <p className="text-xs text-muted-foreground">Import: in MT5 open History, right-click, choose Positions, then Report or copy to a file (CSV or tab-separated). Other platforms: any CSV with symbol, side, size, open / close time and price, and profit.</p>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="journal-stats">
            <Card k="Trades" v={all.trades} />
            <Card k="Win rate" v={`${all.winRate}%`} />
            <Card k="Net P&L" v={usd(all.net)} tone={all.net} />
            <Card k="Profit factor" v={all.pf ?? '–'} />
            <Card k="Average R" v={all.avgR != null ? `${all.avgR}R` : '–'} tone={all.avgR} />
          </div>

          <WeekReport rep={rep} onWeek={(d) => setWeek(week + d * 7 * 86400000)} />
          <Scorecard s={score} />
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 text-sm font-semibold border-b border-border">By setup</div>
            <div className="grid grid-cols-5 px-4 py-1.5 text-xs text-muted-foreground"><span>Setup</span><span>Trades</span><span>Win rate</span><span>Average R</span><span>Net</span></div>
            {setups.map((s) => (
              <div key={s.setup} className="grid grid-cols-5 px-4 py-1.5 border-t border-border text-sm tabular-nums" data-testid="setup-row">
                <span>{s.setup}</span><span>{s.trades}</span><span>{s.winRate}%</span><span>{s.avgR != null ? `${s.avgR}R` : '–'}</span>
                <span className={s.net >= 0 ? 'text-chart-2' : 'text-destructive'}>{usd(s.net)}</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[1.2fr_1fr_.7fr_.5fr_1.2fr_.8fr_.5fr_1fr_2fr_.8fr] px-4 py-2 text-xs text-muted-foreground border-b border-border">
                <span>Closed</span><span>Account</span><span>Symbol</span><span>Side</span><span>Entry → exit</span><span>P&L</span><span>R</span><span>Setup</span><span>Note</span><span>Chart</span>
              </div>
              {!list.length && <div className="px-4 py-6 text-sm text-muted-foreground">No closed trades yet. Trades from the Terminal and your scripts show up here when they close.</div>}
              {list.slice(0, 500).map((t) => (
                <div key={t.id} className="grid grid-cols-[1.2fr_1fr_.7fr_.5fr_1.2fr_.8fr_.5fr_1fr_2fr_.8fr] items-center gap-1 px-4 py-1.5 border-t border-border text-sm tabular-nums" data-testid="journal-row">
                  <span>{day(t.exit_time)}</span><span className="truncate">{t.account}</span><span>{t.symbol}</span>
                  <span className={t.side === 'long' ? 'text-primary' : 'text-destructive'}>{t.side === 'long' ? 'Buy' : 'Sell'} {t.qty ?? ''}</span>
                  <span>{f2(t.entry)} → {f2(t.exit)}</span>
                  <span className={t.pnl >= 0 ? 'text-chart-2' : 'text-destructive'}>{usd(t.pnl)}</span>
                  <span>{rOf(t) != null ? `${rOf(t)}R` : '–'}</span>
                  <select value={t.setup || ''} onChange={(e) => save(t, { setup: e.target.value })} className="h-7 px-1 rounded-md border border-border bg-background text-xs" aria-label="Setup" data-testid="journal-setup">
                    <option value="">–</option>
                    {SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input defaultValue={t.note || ''} onBlur={(e) => e.target.value !== (t.note || '') && save(t, { note: e.target.value })} placeholder="What happened, what to repeat"
                    className="h-7 px-2 rounded-md border border-border bg-background text-xs" aria-label="Note" data-testid="journal-note" />
                  <span className="flex gap-1">
                    {[['snap_open', 'Open'], ['snap_close', 'Close']].map(([k, l]) => (t[k]
                      ? <button key={k} type="button" onClick={() => setBig(t[k])} title={`Chart at ${l.toLowerCase()}`} className="w-10 h-7 rounded border border-border overflow-hidden bg-background"><img src={t[k]} alt={`Chart at ${l.toLowerCase()}`} className="w-full h-full object-cover" /></button>
                      : <span key={k} className="w-10 h-7 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground" title={t.imported ? 'Imported trade' : 'No picture'}><ImageIcon className="w-3 h-3" /></span>))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {big && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 animate-in fade-in-0 duration-pop calm:animate-none" onClick={() => setBig(null)}>
          <img src={big} alt="Chart" className="max-w-full max-h-full rounded-xl shadow-2xl" />
          <button type="button" aria-label="Close" className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
      )}
    </div>
  );
}

const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The week's report (also printable / savable as a PDF with the browser's print)
function WeekReport({ rep, onWeek }) {
  const Item = ({ k, v, t }) => <div><div className="text-xs text-muted-foreground">{k}</div><div className={`font-semibold tabular-nums ${t > 0 ? 'text-chart-2' : t < 0 ? 'text-destructive' : ''}`}>{v}</div></div>;
  return (
    <div className="rounded-xl border border-border bg-card print:border-0" data-testid="week-report">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <span className="text-sm font-semibold">Weekly report</span>
        <button type="button" aria-label="Previous week" onClick={() => onWeek(-1)} className="p-1 rounded-md hover:bg-accent print:hidden"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm tabular-nums" data-testid="week-label">{fmtDay(rep.start)} to {fmtDay(rep.end - 86400000)}</span>
        <button type="button" aria-label="Next week" onClick={() => onWeek(1)} className="p-1 rounded-md hover:bg-accent print:hidden"><ChevronRight className="w-4 h-4" /></button>
        <button type="button" onClick={() => window.print()} className="ml-auto h-8 px-3 rounded-lg border border-border text-sm inline-flex items-center gap-1.5 hover:bg-accent print:hidden" data-testid="week-print"><Printer className="w-4 h-4" />Save as PDF</button>
      </div>
      {!rep.trades ? <p className="px-4 py-4 text-sm text-muted-foreground">No closed trades that week.</p> : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-4 py-3">
          <Item k="Net P&L" v={usd(rep.net)} t={rep.net} />
          <Item k="Trades / win rate" v={`${rep.trades} · ${rep.winRate}%`} />
          <Item k="Average R" v={rep.avgR != null ? `${rep.avgR}R` : '–'} t={rep.avgR} />
          <Item k="Rule-breaks blocked" v={rep.blocks} />
          <Item k="Best setup" v={rep.bestSetup ? `${rep.bestSetup.setup} ${usd(rep.bestSetup.net)}` : '–'} />
          <Item k="Worst setup" v={rep.worstSetup ? `${rep.worstSetup.setup} ${usd(rep.worstSetup.net)}` : '–'} />
          <Item k="Best day" v={rep.bestDay ? `${rep.bestDay.day} ${usd(rep.bestDay.pnl)}` : '–'} />
          <Item k="Worst day" v={rep.worstDay ? `${rep.worstDay.day} ${usd(rep.worstDay.pnl)}` : '–'} />
        </div>
      )}
    </div>
  );
}

// Is the model any good: its daily high / low against what happened, and whether its confidence means anything
function Scorecard({ s }) {
  return (
    <div className="rounded-xl border border-border bg-card print:hidden" data-testid="scorecard">
      <div className="px-4 py-2.5 text-sm font-semibold border-b border-border">Model scorecard</div>
      {!s ? <p className="px-4 py-4 text-sm text-muted-foreground">Checking the model's past predictions…</p>
        : !s.days ? <p className="px-4 py-4 text-sm text-muted-foreground">{s.error || 'No finished days with a model prediction yet. Predictions are saved each day the Terminal opens with the local model running.'}</p> : (
          <div className="px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><div className="text-xs text-muted-foreground">Days scored</div><b className="tabular-nums">{s.days}</b></div>
              <div><div className="text-xs text-muted-foreground">Both within 25% of the day's range</div><b className="tabular-nums">{s.hitRate}%</b></div>
              <div><div className="text-xs text-muted-foreground">Average miss on the high</div><b className="tabular-nums">{s.avgHighErr} pts</b></div>
              <div><div className="text-xs text-muted-foreground">Average miss on the low</div><b className="tabular-nums">{s.avgLowErr} pts</b></div>
            </div>
            <div className="text-xs text-muted-foreground">Does its confidence mean anything? Hit rate by the confidence it gave:</div>
            <div className="flex gap-2">
              {s.buckets.map((b) => (
                <div key={b.label} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm" data-testid="score-bucket">
                  <div className="text-xs text-muted-foreground">{b.label} confidence</div>
                  <b className="tabular-nums">{b.hitRate != null ? `${b.hitRate}%` : '–'}</b> <span className="text-xs text-muted-foreground">({b.days} days)</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Trust the confidence only if higher buckets hit more often, over at least 20-30 days.</p>
          </div>
        )}
    </div>
  );
}
