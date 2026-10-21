import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Bell, BookOpen, Crosshair, Minus, Trash2, Pencil, Palette, Undo2, RotateCcw, ShieldAlert, Target, OctagonX,
  History, Settings2, TrendingUp, Square, Sigma, Play, Pause, StepForward, X, Clock, Ruler,
} from 'lucide-react';
import { LineStyle } from 'lightweight-charts';
import { client } from '@/api/client';
import { loadBars } from '@/lib/backtest/data';
import { POP } from '@/lib/clickOrigin';
import { groupTrades, moneyAt, usdSigned } from '@/lib/tradeMath';
import { mergeCandles, replayBars, stepPractice, closePractice, sessionBoxes } from '@/lib/terminalLive';
import { presetOf, simAccount, withDailyLimit } from '@/lib/backtest/propRules';
import AccountPicker from '@/components/scripttester/AccountPicker';
import { readPrefs, writePrefs, readDrawings, writeDrawings, chime, say, playFile } from '@/lib/terminalPrefs';
import { toBroker, brokerOffsetHours } from '../../server/market/brokerTime.js';
import LogoMark from '@/components/quant/LogoMark';
import TerminalChart from '@/components/terminal/TerminalChart';
import IndicatorsPanel from '@/components/terminal/IndicatorsPanel';
import ScriptEditor from '@/components/terminal/ScriptEditor';
import { runIndicator } from '@/lib/indicators/pine';
import ChartEditor from '@/components/terminal/ChartEditor';
import Toasts from '@/components/terminal/Toasts';
import OrderTicket from '@/components/terminal/OrderTicket';
import HoverHelp from '@/components/terminal/HoverHelp';
import BottomPanel from '@/components/terminal/BottomPanel';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const SYMBOLS = ['XAUUSD', 'US100'];
const TFS = [['M1', 2, 1], ['M5', 6, 5], ['M15', 14, 15], ['H1', 60, 60], ['H4', 200, 240], ['D1', 1500, 1440]]; // timeframe, days shown, minutes
const DAY = 86400000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '–');
const ms = (us) => (us < 1000 ? `${(us / 1000).toFixed(2)} ms` : `${(us / 1000).toFixed(1)} ms`);
const MENU = `${POP} min-w-[248px] rounded-[14px] border-[#363a45] bg-[#1e222d]/95 backdrop-blur-xl p-1.5 text-[#d1d4dc] shadow-[0_18px_48px_rgba(0,0,0,.55)]`;
const ITEM = 'h-[34px] gap-2.5 rounded-[9px] px-2.5 text-[13px] focus:bg-[#2a2e39] focus:text-white data-[state=open]:bg-[#2a2e39]';
const NAME = { buy_limit: 'Buy limit', buy_stop: 'Buy stop', sell_limit: 'Sell limit', sell_stop: 'Sell stop' };

// range: { from, to } for replay, else the timeframe's usual window up to today
function useMarket(symbol, tf, range) {
  const [state, setState] = useState({ bars: null, daily: null, error: '', progress: null, key: '' });
  const from0 = range?.from, to0 = range?.to;
  useEffect(() => {
    let live = true;
    const days = TFS.find((t) => t[0] === tf)[1];
    const to = to0 || day(Date.now()), from = from0 || day(Date.now() - days * DAY);
    setState((s) => ({ ...s, bars: null, error: '' }));
    const ds = { market: true, id: symbol, symbol };
    Promise.all([
      loadBars(ds, { tf, from, to, onProgress: (d, t) => live && setState((s) => ({ ...s, progress: t ? `${d}/${t}` : null })) }),
      loadBars(ds, { tf: 'D1', from: day(Date.parse(to) - 45 * DAY), to }),
    ]).then(([bars, daily]) => live && setState({ bars, daily, error: '', progress: null, key: `${symbol}|${tf}|${from0 || ''}|${to0 || ''}` }))
      .catch((e) => live && setState({ bars: null, daily: null, error: e.message, progress: null }));
    return () => { live = false; };
  }, [symbol, tf, from0, to0]);
  return [state, setState];
}

// Today's high / low: the local model's when it answered, else the simple guess it is tested against (today's open
// +/- half the 20-day average range)
function guessLevels(daily, upto = Infinity) {
  if (!daily) return [];
  const n = Math.min(daily.time.length, upto);
  if (n < 21) return [];
  const o = daily.open[n - 1];
  let sum = 0;
  for (let i = n - 21; i < n - 1; i++) sum += (daily.high[i] - daily.low[i]) / daily.open[i];
  const half = (sum / 20) / 2;
  return [
    { price: o * (1 + half), title: 'Guess high', color: '#e8c468' },
    { price: o * (1 - half), title: 'Guess low', color: '#e8c468' },
    { price: o, title: 'Open', color: '#787b86' },
  ];
}

// Dollars per 1.00 price move per unit: MT5 gold is 100 oz per lot, the index CFD $1 per point
const pointValueOf = (symbol, members) => (members.some((a) => a.platform === 'MT5') || !members.length ? (symbol === 'XAUUSD' ? 100 : 1) : 1);

export default function Terminal() {
  const [prefs, setPrefsState] = useState(readPrefs);
  const setPrefs = (p) => setPrefsState((old) => { const next = { ...old, ...p }; writePrefs(next); return next; });
  const [symbol, setSymbol] = useState('XAUUSD');
  const [tf, setTf] = useState('M15');
  const tfMin = TFS.find((t) => t[0] === tf)[2];
  const [replay, setReplay] = useState(null); // { date, clock (ms, the replay's 'now'), playing, speed (market seconds per second) }
  const range = useMemo(() => {
    if (!replay) return null;
    const days = TFS.find((t) => t[0] === tf)[1];
    const start = Date.parse(`${replay.date}T00:00:00Z`);
    return { from: day(start - days * DAY), to: day(Math.min(Date.now(), start + Math.max(days, 5) * DAY)) };
  }, [replay?.date, tf]);
  const [market, setMarket] = useMarket(symbol, tf, range);
  const [chart, setChart] = useState(null);
  const [tool, setTool] = useState('cross');
  const [drawings, setDrawingsState] = useState(() => readDrawings('XAUUSD'));
  const setDrawings = (list) => { setDrawingsState(list); writeDrawings(symbol, list); };
  useEffect(() => { setDrawingsState(readDrawings(symbol)); }, [symbol]);
  const [hover, setHover] = useState(null);
  const [clickPrice, setClickPrice] = useState(null);
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [book, setBook] = useState({ positions: [], pending: [], alerts: [], trails: {} });
  const positions = book.positions;
  const [ticket, setTicket] = useState({ side: 'buy', type: 'market', at: '', sizing: 'lots', qty: '0.01', risk: '250', sl: '', tp: '' });
  const [toasts, setToasts] = useState([]);
  const [guardRows, setGuardRows] = useState([]);
  const [pred, setPred] = useState(null);
  const [news, setNews] = useState([]);
  const [practice, setPractice] = useState({ open: [], closed: [] });
  // Account simulation in replay: practice trades judged by a prop firm's rules (size / firm / account type)
  const [simPick, setSimPick] = useState({ size: 10000, firm: null, model: null });
  const [simOpen, setSimOpen] = useState(false);
  const [presets, setPresets] = useState(null);
  useEffect(() => { fetch('/api/presets').then((r) => r.json()).then(setPresets).catch(() => {}); }, []);
  const simPreset = simPick.firm && simPick.model ? withDailyLimit(presetOf(presets, simPick.firm, simPick.model, simPick.size), simPick.dll !== false) : null;
  const shot = useRef(null);
  const toast = (t) => {
    setToasts((v) => [...v, { id: `${Date.now()}-${Math.random()}`, ...t }]);
    // A fill with the trader's own sound plays only that; otherwise the chime, then the voice
    if (t.filled && prefs.voice && prefs.fillSound) { playFile(prefs.fillSound); return; }
    if (prefs.sound) chime(t.kind === 'error' ? 'error' : t.kind === 'news' ? 'news' : t.kind === 'alert' ? 'alert' : 'ok');
    if (prefs.voice && t.filled) say('Order filled');
  };

  useEffect(() => { fetch('/api/terminal/chart').then((r) => r.json()).then(setChart).catch(() => {}); }, []);
  // Sunday and Monday: last week's report is ready (once a week)
  useEffect(() => {
    const d = new Date(), wd = d.getDay();
    if (wd !== 0 && wd !== 1) return;
    const key = `quantbot.weekly.${new Date(d - ((wd + 6) % 7) * 86400000).toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
    setTimeout(() => toast({ kind: 'pending', title: 'Your weekly report is ready', lines: ['Profit, best and worst setup, rule-breaks and average R', 'Open the Journal to see it or save it as a PDF'] }), 1500);
  }, []);
  const loadTrading = useCallback(async () => {
    const [g, a, p] = await Promise.all([
      client.entities.CopyGroup.list(), client.entities.TradingAccount.list(),
      fetch(`/api/terminal/positions${groupId ? `?group=${groupId}` : ''}`).then((r) => r.json()),
    ]);
    setGroups(g); setAccounts(a); setBook({ positions: p.positions || [], pending: p.pending || [], alerts: p.alerts || [], trails: p.trails || {} });
    if (!groupId && g[0]) setGroupId(g[0].id);
  }, [groupId]);
  useEffect(() => { loadTrading().catch(() => {}); const t = setInterval(() => loadTrading().catch(() => {}), 5000); return () => clearInterval(t); }, [loadTrading]);

  // Replay: start on the first bar of the chosen day
  const allBars = market.bars;
  useEffect(() => {
    // Only the replay's own bars (not the live chart's, still showing while they load)
    if (!replay || replay.clock != null || !allBars || market.key !== `${symbol}|${tf}|${range?.from}|${range?.to}`) return;
    const start = Date.parse(`${replay.date}T00:00:00Z`);
    let i = allBars.time.findIndex((t) => t >= start);
    if (i < 0) i = allBars.time.length - 1;
    setReplay((r) => r && { ...r, clock: allBars.time[Math.max(1, i)] });
  }, [allBars, replay, market.key]);
  // 1-minute bars of the replay's current day, so the forming candle moves the way the market really did
  const [minutes, setMinutes] = useState(null);
  const minuteDay = replay?.clock != null ? day(replay.clock) : null;
  useEffect(() => {
    if (!minuteDay) { setMinutes(null); return undefined; }
    let live = true;
    loadBars({ market: true, id: symbol, symbol }, { tf: 'M1', from: minuteDay, to: minuteDay }).then((b) => live && setMinutes(b)).catch(() => live && setMinutes(null));
    return () => { live = false; };
  }, [minuteDay, symbol]);
  const bars = useMemo(() => (replay?.clock != null ? replayBars(allBars, minutes, tfMin * 60000, replay.clock) : replay ? null : allBars), [allBars, minutes, replay?.clock, !!replay, tfMin]);
  const last = bars && bars.time.length ? bars.close[bars.time.length - 1] : null;
  const shown = hover || (bars && bars.time.length ? { open: bars.open.at(-1), high: bars.high.at(-1), low: bars.low.at(-1), close: last } : null);

  // Pending fills, trailing stops and alerts from the server (from MT5 ticks, or the chart's price below)
  const onBook = (r) => {
    for (const f of r.fired || []) {
      toast(f.error ? { kind: 'error', title: `${NAME[f.event]} not filled`, lines: [f.error] }
        : { kind: f.event.startsWith('buy') ? 'buy' : 'sell', filled: true, title: `${NAME[f.event]} filled`, lines: [`${f.symbol} at ${f2(f.price)} (order price ${f2(f.at)})`, `${groups.find((g) => g.id === f.group_id)?.name || ''}${f.push_us != null ? ` · sent to MT5 in ${ms(f.push_us)}` : ''}`] });
    }
    for (const m of r.moved || []) toast({ kind: 'trail', title: 'Trailing stop moved', lines: [`SL ${f2(m.sl)} · ${symbol}`] });
    for (const a of r.alerts || []) toast({ kind: 'alert', title: `${a.symbol} ${a.above ? 'rose to' : 'fell to'} ${f2(a.price)}`, lines: [`Price ${f2(a.hit)}${a.note ? ` · ${a.note}` : ''}`] });
    if ((r.fired || []).length || (r.moved || []).length || (r.alerts || []).length) loadTrading();
  };
  const onBookRef = useRef(onBook);
  onBookRef.current = onBook;

  // MT5 live: the Copier EA's ticks stream in (server-sent events) and fold into the chart; the server checks
  // pending orders, trailing stops and alerts on every tick itself. Fill times come back the same way.
  const [lane, setLane] = useState({ live: false, bid: null, ask: null, fill: null, push: null });
  const liveAt = useRef(0);
  useEffect(() => {
    if (replay) return undefined;
    const es = new EventSource('/api/terminal/stream');
    let frame = 0, pendingTick = null;
    es.addEventListener('tick', (e) => {
      const t = JSON.parse(e.data);
      if (t.symbol !== symbol) return;
      liveAt.current = Date.now();
      pendingTick = t;
      // One chart update per frame however fast the ticks come
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const x = pendingTick;
        setMarket((s) => (s.bars ? { ...s, bars: mergeCandles(s.bars, [{ time: x.time, open: x.bid, high: x.bid, low: x.bid, close: x.bid }], tfMin * 60000) } : s));
        setLane((l) => ({ ...l, live: true, bid: x.bid, ask: x.ask }));
      });
    });
    es.addEventListener('book', (e) => onBookRef.current(JSON.parse(e.data)));
    es.addEventListener('fill', (e) => { const f = JSON.parse(e.data); if (f.ms != null) setLane((l) => ({ ...l, fill: f.ms })); });
    const stale = setInterval(() => { if (Date.now() - liveAt.current > 10000) setLane((l) => (l.live ? { ...l, live: false } : l)); }, 2000);
    return () => { es.close(); cancelAnimationFrame(frame); clearInterval(stale); };
  }, [symbol, tf, !!replay]);

  // Without MT5 ticks: the latest Dukascopy minute candles every 10 s, and the chart's price goes to the server
  const lastSent = useRef(null);
  useEffect(() => {
    if (replay) return undefined;
    let live = true;
    const pull = async () => {
      if (Date.now() - liveAt.current < 10000) return;
      try {
        const q = await (await fetch(`/api/terminal/quote?symbol=${symbol}`)).json();
        if (!live || !q.candles?.length || q.source === 'mt5') return;
        setMarket((s) => (s.bars ? { ...s, bars: mergeCandles(s.bars, q.candles, tfMin * 60000) } : s));
      } catch { /* offline: keep the chart as it is */ }
    };
    pull();
    const t = setInterval(pull, 10000);
    return () => { live = false; clearInterval(t); };
  }, [symbol, tf, !!replay]);
  useEffect(() => {
    if (replay || last == null || lane.live || lastSent.current === `${symbol}|${last}`) return;
    lastSent.current = `${symbol}|${last}`;
    post('/api/terminal/tick', { symbol, price: last }).then(onBook).catch(() => {});
  }, [last, symbol, !!replay, lane.live]);

  // The local model's high / low for today (once a day per symbol), else the simple guess
  useEffect(() => {
    setPred(null);
    const d = market.daily;
    if (replay || !d || d.time.length < 10) return;
    const daily = Array.from(d.time).map((t, i) => ({ time: t, open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i] }));
    post('/api/terminal/predict', { symbol, daily }).then((p) => setPred(p)).catch((e) => setPred({ error: e.message }));
  }, [market.daily, symbol, !!replay]);
  const levels = useMemo(() => {
    if (replay) return guessLevels(market.daily, market.daily ? Array.from(market.daily.time).filter((t) => t <= (bars?.time.at(-1) ?? 0)).length : 0);
    if (pred?.high) {
      return [
        { price: pred.high, title: `Model high${pred.confidence != null ? ` ${pred.confidence}%` : ''}`, color: '#e8c468' },
        { price: pred.low, title: `Model low${pred.confidence != null ? ` ${pred.confidence}%` : ''}`, color: '#e8c468' },
        ...guessLevels(market.daily).filter((l) => l.title === 'Open'),
      ];
    }
    return guessLevels(market.daily);
  }, [market.daily, pred, replay, bars]);

  // Alerts when price touches the model's high / low (once a day each)
  const touched = useRef(new Set());
  const prevLast = useRef(null);
  useEffect(() => {
    const prev = prevLast.current;
    prevLast.current = last;
    if (replay || !prefs.levelAlerts || prev == null || last == null || prev === last) return;
    for (const l of levels.filter((x) => /high|low/i.test(x.title))) {
      const key = `${symbol}|${day(Date.now())}|${l.title}`;
      if (touched.current.has(key) || (prev - l.price) * (last - l.price) > 0) continue;
      touched.current.add(key);
      toast({ kind: 'alert', title: `${symbol} touched the ${l.title.replace(/ \d+%$/, '')}`, lines: [`${f2(l.price)} · price ${f2(last)}`] });
    }
  }, [last]);

  // Upcoming high-impact USD news: a line on the chart, and a toast 5 minutes before
  useEffect(() => {
    if (!prefs.newsMarkers && !prefs.newsToast) { setNews([]); return undefined; }
    const load = () => fetch('/api/news').then((r) => r.json()).then((j) => {
      const seen = new Set();
      setNews((j.events || []).filter((e) => e.impact === 'high' && /USD/.test(e.currency)).map((e) => {
        const at = Date.parse(e.time);
        return { key: `${e.title}|${at}`, at, time: Math.floor(toBroker(at) / 1000), title: e.title, label: `${e.title.slice(0, 26)} ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
      }).filter((e) => !seen.has(e.key) && seen.add(e.key)));
    }).catch(() => {});
    load();
    const t = setInterval(load, 10 * 60000);
    return () => clearInterval(t);
  }, [prefs.newsMarkers, prefs.newsToast]);
  const warned = useRef(new Set());
  useEffect(() => {
    if (!prefs.newsToast) return undefined;
    const check = () => {
      for (const n of news) {
        const left = n.at - Date.now();
        if (left > 0 && left <= 5 * 60000 && !warned.current.has(n.key)) {
          warned.current.add(n.key);
          toast({ kind: 'news', title: `${n.title} in ${Math.max(1, Math.round(left / 60000))} min`, lines: ['High-impact USD news: spreads widen and price can jump', 'Firms with news rules block new trades around it'] });
        }
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [news, prefs.newsToast]);

  const group = groups.find((g) => g.id === groupId);
  const members = accounts.filter((a) => a.group_id === groupId);
  const active = members.filter((a) => (a.status || 'active') === 'active');
  const mt5 = members.filter((a) => a.platform === 'MT5');
  const live = mt5.filter((a) => a.daemon_state === 'connected').length;
  const pv = pointValueOf(symbol, members);

  const tradesLive = useMemo(() => groupTrades(positions.filter((t) => t.symbol === symbol)), [positions, symbol]);
  const trades = replay ? practice.open : tradesLive;
  const entryAt = ticket.type === 'market' || replay ? last : Number(ticket.at);
  const ticketBody = (extra = {}) => ({
    event: ticket.side, symbol, price: entryAt, sl: ticket.sl, tp: ticket.tp,
    ...(ticket.sizing === 'risk' ? { risk_usd: ticket.risk, qty: 1 } : { qty: ticket.qty }), ...extra,
  });

  // Rule guard: each account's room, the ticket's size and risk per account, and where price would fail it
  useEffect(() => {
    if (replay || !groupId) { setGuardRows([]); return undefined; }
    const t = setTimeout(() => {
      post('/api/terminal/guard', { group_id: groupId, ticket: entryAt ? ticketBody() : null }).then((r) => setGuardRows(r.accounts || [])).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [groupId, ticket, entryAt != null ? Math.round(entryAt * 4) : null, positions.length, !!replay, JSON.stringify(group?.protect || null)]);
  const limitLine = useMemo(() => {
    if (replay || last == null) return null;
    const open = guardRows.filter((r) => r.open?.fail != null && r.open.symbol === symbol).map((r) => ({ r, price: r.open.fail }));
    const pick = open.length ? open : guardRows.filter((r) => r.ticket?.fail != null).map((r) => ({ r, price: r.ticket.fail }));
    if (!pick.length) return null;
    const best = pick.sort((a, b) => Math.abs(a.price - last) - Math.abs(b.price - last))[0];
    return { price: best.price, color: '#ff9800', title: `Limit ${best.r.name} · ${best.r.rule}${open.length ? '' : ' (if filled)'}`, style: LineStyle.Dashed, width: 2 };
  }, [guardRows, last, symbol, !!replay]);

  // Session boxes (Asia, London, New York) over the bars on screen, in the chart's broker time
  const sessions = useMemo(() => {
    if (!prefs.sessions || !bars?.time.length || tfMin >= 240) return [];
    const toUtc = (b) => b - brokerOffsetHours(b) * 3600000;
    return sessionBoxes(toUtc(bars.time[0]), toUtc(bars.time.at(-1))).map((x) => ({ ...x, from: Math.floor(toBroker(x.from) / 1000), to: Math.floor(toBroker(x.to) / 1000) }));
  }, [prefs.sessions, bars?.time[0], bars?.time.length, tfMin]);
  // Yesterday's high / low
  const prevDay = useMemo(() => {
    const d = market.daily;
    if (!prefs.sessions || !d || d.time.length < 2) return [];
    const i = replay && bars ? Math.max(1, Array.from(d.time).filter((t) => t <= bars.time.at(-1)).length - 1) : d.time.length - 1;
    return [{ price: d.high[i - 1], color: '#9598a1', title: 'PDH', style: LineStyle.LargeDashed }, { price: d.low[i - 1], color: '#9598a1', title: 'PDL', style: LineStyle.LargeDashed }];
  }, [market.daily, prefs.sessions, replay, bars?.time.length]);

  const lines = useMemo(() => [
    ...prevDay,
    ...(ticket.sl ? [{ price: Number(ticket.sl), color: '#f23645', title: 'SL', style: LineStyle.Dotted }] : []),
    ...(ticket.tp ? [{ price: Number(ticket.tp), color: '#089981', title: 'TP', style: LineStyle.Dotted }] : []),
    ...(ticket.type !== 'market' && ticket.at && !replay ? [{ price: Number(ticket.at), color: '#9598a1', title: ticket.type === 'limit' ? 'Limit' : 'Stop', style: LineStyle.Dotted }] : []),
    ...(limitLine ? [limitLine] : []),
    // Trades opened by scripts: plain lines (the Terminal's own trades get the draggable overlay)
    ...(replay ? [] : tradesLive.filter((t) => !t.closable).flatMap((t) => [
      { price: t.entry, color: t.side === 'long' ? '#2962ff' : '#f23645', title: `${t.side === 'long' ? 'Buy' : 'Sell'} ${t.qty}${t.accounts > 1 ? ` × ${t.accounts}` : ''}`, width: 2 },
      ...(t.sl != null ? [{ price: t.sl, color: '#f23645', title: 'SL', style: LineStyle.Dashed }] : []),
      ...(t.tp != null ? [{ price: t.tp, color: '#089981', title: 'TP', style: LineStyle.Dashed }] : []),
    ])),
  ], [ticket.sl, ticket.tp, ticket.type, ticket.at, tradesLive, limitLine, !!replay, prevDay]);

  // Live risk / reward of the ticket's stop and target across the group
  const preview = useMemo(() => {
    const n = replay ? 1 : Math.max(1, active.length);
    const sizes = guardRows.map((r) => r.ticket?.qty).filter((q) => q != null);
    const qty = ticket.sizing === 'risk' && !replay ? (sizes[0] ?? 0) : Number(ticket.qty) || 0;
    const t = { side: ticket.side === 'buy' ? 'long' : 'short', entry: entryAt, qty, point_value: pv };
    const at = (p) => (p === '' || p == null || entryAt == null ? '' : `${usdSigned(moneyAt(t, Number(p), n).total)}${n > 1 ? ` · ${n} acc` : ''}`);
    return { sl: at(ticket.sl), tp: at(ticket.tp) };
  }, [ticket, entryAt, pv, active.length, guardRows, !!replay]);

  const chartCall = async (p, body) => setChart(await post(`/api/terminal/chart/${p}`, body));
  const snap = (tradeId, kind) => setTimeout(() => {
    try { const image = shot.current?.screenshot(); if (image && tradeId) post('/api/terminal/snapshot', { trade_id: tradeId, kind, image }).catch(() => {}); } catch { /* chart gone */ }
  }, 700);

  // Practice trades in replay: nothing goes to the accounts
  const practiceOrder = (event, extra = {}) => {
    if ((event === 'buy' || event === 'sell') && sim?.status === 'failed') {
      toast({ kind: 'error', title: 'Account failed', lines: [`${sim.reason}. Pick the account again (or another date) to restart.`] });
      return;
    }
    if (event === 'buy' || event === 'sell') {
      const qty = extra.qty ? Number(extra.qty) || 1 : ticket.sizing === 'risk' && ticket.sl ? Math.floor((Number(ticket.risk) / (Math.abs(last - Number(ticket.sl)) * pv)) * 100) / 100 : Number(ticket.qty) || 1;
      const t = { key: `R-${Date.now()}`, trade_id: `R-${Date.now()}`, symbol, side: event === 'buy' ? 'long' : 'short', qty, entry: last, sl: extra.sl != null ? Number(extra.sl) : ticket.sl === '' ? null : Number(ticket.sl), tp: extra.tp != null ? Number(extra.tp) : ticket.tp === '' ? null : Number(ticket.tp), point_value: pv, accounts: 1, closable: true };
      setPractice((p) => ({ ...p, open: [...p.open, t] }));
      toast({ kind: event, filled: true, title: 'Practice order filled', lines: [`${event === 'buy' ? 'Buy' : 'Sell'} ${qty} ${symbol} at ${f2(last)}`] });
    } else if (event === 'close') {
      setPractice((p) => {
        const out = p.open.filter((t) => !extra.trade_id || t.trade_id === extra.trade_id);
        const done = out.map((t) => ({ ...closePractice(t, last), exitTime: bars?.time.at(-1) }));
        done.forEach((d) => toast({ kind: 'close', title: 'Practice trade closed', lines: [`${usdSigned(d.pnl)} at ${f2(last)}`] }));
        return { open: p.open.filter((t) => !out.includes(t)), closed: [...p.closed, ...done] };
      });
    } else if (event === 'set_sl' || event === 'set_tp') {
      const k = event === 'set_sl' ? 'sl' : 'tp';
      setPractice((p) => ({ ...p, open: p.open.map((t) => (t.trade_id === extra.trade_id ? { ...t, [k]: extra[k] } : t)) }));
    }
  };

  const place = async (event, extra = {}) => {
    if (replay) return practiceOrder(event, extra.oneClick ? { ...extra, qty: prefs.oneClickQty } : extra);
    const { oneClick, ...more } = extra;
    extra = oneClick ? { ...more, qty: prefs.oneClickQty, risk_usd: '', at: '' } : more;
    const pendingType = extra.event?.includes('_') ? extra.event : (event === 'buy' || event === 'sell') && ticket.type !== 'market' && !extra.trade_id && !oneClick ? `${event}_${ticket.type}` : null;
    // Auto bracket: a new trade without a stop gets the default stop (and a target at the default R)
    if ((event === 'buy' || event === 'sell') && prefs.bracket?.on && !extra.trade_id && !(extra.sl ?? ticket.sl)) {
      const at = pendingType ? Number(extra.at ?? ticket.at) : last, d = Number(prefs.bracket.slPts) || 5, dir = event === 'buy' ? 1 : -1;
      const r = (v) => Math.round(v * 100) / 100;
      extra = { ...extra, sl: r(at - dir * d), tp: ticket.tp || r(at + dir * d * (Number(prefs.bracket.tpR) || 2)) };
    }
    try {
      const body = { group_id: groupId, guard: prefs.guard, ...(event === 'buy' || event === 'sell' ? ticketBody({ event: pendingType || event, price: last, at: ticket.at }) : { event, symbol, price: last }), ...extra };
      const r = await post('/api/terminal/order', body);
      const where = group?.name || 'the group';
      const id = r.trade_id ? `Order ${r.trade_id}` : 'All Terminal trades';
      if (r.copied === 0) {
        toast({ kind: 'error', title: event === 'buy' || event === 'sell' ? 'Order not copied' : 'Nothing changed', lines: r.reasons?.length ? r.reasons : ['No account took it'] });
      } else if (pendingType) {
        toast({ kind: 'pending', title: `${NAME[pendingType]} placed`, lines: [`${symbol} at ${f2(Number(body.at))}`, `Fills when the price ${pendingType.endsWith('limit') ? 'comes back to it' : 'pushes through it'} · ${where}`] });
      } else {
        const title = { set_tp: 'Take profit modified', set_sl: 'Stop loss modified', close: extra.fraction ? 'Half closed' : 'Position close sent', trail: 'Trailing stop' }[event] || 'Order executed';
        const n = active.length;
        const lines = event === 'set_tp' ? [`TP ${f2(extra.tp)} · ${symbol}`, `${id} · ${where}`]
          : event === 'set_sl' ? [`SL ${f2(extra.sl)} · ${symbol}`, `${id} · ${where}`]
            : event === 'close' ? [`${symbol} at ${f2(last)}${extra.fraction ? ' · the rest stays open' : ''}`, `${id} · ${where}`]
              : event === 'trail' ? [r.trail ? `${r.trail.dist} points behind the price · ${symbol}` : 'Off', `${id} · ${where}`]
                : [`${event === 'buy' ? 'Buy' : 'Sell'} ${oneClick ? prefs.oneClickQty : ticket.sizing === 'risk' ? `$${ticket.risk} risk` : ticket.qty} ${symbol} at ${f2(last)}`, `${n} account${n === 1 ? '' : 's'} in ${where}`];
        if (r.push_us != null) { lines.push(`Checked and sent to MT5 in ${ms(r.push_us)}`); setLane((l) => ({ ...l, push: r.push_us })); }
        toast({ kind: event === 'trail' ? 'trail' : event, title, lines, filled: event === 'buy' || event === 'sell' });
        if (event === 'buy' || event === 'sell') snap(r.trade_id, 'open');
        if (event === 'close' && extra.trade_id && !extra.fraction) snap(extra.trade_id, 'close');
      }
      loadTrading();
    } catch (e) { toast({ kind: 'error', title: 'Order rejected', lines: [e.message] }); }
  };
  // Order templates: side, type, size and the stop / target as distances from the price
  const saveTemplate = (name) => {
    const e = entryAt;
    const t = { name, side: ticket.side, type: ticket.type, sizing: ticket.sizing, qty: ticket.qty, risk: ticket.risk,
      slPts: ticket.sl && e ? Math.round(Math.abs(e - Number(ticket.sl)) * 100) / 100 : null, tpPts: ticket.tp && e ? Math.round(Math.abs(Number(ticket.tp) - e) * 100) / 100 : null };
    setPrefs({ templates: [...(prefs.templates || []).filter((x) => x.name !== name), t] });
    toast({ kind: 'pending', title: 'Template saved', lines: [`${name}: ${t.side} ${t.sizing === 'risk' ? `$${t.risk} risk` : t.qty}${t.slPts ? ` · stop ${t.slPts}` : ''}${t.tpPts ? ` · target ${t.tpPts}` : ''}`] });
  };
  const applyTemplate = (t) => {
    const e = t.type === 'market' || !t.type ? last : Number(ticket.at) || last;
    const dir = t.side === 'buy' ? 1 : -1, r = (v) => String(Math.round(v * 100) / 100);
    setTicket((k) => ({ ...k, side: t.side, type: t.type || 'market', sizing: t.sizing, qty: t.qty, risk: t.risk,
      sl: t.slPts && e ? r(e - dir * t.slPts) : '', tp: t.tpPts && e ? r(e + dir * t.tpPts) : '' }));
  };
  const flatten = async () => {
    try {
      const r = await post('/api/terminal/flatten', { price: last });
      toast({ kind: 'close', title: 'Everything flattened', lines: [`${r.trades} trade${r.trades === 1 ? '' : 's'} closed on ${r.groups} group${r.groups === 1 ? '' : 's'}`, `${r.cancelled} pending order${r.cancelled === 1 ? '' : 's'} cancelled`] });
      loadTrading();
    } catch (e) { toast({ kind: 'error', title: 'Flatten failed', lines: [e.message] }); }
  };
  const addAlert = async (price) => {
    try { await post('/api/terminal/alert', { symbol, price, now: last }); toast({ kind: 'alert', title: 'Alert set', lines: [`${symbol} ${price > last ? 'rises to' : 'falls to'} ${f2(price)}`] }); loadTrading(); } catch (e) { toast({ kind: 'error', title: 'Alert not set', lines: [e.message] }); }
  };
  const pendingAt = (event, price) => place(event.split('_')[0], { event, at: price, price: last });

  // Replay: plays in real time (1x = one market second per second); practice trades are checked on every price move
  const nextBarTime = (clock) => { const t = allBars?.time; if (!t) return null; for (let k = 0; k < t.length; k++) if (t[k] > clock) return t[k]; return null; };
  const step = useCallback(() => {
    setReplay((r) => { if (!r || r.clock == null) return r; const nx = nextBarTime(r.clock); return nx == null ? { ...r, playing: false } : { ...r, clock: nx }; });
  }, [allBars]);
  useEffect(() => {
    if (!replay?.playing) return undefined;
    const TICK = 200;
    const t = setInterval(() => setReplay((r) => {
      if (!r || r.clock == null) return r;
      const end = allBars?.time.length ? allBars.time[allBars.time.length - 1] + tfMin * 60000 : r.clock;
      const clock = r.clock + TICK * r.speed;
      return clock >= end ? { ...r, clock: end - 1, playing: false } : { ...r, clock };
    }), TICK);
    return () => clearInterval(t);
  }, [replay?.playing, replay?.speed, allBars, tfMin]);
  const prevPrice = useRef(null);
  useEffect(() => {
    if (!replay || last == null) { prevPrice.current = null; return; }
    const from = prevPrice.current ?? last;
    prevPrice.current = last;
    const bar = { high: Math.max(from, last), low: Math.min(from, last), close: last };
    setPractice((p) => {
      if (!p.open.length) return p;
      const { open, closed: hit } = stepPractice(p.open, bar);
      if (!hit.length && open.every((t, k) => t === p.open[k])) return p;
      const closed = hit.map((c) => ({ ...c, exitTime: replay.clock }));
      closed.forEach((c) => toast({ kind: c.pnl >= 0 ? 'set_tp' : 'set_sl', title: c.reason === 'stop' ? 'Practice stop hit' : 'Practice target hit', lines: [`${usdSigned(c.pnl)} at ${f2(c.exit)}`] }));
      return { open, closed: [...p.closed, ...closed] };
    });
  }, [last, !!replay]);
  // The trader's indicators, run on the bars on screen
  const indicatorList = prefs.indicators || [];
  const [indicators, indicatorErrors] = useMemo(() => {
    const out = [], errs = {};
    if (!bars) return [out, errs];
    for (const x of indicatorList) {
      if (!x.on) continue;
      try { out.push({ id: x.id, ...runIndicator(x.pine, bars) }); } catch (e) { errs[x.id] = e.message; }
    }
    return [out, errs];
  }, [indicatorList, bars]);
  const sim = useMemo(() => {
    if (!replay || !simPreset) return null;
    const floating = last != null ? practice.open.reduce((x, t) => x + closePractice(t, last).pnl, 0) : 0;
    return simAccount(simPreset, practice.closed, floating, bars?.time.at(-1) ?? Date.now());
  }, [replay, simPreset, practice, last, bars?.time.length]);
  // Failing the account closes everything at the current price, the way a firm would
  const failedRef = useRef(false);
  useEffect(() => {
    if (sim?.status === 'failed' && !failedRef.current) {
      failedRef.current = true;
      setPractice((p) => ({ open: [], closed: [...p.closed, ...p.open.map((t) => ({ ...closePractice(t, last), exitTime: bars?.time.at(-1) }))] }));
      toast({ kind: 'error', title: `${simPreset.firm} ${simPreset.model} failed`, lines: [sim.reason] });
    }
    if (sim?.status !== 'failed') failedRef.current = false;
  }, [sim?.status]);
  const practiceSum = useMemo(() => ({
    open: practice.open, closed: practice.closed,
    pnl: Math.round((practice.closed.reduce((s, t) => s + t.pnl, 0) + (last != null ? practice.open.reduce((s, t) => s + closePractice(t, last).pnl, 0) : 0)) * 100) / 100,
  }), [practice, last]);

  // Keys: Alt+X flattens everything; in replay, → steps and space plays / pauses
  useEffect(() => {
    const key = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.dataset?.testid?.startsWith('hotkey-')) return;
      if (e.altKey && (e.key === 'x' || e.key === 'X') && !replay) { e.preventDefault(); flatten(); }
      // Hotkeys (changeable in the gear menu): buy / sell at the one-click size, close all, break-even, half
      if (!prefs.hotkeys || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const k = e.key.toLowerCase(), keys = prefs.keys || {};
      const mine = trades.filter((t) => t.closable);
      if (k === keys.buy) { e.preventDefault(); place('buy', { oneClick: true }); }
      else if (k === keys.sell) { e.preventDefault(); place('sell', { oneClick: true }); }
      else if (k === keys.closeAll && mine.length) { e.preventDefault(); place('close', { price: last }); }
      else if (k === keys.breakeven) mine.forEach((t) => place('set_sl', { sl: Number(t.entry), price: last, trade_id: t.trade_id }));
      else if (k === keys.half) mine.forEach((t) => place('close', { price: last, trade_id: t.trade_id, fraction: 0.5 }));
      if (replay && e.key === 'ArrowRight') { e.preventDefault(); step(); }
      if (replay && e.key === ' ') { e.preventDefault(); setReplay((r) => r && { ...r, playing: !r.playing }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const priceLabel = clickPrice != null ? f2(clickPrice) : '';
  const above = clickPrice != null && last != null && clickPrice > last;
  const tools = [['cross', Crosshair, 'Crosshair'], ['position', Ruler, 'Position: click to place a simulated long/short; drag its target and stop to see the $ at stake (never sends an order)'], ['hline', Minus, 'Horizontal line: click the chart'], ['trend', TrendingUp, 'Trendline: drag on the chart'], ['rect', Square, 'Rectangle: drag on the chart'], ['fib', Sigma, 'Fibonacci retracement: drag from the swing high to the low (or low to high)']];

  return (
    <div className="h-screen flex flex-col bg-[#131722] text-[#d1d4dc] text-[13px] overflow-hidden" data-testid="terminal">
      {/* Top bar */}
      <div className="h-[46px] shrink-0 flex items-center gap-1 px-2.5 border-b border-[#2a2e39]">
        <Link to="/" className="p-2 rounded-md hover:bg-[#2a2e39]" aria-label="Back" data-testid="back"><ArrowLeft className="w-4 h-4" /></Link>
        <LogoMark className="w-6 h-6" />
        <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setReplay((r) => r && { ...r, clock: null, playing: false }); setPractice({ open: [], closed: [] }); }} aria-label="Symbol" data-testid="symbol" className="h-8 px-2 rounded-md bg-transparent hover:bg-[#2a2e39] font-semibold text-white outline-none">
          {SYMBOLS.map((s) => <option key={s} value={s} className="bg-[#1e222d]">{s}</option>)}
        </select>
        <div className="w-px h-5 bg-[#2a2e39] mx-1.5" />
        {TFS.map(([t]) => (
          <button key={t} type="button" onClick={() => { setTf(t); setReplay((r) => r && { ...r, clock: null, playing: false }); }} className={`h-8 px-2.5 rounded-md transition-colors ${tf === t ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid={`tf-${t}`}>{t}</button>
        ))}
        <div className="w-px h-5 bg-[#2a2e39] mx-1.5" />
        <button type="button" onClick={() => setEditor(true)} className="h-8 px-2.5 rounded-md hover:bg-[#2a2e39] inline-flex items-center gap-1.5" data-testid="open-editor"><Pencil className="w-4 h-4" />Edit chart</button>
        <button type="button" onClick={() => { if (replay) { setReplay(null); setPractice({ open: [], closed: [] }); } else setReplay({ date: day(Date.now() - 30 * DAY), clock: null, playing: false, speed: 1 }); }}
          className={`h-8 px-2.5 rounded-md inline-flex items-center gap-1.5 ${replay ? 'bg-[#2962ff] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid="open-replay"><History className="w-4 h-4" />Replay</button>
        <button type="button" onClick={() => { if (!replay) setReplay({ date: day(Date.now() - 30 * DAY), clock: null, playing: false, speed: 1 }); setSimOpen(true); }} title="Practice in replay on a simulated prop firm account"
          className={`h-8 px-2.5 rounded-md inline-flex items-center gap-1.5 ${simPreset ? 'text-[#5b8def]' : ''} hover:bg-[#2a2e39]`} data-testid="open-sim-account">Prop account</button>
        <IndicatorsPanel list={indicatorList} onChange={(indicators) => setPrefs({ indicators })} bars={bars} errors={indicatorErrors} />
        <Link to="/journal" className="h-8 px-2.5 rounded-md hover:bg-[#2a2e39] inline-flex items-center gap-1.5" data-testid="open-journal"><BookOpen className="w-4 h-4" />Journal</Link>
        <div className="flex-1" />
        <label className="h-8 px-2.5 rounded-md border border-[#2a2e39] inline-flex items-center gap-2">
          <span className="text-[#787b86]">Trade on</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent text-white font-medium outline-none" data-testid="terminal-group">
            {!groups.length && <option value="">No copy groups yet</option>}
            {groups.map((g) => <option key={g.id} value={g.id} className="bg-[#1e222d]">{g.name}</option>)}
          </select>
        </label>
        <span data-testid="mt5-status" className={`px-2 inline-flex items-center gap-1.5 ${mt5.length && live === mt5.length ? 'text-[#089981]' : 'text-[#787b86]'}`}>
          <span className={`w-2 h-2 rounded-full ${mt5.length && live === mt5.length ? 'bg-[#089981]' : 'bg-[#5d606b]'}`} />
          {mt5.length ? `MT5 ${live}/${mt5.length}` : `${members.length} account${members.length === 1 ? '' : 's'}`}
        </span>
        <span data-testid="latency" className={`px-2 h-8 rounded-md inline-flex items-center gap-1.5 tabular-nums text-xs ${lane.live ? 'text-[#089981]' : 'text-[#5d606b]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${lane.live ? 'bg-[#089981] animate-pulse calm:animate-none' : 'bg-[#5d606b]'}`} />
          {lane.live ? `MT5 live ${f2(lane.bid)} / ${f2(lane.ask)}` : 'Delayed price'}
          {lane.push != null && <span className="text-[#9598a1]">· app {ms(lane.push)}</span>}
          {lane.fill != null && <span className="text-[#9598a1]">· fill {lane.fill} ms</span>}
        </span>
        <SettingsMenu prefs={prefs} setPrefs={setPrefs} />
        <button type="button" onClick={flatten} disabled={!!replay}
          className="h-8 px-3 rounded-md bg-[#f23645] text-white font-semibold inline-flex items-center gap-1.5 hover:brightness-110 disabled:opacity-40" data-testid="flatten-all"><OctagonX className="w-4 h-4" />Flatten all</button>
      </div>

      {replay && (
        <div className="h-[42px] shrink-0 flex items-center gap-2 px-3 border-b border-[#2a2e39] bg-[#1e222d] animate-in fade-in-0 slide-in-from-top-1 duration-pop ease-pop calm:animate-none" data-testid="replay-bar">
          <History className="w-4 h-4 text-[#2962ff]" /><span className="font-semibold text-white">Replay</span>
          <input type="date" value={replay.date} max={day(Date.now() - DAY)} min="2004-01-01" onChange={(e) => { if (e.target.value) { setReplay({ ...replay, date: e.target.value, clock: null, playing: false }); setPractice({ open: [], closed: [] }); } }}
            className="h-7 px-2 rounded-md bg-[#131722] border border-[#363a45] text-[#d1d4dc] outline-none [color-scheme:dark]" data-testid="replay-date" aria-label="Replay from" />
          <button type="button" onClick={() => setReplay({ ...replay, playing: !replay.playing })} aria-label={replay.playing ? 'Pause' : 'Play'} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#2a2e39]" data-testid="replay-play">{replay.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
          <button type="button" onClick={step} aria-label="Next candle" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#2a2e39]" data-testid="replay-step"><StepForward className="w-4 h-4" /></button>
          {[1, 10, 60, 300].map((s) => <button key={s} type="button" onClick={() => setReplay({ ...replay, speed: s })} className={`h-7 px-2 rounded-md text-xs ${replay.speed === s ? 'bg-[#2a2e39] text-white' : 'text-[#787b86] hover:text-white'}`}>{s}×</button>)}
          <span className="text-[#787b86] tabular-nums">{replay.clock != null ? new Date(replay.clock).toISOString().slice(0, 19).replace('T', ' ') : ''} · → next candle · space play</span>
          <span className="ml-auto tabular-nums">Practice P&L <b className={practiceSum.pnl >= 0 ? 'text-[#089981]' : 'text-[#f23645]'}>{usdSigned(practiceSum.pnl)}</b></span>
          <button type="button" onClick={() => practiceOrder('close')} disabled={!practice.open.length} data-testid="replay-close-all"
            title="Close every open practice trade at the current price"
            className="h-7 px-2.5 rounded-md text-[12px] font-medium bg-[#f23645] text-white hover:bg-[#d92d3c] disabled:opacity-30 disabled:cursor-default">
            Close all{practice.open.length ? ` (${practice.open.length})` : ''}
          </button>
          <button type="button" onClick={() => setSimOpen((o) => !o)} data-testid="sim-account-toggle"
            className={`h-7 px-2.5 rounded-md text-[12px] border ${simPreset ? 'border-[#2962ff] text-white bg-[#2962ff]/15' : 'border-[#363a45] text-[#d1d4dc] hover:bg-[#2a2e39]'}`}>
            {simPreset ? `${simPreset.firm} ${simPreset.model} $${(simPreset.size / 1000).toLocaleString()}K` : 'Simulate a prop account'}
          </button>
          <button type="button" onClick={() => { setReplay(null); setPractice({ open: [], closed: [] }); }} aria-label="Leave replay" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#2a2e39]"><X className="w-4 h-4" /></button>
        </div>
      )}
      {replay && simOpen && presets && (
        <div className="shrink-0 border-b border-[#2a2e39] bg-[#131722] p-2" data-testid="sim-account-picker">
          <AccountPicker presets={presets} value={simPick} onChange={(v) => { setSimPick(v); setPractice({ open: [], closed: [] }); }} />
          <p className="px-1 pt-1 text-[11px] text-[#787b86]">Practice trades in this replay are judged like the real account: the max-loss floor and the daily loss limit count open losses, a failed account is closed out and blocks new trades. Picking an account starts a fresh one.</p>
        </div>
      )}
      {replay && sim && (
        <div className="h-8 shrink-0 flex items-center gap-4 px-3 border-b border-[#2a2e39] bg-[#1e222d] text-[12px] tabular-nums text-[#d1d4dc]" data-testid="sim-account">
          <span className={`px-2 rounded-full text-[11px] font-semibold uppercase ${sim.status === 'failed' ? 'bg-[#f23645]/20 text-[#f23645]' : sim.status === 'passed' ? 'bg-[#089981]/20 text-[#089981]' : 'bg-[#2962ff]/20 text-[#5b8def]'}`} data-testid="sim-status">{sim.status === 'passed' ? 'Passed 🎯' : sim.status}</span>
          <span>Balance <b>${sim.balance.toLocaleString()}</b></span>
          <span>Equity <b className={sim.equity >= sim.start ? 'text-[#089981]' : 'text-[#f23645]'}>${sim.equity.toLocaleString()}</b></span>
          <span title="Max-loss floor (equity must stay above it)">Floor ${sim.floor.toLocaleString()} · room <b className={sim.roomToFloor < simPreset.max_drawdown * 0.25 ? 'text-[#ff9800]' : ''}>${sim.roomToFloor.toLocaleString()}</b></span>
          <span>Today <b className={sim.dayPnl >= 0 ? 'text-[#089981]' : 'text-[#f23645]'}>{usdSigned(sim.dayPnl)}</b>{sim.dailyLeft != null ? ` · daily loss left $${sim.dailyLeft.toLocaleString()}` : ''}</span>
          {sim.toTarget != null && <span>To target <b>${sim.toTarget.toLocaleString()}</b></span>}
          {sim.reason && <span className="text-[#9598a1] truncate">{sim.reason}</span>}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Tool rail */}
        <div className="w-[52px] shrink-0 border-r border-[#2a2e39] flex flex-col items-center gap-1.5 pt-2.5">
          {tools.map(([id, Icon, label]) => (
            <button key={id} type="button" aria-label={label} onClick={() => setTool(id)} className={`w-9 h-9 rounded-md flex items-center justify-center ${tool === id ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid={`tool-${id}`}><Icon className="w-5 h-5" /></button>
          ))}
          <button type="button" aria-label="Remove all lines and drawings" data-testid="tool-clear" onClick={() => setDrawings([])} className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-[#2a2e39]"><Trash2 className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Chart */}
          <div className="relative flex-1 min-h-0">
            <div className="absolute left-3 top-2 z-10 flex items-center gap-3 pointer-events-none">
              <span className="font-semibold text-white">{symbol} · {tf}</span>
              {shown && <span className="text-[#787b86]">O <b className="font-normal text-[#d1d4dc]">{f2(shown.open)}</b> H <b className="font-normal text-[#d1d4dc]">{f2(shown.high)}</b> L <b className="font-normal text-[#d1d4dc]">{f2(shown.low)}</b> C <b className="font-normal text-[#d1d4dc]">{f2(shown.close)}</b></span>}
              {levels.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-[#e8c468]/15 text-[#e8c468]" title={pred?.why || pred?.error || ''} data-testid="levels-chip">
                  {pred?.high ? `Model high / low · ${pred.confidence ?? '–'}% confidence` : replay ? 'Simple guess high / low for that day' : `Simple guess high / low${pred?.error ? ' (local model not answering)' : ''}`}
                </span>
              )}
            </div>
            <OneClick last={last} qty={prefs.oneClickQty} setQty={(oneClickQty) => setPrefs({ oneClickQty })} disabled={replay ? last == null : !groupId || last == null}
              onTrade={(side) => place(side, { oneClick: true })} />
            {!bars && <div className="absolute inset-0 flex items-center justify-center text-[#787b86] z-10">{market.error || `Loading ${symbol}${market.progress ? ` (${market.progress})` : ''}…`}</div>}
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="absolute inset-0">
                  <TerminalChart bars={bars} settings={chart?.settings} levels={levels} lines={lines} tool={tool} trades={trades} last={last}
                    pending={replay ? [] : book.pending.filter((p) => p.symbol === symbol)} trails={book.trails}
                    onModify={(t, kind, price) => place(kind === 'tp' ? 'set_tp' : 'set_sl', { [kind]: price, price: last, trade_id: t.trade_id })}
                    indicators={indicators}
                    onPlacePosition={(d) => { const dv = last - d.entry, r = (v) => Math.round((v + dv) * 100) / 100; place(d.tp >= d.entry ? 'buy' : 'sell', { qty: d.lots, risk_usd: '', at: '', sl: r(d.sl), tp: r(d.tp) }); }}
                    onCloseTrade={(t) => place('close', { price: last, trade_id: t.trade_id })}
                    onBreakEven={(t) => place('set_sl', { sl: Number(t.entry), price: last, trade_id: t.trade_id })}
                    onHalf={(t) => {
                      if (!replay) return place('close', { price: last, trade_id: t.trade_id, fraction: 0.5 });
                      const cut = Math.floor((t.qty / 2) * 100) / 100;
                      if (!(cut > 0)) return;
                      const piece = { ...closePractice({ ...t, qty: cut }, last), exitTime: bars?.time.at(-1) };
                      setPractice((p) => ({ open: p.open.map((x) => (x.trade_id === t.trade_id ? { ...x, qty: Math.round((x.qty - cut) * 100) / 100 } : x)), closed: [...p.closed, piece] }));
                      toast({ kind: 'close', title: 'Half closed (practice)', lines: [`${usdSigned(piece.pnl)} locked in`] });
                    }}
                    onTrail={(t, dist) => (replay ? setPractice((p) => ({ ...p, open: p.open.map((x) => (x.trade_id === t.trade_id ? { ...x, trail: dist || null } : x)) })) : place('trail', { trade_id: t.trade_id, distance: dist, price: last }))}
                    onMovePending={(p, at) => post('/api/terminal/order', { event: 'move_pending', id: p.id, at, price: last, group_id: p.group_id }).then(() => { toast({ kind: 'pending', title: `${NAME[p.event]} moved`, lines: [`${p.symbol} at ${f2(at)}`] }); loadTrading(); }).catch((e) => toast({ kind: 'error', title: 'Order not moved', lines: [e.message] }))}
                    onCancelPending={(p) => post('/api/terminal/order', { event: 'cancel', id: p.id, group_id: p.group_id }).then(() => { toast({ kind: 'close', title: `${NAME[p.event]} cancelled`, lines: [`${p.symbol} at ${f2(p.at)}`] }); loadTrading(); })}
                    drawings={drawings} onDrawingsChange={setDrawings} sessions={sessions} news={prefs.newsMarkers && !replay ? news : []} barSec={tfMin * 60}
                    onReady={(api) => { shot.current = api; }}
                    onToolDone={() => setTool('cross')} pointValue={pv} onPriceAt={setClickPrice} onCrosshair={setHover} />
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
                <ContextMenuItem className={ITEM} onSelect={() => chartCall('preset', { id: 'graybw' })}><RotateCcw className="w-4 h-4" />Reset to default</ContextMenuItem>
                {priceLabel && (
                  <>
                    <ContextMenuSeparator className="bg-[#2a2e39] my-1" />
                    {!replay && (above
                      ? <>
                        <ContextMenuItem className={ITEM} onSelect={() => pendingAt('sell_limit', clickPrice)} data-testid="menu-sell-limit"><Clock className="w-4 h-4 text-[#f23645]" />Sell limit at {priceLabel}</ContextMenuItem>
                        <ContextMenuItem className={ITEM} onSelect={() => pendingAt('buy_stop', clickPrice)} data-testid="menu-buy-stop"><Clock className="w-4 h-4 text-[#2962ff]" />Buy stop at {priceLabel}</ContextMenuItem>
                      </>
                      : <>
                        <ContextMenuItem className={ITEM} onSelect={() => pendingAt('buy_limit', clickPrice)} data-testid="menu-buy-limit"><Clock className="w-4 h-4 text-[#2962ff]" />Buy limit at {priceLabel}</ContextMenuItem>
                        <ContextMenuItem className={ITEM} onSelect={() => pendingAt('sell_stop', clickPrice)} data-testid="menu-sell-stop"><Clock className="w-4 h-4 text-[#f23645]" />Sell stop at {priceLabel}</ContextMenuItem>
                      </>)}
                    {!replay && <ContextMenuItem className={ITEM} onSelect={() => addAlert(clickPrice)} data-testid="menu-alert"><Bell className="w-4 h-4" />Alert at {priceLabel}</ContextMenuItem>}
                    <ContextMenuItem className={ITEM} onSelect={() => setHlines((h) => [...h, clickPrice])}><Minus className="w-4 h-4" />Horizontal line at {priceLabel}</ContextMenuItem>
                    <ContextMenuItem className={ITEM} onSelect={() => setTicket((t) => ({ ...t, sl: priceLabel }))}><ShieldAlert className="w-4 h-4" />Stop loss at {priceLabel}</ContextMenuItem>
                    <ContextMenuItem className={ITEM} onSelect={() => setTicket((t) => ({ ...t, tp: priceLabel }))}><Target className="w-4 h-4" />Take profit at {priceLabel}</ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          </div>

          <BottomPanel positions={positions} pending={book.pending} alerts={book.alerts} practice={practiceSum} replay={!!replay} group={group}
            onClose={(t) => place('close', { price: last, trade_id: t.trade_id })} onCloseAll={() => place('close', { price: last })}
            onCancel={(p) => post('/api/terminal/order', { event: 'cancel', id: p.id, group_id: p.group_id }).then(loadTrading)}
            onRemoveAlert={(a) => post('/api/terminal/alert', { remove: a.id }).then(loadTrading)}
            editor={<ScriptEditor list={indicatorList} onChange={(indicators) => setPrefs({ indicators })} bars={bars} />} />
        </div>

        <OrderTicket symbol={symbol} last={last} ticket={ticket} setTicket={setTicket} preview={preview} guardRows={guardRows}
          guardOn={prefs.guard} setGuardOn={(guard) => setPrefs({ guard })} group={group} activeCount={active.length} replay={!!replay}
          canPlace={replay ? last != null : !!groupId && last != null && (ticket.type === 'market' || Number(ticket.at) > 0)}
          onPlace={() => place(ticket.side)}
          onProtect={(rules) => post('/api/terminal/protect', { group_id: groupId, rules }).then(() => { toast({ kind: 'trail', title: 'Protection saved', lines: [group?.name || ''] }); loadTrading(); }).catch((e) => toast({ kind: 'error', title: 'Not saved', lines: [e.message] }))}
          templates={prefs.templates || []} onSaveTemplate={saveTemplate} onApplyTemplate={applyTemplate}
          onRemoveTemplate={(t) => setPrefs({ templates: (prefs.templates || []).filter((x) => x.name !== t.name) })} />
      </div>

      <HoverHelp />
      <Toasts items={toasts} pos={prefs.toastPos} secs={prefs.toastSecs} onClose={(id) => setToasts((v) => v.filter((x) => x.id !== id))} />
      {editor && (
        <ChartEditor chart={chart} busy={busy} onClose={() => setEditor(false)}
          onPreset={(id) => chartCall('preset', { id })} onRevert={() => chartCall('revert')} onRestore={(n) => chartCall('restore', { n })}
          onSend={async (message) => { setBusy(true); try { const r = await post('/api/terminal/chart/edit', { message }); setChart(r); return r; } finally { setBusy(false); } }} />
      )}
    </div>
  );
}

// Toasts, sounds and alerts
function SettingsMenu({ prefs, setPrefs }) {
  const Switch = ({ k, label }) => (
    <button type="button" onClick={() => setPrefs({ [k]: !prefs[k] })} className="w-full flex items-center justify-between py-1.5 text-left" aria-pressed={prefs[k]} data-testid={`pref-${k}`}>
      <span>{label}</span>
      <span className={`relative w-7 h-4 rounded-full transition-colors ${prefs[k] ? 'bg-[#2962ff]' : 'bg-[#363a45]'}`}><span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left] ${prefs[k] ? 'left-3.5' : 'left-0.5'}`} /></span>
    </button>
  );
  const corners = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Terminal settings" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#2a2e39]" data-testid="open-settings"><Settings2 className="w-4 h-4" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`${POP} w-[280px] rounded-[14px] border-[#363a45] bg-[#1e222d]/95 backdrop-blur-xl p-3.5 text-[13px] text-[#d1d4dc] shadow-[0_18px_48px_rgba(0,0,0,.55)]`} data-testid="settings-menu">
        <div className="text-xs text-[#787b86] mb-1.5">Notifications</div>
        <div className="grid grid-cols-2 gap-1 mb-2">
          {corners.map(([id, label]) => <button key={id} type="button" onClick={() => setPrefs({ toastPos: id })} className={`h-7 rounded-md text-xs ${prefs.toastPos === id ? 'bg-[#2962ff] text-white' : 'bg-[#131722] hover:bg-[#2a2e39]'}`} data-testid={`pref-pos-${id}`}>{label}</button>)}
        </div>
        <div className="flex items-center justify-between py-1.5"><span>Stay for</span>
          <span className="flex gap-1">{[3, 5, 8, 15].map((s) => <button key={s} type="button" onClick={() => setPrefs({ toastSecs: s })} className={`h-6 px-2 rounded-md text-xs ${prefs.toastSecs === s ? 'bg-[#2962ff] text-white' : 'bg-[#131722] hover:bg-[#2a2e39]'}`}>{s}s</button>)}</span>
        </div>
        <Switch k="sound" label="Sounds" />
        <Switch k="voice" label="Say “Order filled”" />
        <div className="flex items-center gap-1.5 py-1.5" data-testid="fill-sound">
          <span className="flex-1 truncate">{prefs.fillSound ? `Fill sound: ${prefs.fillSoundName || 'your file'}` : 'Fill sound: PC voice'}</span>
          <label className="h-6 px-2 rounded-md text-xs bg-[#131722] hover:bg-[#2a2e39] cursor-pointer inline-flex items-center" data-testid="fill-sound-pick">Choose…
            <input type="file" accept="audio/*" className="hidden" data-testid="fill-sound-file" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 1024 * 1024) { alert('Pick a sound under 1 MB (a short clip)'); return; }
              const r = new FileReader();
              r.onload = () => { setPrefs({ fillSound: r.result, fillSoundName: f.name, voice: true }); playFile(r.result); };
              r.readAsDataURL(f);
            }} />
          </label>
          <button type="button" onClick={() => (prefs.fillSound ? playFile(prefs.fillSound) : (chime('ok'), say('Order filled')))} className="h-6 px-2 rounded-md text-xs bg-[#131722] hover:bg-[#2a2e39]" data-testid="fill-sound-test">Test</button>
          {prefs.fillSound && <button type="button" onClick={() => setPrefs({ fillSound: '', fillSoundName: '' })} className="h-6 px-2 rounded-md text-xs bg-[#131722] hover:bg-[#2a2e39]">Reset</button>}
        </div>
        <div className="h-px bg-[#2a2e39] my-1.5" />
        <div className="text-xs text-[#787b86] my-1.5">Alerts</div>
        <Switch k="levelAlerts" label="When price touches the model's high / low" />
        <Switch k="newsMarkers" label="News lines on the chart" />
        <Switch k="newsToast" label="Toast 5 minutes before news" />
        <Switch k="sessions" label="Sessions and yesterday's high / low" />
        <div className="h-px bg-[#2a2e39] my-1.5" />
        <div className="text-xs text-[#787b86] my-1.5">Auto bracket</div>
        <button type="button" onClick={() => setPrefs({ bracket: { ...prefs.bracket, on: !prefs.bracket?.on } })} className="w-full flex items-center justify-between py-1.5 text-left" aria-pressed={!!prefs.bracket?.on} data-testid="pref-bracket">
          <span>Every new trade gets a stop and target</span>
          <span className={`relative w-7 h-4 rounded-full transition-colors ${prefs.bracket?.on ? 'bg-[#2962ff]' : 'bg-[#363a45]'}`}><span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left] ${prefs.bracket?.on ? 'left-3.5' : 'left-0.5'}`} /></span>
        </button>
        <div className="flex items-center gap-2 py-1">
          <span className="flex-1 text-[#9598a1]">Stop (points)</span>
          <input value={prefs.bracket?.slPts ?? ''} onChange={(e) => setPrefs({ bracket: { ...prefs.bracket, slPts: e.target.value } })} inputMode="decimal" className="w-14 h-6 px-1 rounded-md bg-[#131722] border border-[#363a45] text-center tabular-nums outline-none" data-testid="pref-bracket-sl" />
          <span className="text-[#9598a1]">Target (R)</span>
          <input value={prefs.bracket?.tpR ?? ''} onChange={(e) => setPrefs({ bracket: { ...prefs.bracket, tpR: e.target.value } })} inputMode="decimal" className="w-12 h-6 px-1 rounded-md bg-[#131722] border border-[#363a45] text-center tabular-nums outline-none" data-testid="pref-bracket-tp" />
        </div>
        <div className="h-px bg-[#2a2e39] my-1.5" />
        <div className="text-xs text-[#787b86] my-1.5">Hotkeys (click, then press a key)</div>
        <Switch k="hotkeys" label="Hotkeys on (single keys trade for real)" />
        <Hotkeys keys={prefs.keys || {}} onChange={(keys) => setPrefs({ keys })} />
      </PopoverContent>
    </Popover>
  );
}

// One-click trading (top left of the chart, like TradingView): Sell / size / Buy, a market order on one click
function OneClick({ last, qty, setQty, disabled, onTrade }) {
  const n = Number(qty) || 0;
  const bump = (d) => { const step = (d > 0 ? n < 1 : n <= 1) ? 0.01 : 1; setQty(String(Math.max(0.01, Math.round((n + d * step) * 100) / 100))); };
  const btn = 'h-[38px] w-[78px] flex flex-col items-center justify-center leading-none transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-40';
  return (
    <div className="absolute left-3 top-9 z-10 flex items-stretch rounded-[8px] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,.45)] border border-[#363a45] bg-[#1e222d]" data-testid="oneclick">
      <button type="button" disabled={disabled} onClick={() => onTrade('sell')} className={`${btn} bg-[#f23645] text-white`} data-testid="oneclick-sell">
        <span className="text-[13px] font-semibold tabular-nums">{f2(last)}</span><span className="text-[10px] mt-1 opacity-90">SELL</span>
      </button>
      <div className="flex items-center">
        <button type="button" onClick={() => bump(-1)} aria-label="Smaller size" className="w-5 h-full text-[#787b86] hover:text-white" data-testid="oneclick-qty-down">−</button>
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" aria-label="One-click size"
          className="w-12 h-full bg-transparent text-center text-[13px] text-[#d1d4dc] tabular-nums outline-none" data-testid="oneclick-qty" />
        <button type="button" onClick={() => bump(1)} aria-label="Bigger size" className="w-5 h-full text-[#787b86] hover:text-white" data-testid="oneclick-qty-up">+</button>
      </div>
      <button type="button" disabled={disabled} onClick={() => onTrade('buy')} className={`${btn} bg-[#2962ff] text-white`} data-testid="oneclick-buy">
        <span className="text-[13px] font-semibold tabular-nums">{f2(last)}</span><span className="text-[10px] mt-1 opacity-90">BUY</span>
      </button>
    </div>
  );
}

function Hotkeys({ keys, onChange }) {
  const [wait, setWait] = useState(null);
  const names = [['buy', 'Buy (one-click size)'], ['sell', 'Sell (one-click size)'], ['closeAll', 'Close all'], ['breakeven', 'Stops to break-even'], ['half', 'Close half']];
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 items-center" data-testid="hotkeys">
      {names.map(([id, label]) => (
        <div key={id} className="contents">
          <span className="text-[#9598a1]">{label}</span>
          <button type="button" data-testid={`hotkey-${id}`}
            onClick={() => setWait(id)}
            onKeyDown={(e) => {
              if (wait !== id) return;
              e.preventDefault(); e.stopPropagation();
              const k = e.key === 'Escape' || e.key === 'Backspace' ? '' : e.key.toLowerCase();
              if (k.length > 1 && !/^f\d+$/.test(k)) return;
              onChange({ ...keys, [id]: k });
              setWait(null);
            }}
            className={`min-w-[44px] h-6 px-2 rounded-md text-xs uppercase ${wait === id ? 'bg-[#2962ff] text-white' : 'bg-[#131722] hover:bg-[#2a2e39]'}`}>
            {wait === id ? '…' : keys[id] || 'off'}
          </button>
        </div>
      ))}
    </div>
  );
}
