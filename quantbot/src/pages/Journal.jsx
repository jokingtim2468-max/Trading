import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload, Image as ImageIcon, X } from 'lucide-react';
import { client } from '@/api/client';
import { parseHistory, dedupeKey, rOf, stats, bySetup } from '@/lib/journal';
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

  const list = useMemo(() => (rows || []).filter((t) => (account === 'all' || t.account_id === account) && (setup === 'all' || (t.setup || 'No setup') === setup)), [rows, account, setup]);
  const all = useMemo(() => stats(list), [list]);
  const setups = useMemo(() => bySetup(list), [list]);

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
