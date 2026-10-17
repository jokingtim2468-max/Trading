import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crosshair, Minus, Trash2, Pencil, Palette, Undo2, RotateCcw, ShieldAlert, Target } from 'lucide-react';
import { LineStyle } from 'lightweight-charts';
import { client } from '@/api/client';
import { loadBars } from '@/lib/backtest/data';
import { POP } from '@/lib/clickOrigin';
import LogoMark from '@/components/quant/LogoMark';
import TerminalChart from '@/components/terminal/TerminalChart';
import ChartEditor from '@/components/terminal/ChartEditor';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';

const SYMBOLS = ['XAUUSD', 'US100'];
const TFS = [['M1', 2], ['M5', 6], ['M15', 14], ['H1', 60], ['H4', 200], ['D1', 1500]]; // timeframe, days shown
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '–');
const MENU = `${POP} min-w-[248px] rounded-[14px] border-[#363a45] bg-[#1e222d]/95 backdrop-blur-xl p-1.5 text-[#d1d4dc] shadow-[0_18px_48px_rgba(0,0,0,.55)]`;
const ITEM = 'h-[34px] gap-2.5 rounded-[9px] px-2.5 text-[13px] focus:bg-[#2a2e39] focus:text-white data-[state=open]:bg-[#2a2e39]';

function useMarket(symbol, tf) {
  const [state, setState] = useState({ bars: null, daily: null, error: '', progress: null });
  useEffect(() => {
    let live = true;
    const days = TFS.find((t) => t[0] === tf)[1];
    const to = day(Date.now()), from = day(Date.now() - days * 86400000);
    setState((s) => ({ ...s, bars: null, error: '' }));
    const ds = { market: true, id: symbol, symbol };
    Promise.all([
      loadBars(ds, { tf, from, to, onProgress: (d, t) => live && setState((s) => ({ ...s, progress: t ? `${d}/${t}` : null })) }),
      loadBars(ds, { tf: 'D1', from: day(Date.now() - 45 * 86400000), to }),
    ]).then(([bars, daily]) => live && setState({ bars, daily, error: '', progress: null }))
      .catch((e) => live && setState({ bars: null, daily: null, error: e.message, progress: null }));
    return () => { live = false; };
  }, [symbol, tf]);
  return state;
}

// Today's predicted high / low: the trained model's when the daily loop has one, else the simple guess the model is
// tested against (today's open +/- half the 20-day average range)
function guessLevels(daily) {
  if (!daily || daily.time.length < 21) return [];
  const n = daily.time.length, o = daily.open[n - 1];
  let sum = 0;
  for (let i = n - 21; i < n - 1; i++) sum += (daily.high[i] - daily.low[i]) / daily.open[i];
  const half = (sum / 20) / 2;
  return [
    { price: o * (1 + half), title: 'Guess high', color: '#e8c468' },
    { price: o * (1 - half), title: 'Guess low', color: '#e8c468' },
    { price: o, title: 'Open', color: '#787b86' },
  ];
}

export default function Terminal() {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [tf, setTf] = useState('M15');
  const market = useMarket(symbol, tf);
  const [chart, setChart] = useState(null);
  const [tool, setTool] = useState('cross');
  const [hlines, setHlines] = useState([]);
  const [hover, setHover] = useState(null);
  const [clickPrice, setClickPrice] = useState(null);
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [ticket, setTicket] = useState({ side: 'buy', qty: '1', sl: '', tp: '' });
  const [msg, setMsg] = useState(null);

  useEffect(() => { fetch('/api/terminal/chart').then((r) => r.json()).then(setChart).catch(() => {}); }, []);
  const loadTrading = useCallback(async () => {
    const [g, a, p] = await Promise.all([
      client.entities.CopyGroup.list(), client.entities.TradingAccount.list(),
      fetch(`/api/terminal/positions${groupId ? `?group=${groupId}` : ''}`).then((r) => r.json()),
    ]);
    setGroups(g); setAccounts(a); setPositions(p.positions || []);
    if (!groupId && g[0]) setGroupId(g[0].id);
  }, [groupId]);
  useEffect(() => { loadTrading().catch(() => {}); const t = setInterval(() => loadTrading().catch(() => {}), 5000); return () => clearInterval(t); }, [loadTrading]);

  const bars = market.bars;
  const last = bars && bars.time.length ? bars.close[bars.time.length - 1] : null;
  const shown = hover || (bars && bars.time.length ? { open: bars.open.at(-1), high: bars.high.at(-1), low: bars.low.at(-1), close: last } : null);
  const levels = useMemo(() => guessLevels(market.daily), [market.daily]);
  const lines = useMemo(() => [
    ...hlines.map((p) => ({ price: p, color: '#2962ff', title: '' })),
    ...(ticket.sl ? [{ price: Number(ticket.sl), color: '#f23645', title: 'SL', style: LineStyle.Dotted }] : []),
    ...(ticket.tp ? [{ price: Number(ticket.tp), color: '#089981', title: 'TP', style: LineStyle.Dotted }] : []),
    // One line per trade, however many accounts copied it
    ...Object.values(Object.groupBy(positions.filter((t) => t.symbol === symbol), (t) => t.trade_id || t.id)).flatMap((same) => same.slice(0, 1).map((t) => ({ ...t, n: same.length }))).flatMap((t) => [
      { price: t.entry, color: t.side === 'long' ? '#2962ff' : '#f23645', title: `${t.side === 'long' ? 'Buy' : 'Sell'} ${t.qty}${t.n > 1 ? ` × ${t.n}` : ''}`, width: 2 },
      ...(t.sl != null ? [{ price: t.sl, color: '#f23645', title: 'SL', style: LineStyle.Dashed }] : []),
      ...(t.tp != null ? [{ price: t.tp, color: '#089981', title: 'TP', style: LineStyle.Dashed }] : []),
    ]),
  ], [hlines, ticket.sl, ticket.tp, positions, symbol]);

  const group = groups.find((g) => g.id === groupId);
  const members = accounts.filter((a) => a.group_id === groupId);
  const mt5 = members.filter((a) => a.platform === 'MT5');
  const live = mt5.filter((a) => a.daemon_state === 'connected').length;

  const chartCall = async (p, body) => setChart(await post(`/api/terminal/chart/${p}`, body));
  const place = async (event, extra = {}) => {
    setMsg(null);
    try {
      const r = await post('/api/terminal/order', { group_id: groupId, event, symbol, price: last, qty: ticket.qty, sl: ticket.sl, tp: ticket.tp, ...extra });
      setMsg({ ok: true, text: `${event.toUpperCase()} sent to ${group?.name}: see the copy log for each account (${r.trade_id})` });
      loadTrading();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  const priceLabel = clickPrice != null ? f2(clickPrice) : '';

  return (
    <div className="h-screen flex flex-col bg-[#131722] text-[#d1d4dc] text-[13px] overflow-hidden" data-testid="terminal">
      {/* Top bar */}
      <div className="h-[46px] shrink-0 flex items-center gap-1 px-2.5 border-b border-[#2a2e39]">
        <Link to="/" className="p-2 rounded-md hover:bg-[#2a2e39]" aria-label="Back"><ArrowLeft className="w-4 h-4" /></Link>
        <LogoMark className="w-6 h-6" />
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol" className="h-8 px-2 rounded-md bg-transparent hover:bg-[#2a2e39] font-semibold text-white outline-none">
          {SYMBOLS.map((s) => <option key={s} value={s} className="bg-[#1e222d]">{s}</option>)}
        </select>
        <div className="w-px h-5 bg-[#2a2e39] mx-1.5" />
        {TFS.map(([t]) => (
          <button key={t} type="button" onClick={() => setTf(t)} className={`h-8 px-2.5 rounded-md transition-colors ${tf === t ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid={`tf-${t}`}>{t}</button>
        ))}
        <div className="w-px h-5 bg-[#2a2e39] mx-1.5" />
        <button type="button" onClick={() => setEditor(true)} className="h-8 px-2.5 rounded-md hover:bg-[#2a2e39] inline-flex items-center gap-1.5" data-testid="open-editor"><Pencil className="w-4 h-4" />Edit chart</button>
        <div className="flex-1" />
        <label className="h-8 px-2.5 rounded-md border border-[#2a2e39] inline-flex items-center gap-2">
          <span className="text-[#787b86]">Trade on</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent text-white font-medium outline-none" data-testid="terminal-group">
            {!groups.length && <option value="">No copy groups yet</option>}
            {groups.map((g) => <option key={g.id} value={g.id} className="bg-[#1e222d]">{g.name}</option>)}
          </select>
        </label>
        <span className={`px-2 inline-flex items-center gap-1.5 ${mt5.length && live === mt5.length ? 'text-[#089981]' : 'text-[#787b86]'}`}>
          <span className={`w-2 h-2 rounded-full ${mt5.length && live === mt5.length ? 'bg-[#089981]' : 'bg-[#5d606b]'}`} />
          {mt5.length ? `MT5 ${live}/${mt5.length}` : `${members.length} account${members.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Tool rail */}
        <div className="w-[52px] shrink-0 border-r border-[#2a2e39] flex flex-col items-center gap-1.5 pt-2.5">
          {[['cross', Crosshair, 'Crosshair'], ['hline', Minus, 'Horizontal line: click the chart']].map(([id, Icon, label]) => (
            <button key={id} type="button" aria-label={label} title={label} onClick={() => setTool(id)} className={`w-9 h-9 rounded-md flex items-center justify-center ${tool === id ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid={`tool-${id}`}><Icon className="w-5 h-5" /></button>
          ))}
          <button type="button" aria-label="Remove all lines" title="Remove all lines" onClick={() => setHlines([])} className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-[#2a2e39]"><Trash2 className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Chart */}
          <div className="relative flex-1 min-h-0">
            <div className="absolute left-3 top-2 z-10 flex items-center gap-3 pointer-events-none">
              <span className="font-semibold text-white">{symbol} · {tf}</span>
              {shown && <span className="text-[#787b86]">O <b className="font-normal text-[#d1d4dc]">{f2(shown.open)}</b> H <b className="font-normal text-[#d1d4dc]">{f2(shown.high)}</b> L <b className="font-normal text-[#d1d4dc]">{f2(shown.low)}</b> C <b className="font-normal text-[#d1d4dc]">{f2(shown.close)}</b></span>}
              {levels.length > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-[#e8c468]/15 text-[#e8c468]">Simple guess high / low (the trained model's lines replace it)</span>}
            </div>
            {!bars && <div className="absolute inset-0 flex items-center justify-center text-[#787b86] z-10">{market.error || `Loading ${symbol}${market.progress ? ` (${market.progress})` : ''}…`}</div>}
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="absolute inset-0">
                  <TerminalChart bars={bars} settings={chart?.settings} levels={levels} lines={lines} tool={tool}
                    onAddLine={(p) => setHlines((h) => [...h, p])} onPriceAt={setClickPrice} onCrosshair={setHover} />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className={MENU} data-testid="chart-menu">
                <ContextMenuItem className={ITEM} onSelect={() => setEditor(true)} data-testid="menu-edit"><Pencil className="w-4 h-4" />Edit chart with AI…</ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger className={ITEM} data-testid="menu-presets"><Palette className="w-4 h-4" />Presets</ContextMenuSubTrigger>
                  <ContextMenuSubContent className={MENU}>
                    {(chart?.presets || []).map((p) => (
                      <ContextMenuItem key={p.id} className={ITEM} onSelect={() => chartCall('preset', { id: p.id })} data-testid={`menu-preset-${p.id}`}>
                        <span className="w-[18px] h-[18px] rounded-[5px] border border-[#4a4e59]" style={{ background: `linear-gradient(135deg, ${p.settings.background} 50%, ${p.settings.up} 50%)` }} />{p.name}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator className="bg-[#2a2e39] my-1" />
                <ContextMenuItem className={ITEM} disabled={(chart?.versions?.length || 0) < 2} onSelect={() => chartCall('revert')} data-testid="menu-revert"><Undo2 className="w-4 h-4" />Revert last change</ContextMenuItem>
                <ContextMenuItem className={ITEM} onSelect={() => chartCall('preset', { id: 'dark' })}><RotateCcw className="w-4 h-4" />Reset to default</ContextMenuItem>
                {priceLabel && (
                  <>
                    <ContextMenuSeparator className="bg-[#2a2e39] my-1" />
                    <ContextMenuItem className={ITEM} onSelect={() => setHlines((h) => [...h, clickPrice])}><Minus className="w-4 h-4" />Horizontal line at {priceLabel}</ContextMenuItem>
                    <ContextMenuItem className={ITEM} onSelect={() => setTicket((t) => ({ ...t, sl: priceLabel }))}><ShieldAlert className="w-4 h-4" />Stop loss at {priceLabel}</ContextMenuItem>
                    <ContextMenuItem className={ITEM} onSelect={() => setTicket((t) => ({ ...t, tp: priceLabel }))}><Target className="w-4 h-4" />Take profit at {priceLabel}</ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          </div>

          {/* Positions */}
          <div className="h-[190px] shrink-0 border-t border-[#2a2e39] flex flex-col" data-testid="terminal-positions">
            <div className="flex items-center gap-5 px-3.5 py-2 border-b border-[#2a2e39]">
              <span className="font-semibold text-white border-b-2 border-[#2962ff] pb-1">Positions {positions.length}</span>
              <span className="ml-auto text-[11px] text-[#5d606b]">Charts by <a className="hover:text-[#787b86]" href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a></span>
              <button type="button" disabled={!positions.some((t) => t.closable)} onClick={() => place('close', { price: last })} className="px-2.5 py-0.5 rounded-md border border-[#f23645]/40 text-[#f23645] disabled:opacity-40">Close all</button>
            </div>
            <div className="overflow-y-auto">
              <div className="grid grid-cols-[1.3fr_.9fr_.6fr_.6fr_.9fr_.9fr_.9fr_.6fr] px-3.5 py-1.5 text-xs text-[#787b86]"><span>Account</span><span>Symbol</span><span>Side</span><span>Size</span><span>Entry</span><span>Stop</span><span>Target</span><span /></div>
              {!positions.length && <div className="px-3.5 py-3 text-[#5d606b]">No open positions{group ? ` on ${group.name}` : ''}.</div>}
              {positions.map((t) => (
                <div key={t.id} className="grid grid-cols-[1.3fr_.9fr_.6fr_.6fr_.9fr_.9fr_.9fr_.6fr] items-center px-3.5 py-1.5 border-t border-[#1e222d]">
                  <span className="truncate">{t.account}</span><span>{t.symbol}</span>
                  <span className={t.side === 'long' ? 'text-[#2962ff]' : 'text-[#f23645]'}>{t.side === 'long' ? 'Buy' : 'Sell'}</span>
                  <span className="tabular-nums">{t.qty}</span><span className="tabular-nums">{f2(t.entry)}</span><span className="tabular-nums">{f2(t.sl)}</span><span className="tabular-nums">{f2(t.tp)}</span>
                  <button type="button" disabled={!t.closable} title={t.closable ? '' : 'Opened by a script: it closes when the script says so'} onClick={() => place('close', { price: last, trade_id: t.trade_id })} className="h-6 rounded-md border border-[#363a45] hover:bg-[#2a2e39] disabled:opacity-40">Close</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Order ticket */}
        <div className="w-[320px] shrink-0 border-l border-[#2a2e39] p-3.5 flex flex-col gap-3 overflow-y-auto" data-testid="order-ticket">
          <div className="grid grid-cols-2 gap-2">
            {[['sell', 'SELL', 'bg-[#f23645]'], ['buy', 'BUY', 'bg-[#2962ff]']].map(([side, label, bg]) => (
              <button key={side} type="button" onClick={() => setTicket((t) => ({ ...t, side }))} data-testid={`side-${side}`}
                className={`h-[54px] rounded-[9px] ${bg} text-white text-left px-3 transition-[opacity,transform] ${ticket.side === side ? 'ring-2 ring-white/70' : 'opacity-70 hover:opacity-100'}`}>
                <div className="text-[11px] opacity-85">{label}</div><div className="text-[17px] font-semibold tabular-nums">{f2(last)}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-1 p-[3px] rounded-lg bg-[#1e222d]">
            <span className="flex-1 text-center py-1.5 rounded-md bg-[#2a2e39] text-white">Market</span>
            <span className="flex-1 text-center py-1.5 rounded-md text-[#5d606b]" title="The copier sends market orders today; limit and stop orders come with the daily model loop">Limit</span>
            <span className="flex-1 text-center py-1.5 rounded-md text-[#5d606b]" title="The copier sends market orders today; limit and stop orders come with the daily model loop">Stop</span>
          </div>
          {[['qty', 'Size (script units; accounts with a $ risk size themselves from the stop)'], ['sl', 'Stop loss'], ['tp', 'Take profit']].map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-[#787b86] text-xs">{label}
              <input value={ticket[k]} onChange={(e) => setTicket((t) => ({ ...t, [k]: e.target.value }))} inputMode="decimal" data-testid={`ticket-${k}`}
                className="h-9 px-2.5 rounded-lg bg-[#1e222d] border border-[#2a2e39] text-[#d1d4dc] text-[13px] tabular-nums outline-none focus:border-[#2962ff]" />
            </label>
          ))}
          <button type="button" disabled={!groupId || last == null} onClick={() => place(ticket.side)} data-testid="ticket-place"
            className={`h-10 rounded-[9px] text-white font-semibold disabled:opacity-40 ${ticket.side === 'buy' ? 'bg-[#2962ff]' : 'bg-[#f23645]'}`}>
            {ticket.side === 'buy' ? 'Buy' : 'Sell'} {symbol} on {group ? group.name : 'a group'}
          </button>
          {msg && <p className={`text-xs ${msg.ok ? 'text-[#089981]' : 'text-[#f23645]'}`} data-testid="ticket-msg">{msg.text}</p>}
          <p className="text-[11px] text-[#5d606b] leading-relaxed">
            Orders go to every active account in the group through the copier: the firm rules, news blocks and one-trade-per-account
            checks apply, and MT5 accounts place them through the QuantBot Copier EA.
          </p>
        </div>
      </div>

      {editor && (
        <ChartEditor chart={chart} busy={busy} onClose={() => setEditor(false)}
          onPreset={(id) => chartCall('preset', { id })} onRevert={() => chartCall('revert')} onRestore={(n) => chartCall('restore', { n })}
          onSend={async (message) => { setBusy(true); try { const r = await post('/api/terminal/chart/edit', { message }); setChart(r); return r; } finally { setBusy(false); } }} />
      )}
    </div>
  );
}
