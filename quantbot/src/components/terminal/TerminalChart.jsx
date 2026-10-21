import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { moveAt, moneyAt, usdSigned } from '@/lib/tradeMath';
import { createChart, CandlestickSeries, LineSeries, CrosshairMode, LineStyle } from 'lightweight-charts';

export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const PENDING_NAME = { buy_limit: 'Buy limit', buy_stop: 'Buy stop', sell_limit: 'Sell limit', sell_stop: 'Sell stop' };
const DRAW_TOOLS = ['trend', 'rect', 'fib', 'position'];

// The Terminal's chart: candles drawn with TradingView's open-source Lightweight Charts (Apache 2.0, credited in the
// page footer), colored from the chart settings; the model's high / low, horizontal lines and the open positions'
// stops and targets as price lines. On top: the Terminal's own trades and pending orders (drag to move), drawings
// (trendlines, rectangles, Fibonacci) and upcoming news. onPriceAt(price) reports the price under the last right-click.
export default function TerminalChart({
  bars, settings, levels = [], lines = [], tool, onPriceAt, onCrosshair, trades = [], last = null, onModify, onCloseTrade,
  pending = [], onMovePending, onCancelPending, onBreakEven, onTrail, onHalf, trails = {},
  drawings = [], onDrawingsChange, news = [], barSec = 900, onReady, sessions = [], onToolDone, pointValue = 1, onPlacePosition, indicators = [],
}) {
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const box = useRef(null);
  const chart = useRef(null);
  const series = useRef(null);
  const drawn = useRef([]);
  const times = useRef([]);

  useEffect(() => {
    const c = createChart(box.current, {
      autoSize: true,
      layout: { attributionLogo: false, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8 },
      localization: { locale: 'en-US' }, // the browser's own tag can be invalid (e.g. en-US@posix) and crash the chart
    });
    chart.current = c;
    series.current = c.addSeries(CandlestickSeries, {});
    c.subscribeCrosshairMove((p) => {
      const d = p.seriesData?.get(series.current);
      onCrosshair?.(d && d.open != null ? d : null);
    });
    onReady?.({ screenshot: () => c.takeScreenshot().toDataURL('image/png') });
    return () => { c.remove(); chart.current = null; };
  }, []);

  // Colors and switches from the chart settings
  useEffect(() => {
    const s = settings;
    if (!chart.current || !s) return;
    const grid = { color: s.grid, visible: s.showGrid };
    chart.current.applyOptions({
      layout: { background: { color: s.background }, textColor: s.text },
      grid: { vertLines: grid, horzLines: grid },
      crosshair: { vertLine: { color: s.crosshair, labelBackgroundColor: s.crosshair }, horzLine: { color: s.crosshair, labelBackgroundColor: s.crosshair } },
      rightPriceScale: { borderColor: s.grid },
      timeScale: { borderColor: s.grid },
    });
    series.current.applyOptions({
      upColor: s.hollow ? 'rgba(0,0,0,0)' : s.up, downColor: s.down,
      borderUpColor: s.up, borderDownColor: s.down, borderVisible: true,
      wickUpColor: s.wickUp || s.up, wickDownColor: s.wickDown || s.down,
    });
  }, [settings]);

  // Indicators (Pine, or MQL5 rewritten to Pine): overlays on the price pane, the rest in one pane below
  const indSeries = useRef([]);
  useEffect(() => {
    const c = chart.current;
    if (!c || !bars) return undefined;
    for (const x of indSeries.current) { try { c.removeSeries(x); } catch { /* already gone */ } }
    indSeries.current = [];
    const keep = [];
    for (let i = 0; i < bars.time.length; i++) { const t = Math.floor(bars.time[i] / 1000); if (keep.length && t <= keep[keep.length - 1][0]) continue; keep.push([t, i]); }
    for (const ind of indicators) {
      const pane = ind.overlay ? 0 : 1;
      let first = null;
      for (const pl of ind.plots) {
        const sr = c.addSeries(LineSeries, { color: pl.color, lineWidth: pl.width || 1.5, priceLineVisible: false, lastValueVisible: true, title: pl.name, crosshairMarkerVisible: false }, pane);
        sr.setData(keep.map(([t, i]) => (Number.isFinite(pl.values[i]) ? { time: t, value: pl.values[i] } : { time: t })));
        indSeries.current.push(sr); first = first || sr;
      }
      if (first) for (const h of ind.hlines) first.createPriceLine({ price: h.price, color: h.color, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    }
    if (indicators.some((x) => !x.overlay)) c.panes()[1]?.setHeight(Math.round((box.current?.clientHeight || 400) * 0.25));
    return undefined;
  }, [indicators, bars]);

  useEffect(() => {
    if (!series.current || !bars) return;
    const data = [];
    for (let i = 0; i < bars.time.length; i++) {
      const t = Math.floor(bars.time[i] / 1000);
      if (data.length && t <= data[data.length - 1].time) continue;
      data.push({ time: t, open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i] });
    }
    times.current = data.map((d) => d.time);
    series.current.setData(data);
  }, [bars]);

  // Price lines: model levels, the trader's horizontal lines, stops and targets
  useEffect(() => {
    if (!series.current) return;
    for (const l of drawn.current) series.current.removePriceLine(l);
    const all = [
      ...(settings?.showPrediction === false ? [] : levels.map((l) => ({ ...l, color: settings?.prediction || l.color, style: LineStyle.Dashed, width: 1 }))),
      ...lines.map((l) => ({ ...l, style: l.style ?? LineStyle.Solid, width: l.width ?? 1 })),
    ];
    drawn.current = all.filter((l) => Number.isFinite(l.price)).map((l) => series.current.createPriceLine({
      price: l.price, color: l.color, lineWidth: l.width, lineStyle: l.style, axisLabelVisible: true, title: l.title || '',
    }));
  }, [levels, lines, settings]);

  // Horizontal-line tool
  useEffect(() => {
    if (!chart.current) return undefined;
    const onClick = (p) => {
      if (tool !== 'hline' || !p.point) return;
      const price = series.current.coordinateToPrice(p.point.y);
      if (price == null) return;
      const id = `D-${Date.now()}`;
      onDrawingsChange?.([...drawingsRef.current, { id, type: 'hline', price: Math.round(price * 100) / 100 }]);
      onToolDone?.();
    };
    chart.current.subscribeClick(onClick);
    return () => chart.current?.unsubscribeClick(onClick);
  }, [tool, onDrawingsChange, onToolDone]);

  // Time (s) <-> x through the bar index, so drawings and news also sit past the last bar
  const timeToX = (t) => {
    const ts = times.current, ch = chart.current;
    if (!ts.length || !ch) return null;
    let i;
    if (t >= ts[ts.length - 1]) i = ts.length - 1 + (t - ts[ts.length - 1]) / barSec;
    else if (t <= ts[0]) i = (t - ts[0]) / barSec;
    else {
      let lo = 0, hi = ts.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
      i = lo + (t - ts[lo]) / Math.max(1, ts[hi] - ts[lo]);
    }
    return ch.timeScale().logicalToCoordinate(i);
  };
  const xToTime = (x) => {
    const ts = times.current, ch = chart.current;
    const l = ch?.timeScale().coordinateToLogical(x);
    if (l == null || !ts.length) return null;
    if (l >= ts.length - 1) return Math.round(ts[ts.length - 1] + (l - ts.length + 1) * barSec);
    if (l <= 0) return Math.round(ts[0] + l * barSec);
    const lo = Math.floor(l);
    return Math.round(ts[lo] + (l - lo) * (ts[lo + 1] - ts[lo]));
  };

  // Where everything on the overlay sits on screen, re-read every frame (the chart scrolls and zooms)
  const [ys, setYs] = useState({ map: {}, pend: {}, draw: [], news: [], ses: [], scale: 60, w: 0 });
  const [drag, setDrag] = useState(null); // { key, trade, kind: 'sl' | 'tp' | 'pending', price }
  const [draft, setDraft] = useState(null); // drawing in progress
  const [picked, setPicked] = useState(null); // selected drawing id
  const [posDrag, setPosDrag] = useState(null); // { id, kind: 'tp' | 'sl' | 'entry', d, from }
  const posDragRef = useRef(null);
  posDragRef.current = posDrag;
  const [trailFor, setTrailFor] = useState(null);
  const dragRef = useRef(null);
  dragRef.current = drag;
  useEffect(() => {
    let id;
    const tick = () => {
      if (series.current && chart.current) {
        const at = (p) => (p == null ? null : series.current.priceToCoordinate(Number(p)));
        const map = {}, pend = {};
        for (const t of trades) {
          const dragging = drag && drag.key === t.key;
          map[t.key] = { entry: at(t.entry), sl: at(dragging && drag.kind === 'sl' ? drag.price : t.sl), tp: at(dragging && drag.kind === 'tp' ? drag.price : t.tp) };
        }
        for (const p of pending) pend[p.id] = at(drag && drag.key === p.id ? drag.price : p.at);
        const pt = (q) => ({ x: timeToX(q.time), y: at(q.price) });
        const draw = [...drawings, ...(draft ? [draft] : [])].map((d0) => {
          const d = posDrag && posDrag.id === d0.id ? posDrag.d : d0;
          if (d.type === 'hline') return { id: d.id, y: at(d.price) };
          if (d.type === 'position') return { id: d.id, x: timeToX(d.time), entry: at(d.entry), sl: at(d.sl), tp: at(d.tp) };
          return { id: d.id, a: pt(d.a), b: pt(d.b) };
        });
        const nx = news.map((n) => ({ ...n, x: timeToX(n.time) }));
        const ses = sessions.map((x) => ({ ...x, x1: timeToX(x.from), x2: timeToX(x.to) })).filter((x) => x.x1 != null && x.x2 != null && x.x2 > 0 && x.x1 < (box.current?.clientWidth || 0));
        const scale = chart.current.priceScale('right').width();
        const w = box.current?.clientWidth || 0;
        const next = { map, pend, draw, news: nx, ses, scale, w };
        setYs((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [trades, pending, drag, drawings, draft, news, barSec, sessions, posDrag]);

  const priceAtY = (clientY) => {
    const r = box.current.getBoundingClientRect();
    const p = series.current.coordinateToPrice(clientY - r.top);
    return p == null ? null : Math.round(p * 100) / 100;
  };
  const startDrag = (e, t, kind, from) => {
    e.preventDefault(); e.stopPropagation();
    setDrag({ key: kind === 'pending' ? t.id : t.key, trade: t, kind, price: from });
  };
  // While dragging, the window follows the pointer (the handle can change under it, e.g. "TP" becomes the TP line)
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => { const p = priceAtY(e.clientY); if (p != null) setDrag((d) => (d ? { ...d, price: p } : d)); };
    const up = () => {
      const d = dragRef.current;
      if (d) { if (d.kind === 'pending') onMovePending?.(d.trade, d.price); else onModify?.(d.trade, d.kind, d.price); }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [dragging]);

  // Drawing: press for the first point, drag, let go for the second
  const pointAt = (e) => {
    const r = box.current.getBoundingClientRect();
    const time = xToTime(e.clientX - r.left), price = priceAtY(e.clientY);
    return time == null || price == null ? null : { time, price };
  };
  const drawDown = (e) => {
    const a = pointAt(e);
    if (!a) return;
    if (tool === 'position') {
      // Stop ~3 average candles away, target at 2R; long by default (drag the handles or flip it)
      const n = bars?.time?.length || 0, k = Math.max(0, n - 50);
      let sum = 0; for (let i = k; i < n; i++) sum += bars.high[i] - bars.low[i];
      const dist = Math.max(0.01, Math.round(((n - k ? sum / (n - k) : a.price * 0.002) * 3) * 100) / 100);
      const pos = { id: `D-${Date.now()}`, type: 'position', time: a.time, entry: a.price, sl: Math.round((a.price - dist) * 100) / 100, tp: Math.round((a.price + 2 * dist) * 100) / 100, lots: '0.01' };
      onDrawingsChange?.([...drawings, pos]);
      setPicked(pos.id);
      onToolDone?.();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ id: `D-${Date.now()}`, type: tool, a, b: a });
  };
  const drawMove = (e) => { if (draft) { const b = pointAt(e); if (b) setDraft((d) => ({ ...d, b })); } };
  const drawUp = () => {
    if (draft && (draft.a.time !== draft.b.time || draft.a.price !== draft.b.price)) { onDrawingsChange?.([...drawings, draft]); onToolDone?.(); }
    setDraft(null);
  };
  const updateDrawing = (d) => onDrawingsChange?.(drawingsRef.current.map((x) => (x.id === d.id ? d : x)));
  // Position handles: drag the target, the stop, or the entry (which moves all three)
  const startPos = (e, d, kind) => {
    e.preventDefault(); e.stopPropagation();
    setPicked(d.id);
    setPosDrag({ id: d.id, kind, d, from: priceAtY(e.clientY) });
  };
  const posDragging = !!posDrag;
  useEffect(() => {
    if (!posDragging) return undefined;
    const move = (e) => {
      const p = priceAtY(e.clientY);
      if (p == null) return;
      setPosDrag((g) => {
        if (!g) return g;
        const o = drawingsRef.current.find((x) => x.id === g.id) || g.d;
        if (g.kind === 'entry') { const dv = Math.round((p - g.from) * 100) / 100; return { ...g, d: { ...o, entry: o.entry + dv, sl: o.sl + dv, tp: o.tp + dv } }; }
        return { ...g, d: { ...o, [g.kind]: p } };
      });
    };
    const up = () => { const g = posDragRef.current; if (g) updateDrawing(g.d); setPosDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [posDragging]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { setDraft(null); setPicked(null); setTrailFor(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && picked && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
        onDrawingsChange?.(drawings.filter((d) => d.id !== picked)); setPicked(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picked, drawings]);

  const onContext = (e) => {
    const r = box.current.getBoundingClientRect();
    onPriceAt?.(series.current?.coordinateToPrice(e.clientY - r.top) ?? null);
  };

  const pill = 'pointer-events-auto absolute right-3 -translate-y-1/2 flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md text-[11px] font-medium tabular-nums shadow-[0_4px_14px_rgba(0,0,0,.45)] select-none';
  const mini = 'px-1.5 h-5 rounded text-[11px] hover:bg-white/10';
  const byId = Object.fromEntries([...drawings, ...(draft ? [draft] : [])].map((d) => [d.id, d]));

  return (
    <div className="absolute inset-0">
      <div ref={box} onContextMenu={onContext} className={`absolute inset-0 ${tool === 'hline' ? 'cursor-crosshair' : ''}`} data-testid="terminal-chart" />
      {/* Drawings and news */}
      <svg className="absolute inset-0 z-[5] pointer-events-none overflow-hidden" style={{ width: Math.max(0, ys.w - ys.scale), height: '100%' }} data-testid="drawings">
        {ys.ses.map((x) => (
          <g key={`${x.name}${x.from}`} data-testid="session-box">
            <rect x={x.x1} y={0} width={Math.max(1, x.x2 - x.x1)} height="100%" fill={x.color} fillOpacity=".06" />
            <text x={x.x1 + 4} y={ys.h ? ys.h - 30 : '94%'} fill={x.color} fillOpacity=".7" fontSize="10">{x.name}</text>
          </g>
        ))}
        {ys.news.map((n) => n.x != null && n.x > 0 && n.x < ys.w - ys.scale && (
          <g key={n.key} data-testid="news-marker">
            <line x1={n.x} x2={n.x} y1={0} y2="100%" stroke="#f23645" strokeOpacity=".7" strokeDasharray="3 4" />
            <text x={n.x + 4} y={34} fill="#f23645" fontSize="10" fontWeight="600">{n.label}</text>
          </g>
        ))}
        {ys.draw.map((g) => {
          const d = byId[g.id];
          if (!d) return null;
          const sel = picked === d.id;
          const color = sel ? '#ffffff' : '#2962ff';
          const hit = { className: 'pointer-events-auto cursor-pointer', onPointerDown: (e) => { e.stopPropagation(); setPicked(d.id); } };
          if (d.type === 'hline') {
            if (g.y == null) return null;
            return <g key={d.id} data-drawing="hline"><line x1={0} x2="100%" y1={g.y} y2={g.y} stroke="transparent" strokeWidth="10" {...hit} /><line x1={0} x2="100%" y1={g.y} y2={g.y} stroke={color} strokeWidth={sel ? 2 : 1.5} /></g>;
          }
          if (d.type === 'position') {
            if (g.x == null || g.entry == null || g.sl == null || g.tp == null) return null;
            const x1 = Math.max(0, g.x), x2 = Math.min(ys.w - ys.scale, g.x + 260);
            if (x2 <= x1) return null;
            const box = (y1, y2, fill) => <rect x={x1} y={Math.min(y1, y2)} width={x2 - x1} height={Math.max(1, Math.abs(y2 - y1))} fill={fill} fillOpacity=".17" stroke={sel ? '#ffffff' : 'none'} strokeOpacity=".5" />;
            return (
              <g key={d.id} data-drawing="position" className="pointer-events-auto cursor-move" onPointerDown={(e) => startPos(e, d, 'entry')}>
                {box(g.entry, g.tp, '#089981')}{box(g.entry, g.sl, '#f23645')}
                <line x1={x1} x2={x2} y1={g.entry} y2={g.entry} stroke="#d1d4dc" strokeWidth="1.5" />
              </g>
            );
          }
          if (g.a.x == null || g.b.x == null || g.a.y == null || g.b.y == null) return null;
          if (d.type === 'trend') {
            return <g key={d.id}><line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="transparent" strokeWidth="10" {...hit} /><line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={color} strokeWidth="2" /></g>;
          }
          if (d.type === 'rect') {
            const x = Math.min(g.a.x, g.b.x), y = Math.min(g.a.y, g.b.y);
            return <rect key={d.id} x={x} y={y} width={Math.abs(g.b.x - g.a.x)} height={Math.abs(g.b.y - g.a.y)} fill="#2962ff" fillOpacity=".12" stroke={color} strokeWidth="1.5" {...hit} />;
          }
          const x1 = Math.min(g.a.x, g.b.x), x2 = Math.max(g.a.x, g.b.x) + 120;
          return (
            <g key={d.id}>
              {FIB.map((f) => {
                const price = d.b.price + (d.a.price - d.b.price) * f;
                const y = series.current?.priceToCoordinate(price);
                if (y == null) return null;
                return (
                  <g key={f}>
                    <line x1={x1} x2={x2} y1={y} y2={y} stroke={sel ? '#ffffff' : f === 0.5 || f === 0.618 ? '#e8c468' : '#787b86'} strokeWidth="1" />
                    <text x={x1 + 2} y={y - 3} fill="#9598a1" fontSize="10">{f} ({price.toFixed(2)})</text>
                  </g>
                );
              })}
              <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={color} strokeDasharray="4 4" strokeWidth="10" strokeOpacity="0.001" {...hit} />
              <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={color} strokeDasharray="4 4" />
            </g>
          );
        })}
      </svg>
      {DRAW_TOOLS.includes(tool) && (
        <div className="absolute inset-0 z-[6] cursor-crosshair touch-none" style={{ right: ys.scale }} onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} data-testid="draw-surface" />
      )}
      {picked && (() => {
        const g = ys.draw.find((x) => x.id === picked);
        const at = !g ? null : g.y !== undefined && g.a === undefined ? (g.y != null ? { x: ys.w - ys.scale - 14, y: g.y } : null)
          : g.entry !== undefined ? (g.x != null && g.tp != null ? { x: Math.max(10, g.x), y: Math.min(g.tp, g.sl) } : null)
            : g.b.x != null && g.b.y != null ? { x: g.b.x, y: g.b.y } : null;
        return at && (
          <button type="button" aria-label="Remove this drawing" onClick={() => { onDrawingsChange?.(drawings.filter((d) => d.id !== picked)); setPicked(null); }}
            className="absolute z-20 w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f23645] text-white flex items-center justify-center shadow" style={{ left: at.x, top: at.y }} data-testid="drawing-remove"><X className="w-3 h-3" /></button>
        );
      })()}
      {/* Position tool: labels with the $ at stake, the lot size and R:R, and handles to drag the target / stop.
          It never sends an order. */}
      {ys.draw.filter((g) => g.entry !== undefined && g.x != null && g.entry != null && g.sl != null && g.tp != null).map((g) => {
        const d0 = byId[g.id];
        if (!d0) return null;
        const d = posDrag && posDrag.id === d0.id ? posDrag.d : d0;
        const left = Math.max(0, g.x), width = Math.min(ys.w - ys.scale, g.x + 260) - left;
        if (width <= 40) return null;
        const lots = Number(d.lots) || 0;
        const long = d.tp >= d.entry;
        const reward = Math.abs(d.tp - d.entry), risk = Math.abs(d.entry - d.sl);
        const usd = (pts) => `$${(pts * lots * pointValue).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
        const tag = 'absolute -translate-y-1/2 px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums text-white whitespace-nowrap shadow';
        // Labels and handles stay inside the chart even when a level is scrolled or dragged off it, so they can be grabbed
        const H = box.current?.clientHeight || 0;
        const clamp = (y) => Math.max(12, Math.min(H - 12, y));
        // TradingView-style order lines: dashed line across the box, a price pill on the right you drag up / down
        const level = (y, kind, bg, price, money) => (
          <div key={kind}>
            <div className="absolute" style={{ left, width, top: y, borderTop: `1px dashed ${bg}` }} />
            <div onPointerDown={(e) => startPos(e, d, kind)} data-testid={`position-${kind}`} title="Drag to move"
              className={`${pill} cursor-ns-resize touch-none ${posDrag?.id === d.id && posDrag.kind === kind ? 'ring-2 ring-white/70' : ''}`} style={{ top: clamp(y), background: bg, color: '#fff', right: 'auto', left: Math.min(left + width + 6, ys.w - ys.scale - 190) }}>
              <span>{kind.toUpperCase()} {Number(price).toFixed(2)}</span>
              <span className="px-1.5 rounded bg-black/20">{money}</span>
            </div>
          </div>
        );
        return (
          <div key={g.id} className="absolute inset-0 z-[7] pointer-events-none overflow-hidden" style={{ right: ys.scale }} data-testid="position-tool">
            <div className={`${tag} pointer-events-auto flex items-center gap-1.5 bg-[#1e222d] border border-[#363a45]`} style={{ left, top: clamp(g.entry) }}>
              <button type="button" className="font-semibold" style={{ color: long ? '#089981' : '#f23645' }} data-testid="position-flip" title="Flip long / short"
                onClick={() => updateDrawing({ ...d, sl: 2 * d.entry - d.sl, tp: 2 * d.entry - d.tp })}>{long ? 'Long' : 'Short'}</button>
              <input value={d.lots} onChange={(e) => updateDrawing({ ...d, lots: e.target.value })} inputMode="decimal" aria-label="Position lots"
                className="w-12 bg-transparent border-b border-[#363a45] text-center outline-none" data-testid="position-lots" />
              <span className="text-[#9598a1]">lots @ {d.entry.toFixed(2)} · R:R {risk ? (reward / risk).toFixed(2) : '–'}</span>
              {onPlacePosition && (
                <button type="button" onClick={() => onPlacePosition(d)} data-testid="position-place" title="Send this trade now at market, with the stop and target the same distance away as in the box"
                  className="ml-1 px-2 h-5 rounded text-white font-semibold" style={{ background: long ? '#2962ff' : '#f23645' }}>{long ? 'Buy' : 'Sell'} {d.lots}</button>
              )}
            </div>
            {level(g.tp, 'tp', '#089981', d.tp, `+${usd(reward)}`)}
            {level(g.sl, 'sl', '#f23645', d.sl, `-${usd(risk)}`)}
          </div>
        );
      })}

      <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden" style={{ right: ys.scale }}>
        {pending.map((p) => {
          const y = ys.pend[p.id];
          if (y == null) return null;
          const buy = p.event.startsWith('buy');
          const c = buy ? '#2962ff' : '#f23645';
          const price = drag && drag.key === p.id ? drag.price : p.at;
          return (
            <div key={p.id}>
              <div className="absolute left-0 right-0" style={{ top: y, borderTop: `1px dashed ${c}` }} />
              <div className={`${pill} cursor-ns-resize touch-none`} style={{ top: y, background: '#1e222d', border: `1px dashed ${c}`, color: '#d1d4dc' }}
                onPointerDown={(e) => !e.target.closest('button') && startDrag(e, p, 'pending', p.at)} data-testid="pending-pill" title="Drag to move the order">
                <span style={{ color: c }}>{PENDING_NAME[p.event]} {p.risk_usd ? `$${p.risk_usd} risk` : p.qty}</span>
                <span>{price.toFixed(2)}</span>
                <button type="button" aria-label="Cancel this order" onClick={() => onCancelPending?.(p)} className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#f23645] hover:text-white" data-testid="pending-cancel"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          );
        })}
        {trades.map((t) => {
          const y = ys.map[t.key];
          if (!y) return null;
          const long = t.side === 'long';
          const color = long ? '#2962ff' : '#f23645';
          const now = last != null ? moneyAt(t, last, t.accounts) : null;
          const level = (kind) => {
            const isDrag = drag && drag.key === t.key && drag.kind === kind;
            const price = isDrag ? drag.price : t[kind];
            const yy = y[kind];
            if (price == null || yy == null) return null;
            const m = moneyAt(t, price, t.accounts), mv = moveAt(t, price);
            const c = kind === 'tp' ? '#089981' : '#f23645';
            return (
              <div key={kind}>
                <div className="absolute left-0 right-0" style={{ top: yy, borderTop: `1px dashed ${c}` }} />
                {/* Over the entry (stop at break-even): moves to the left so the entry pill's buttons stay reachable */}
                <div className={`${pill} cursor-ns-resize touch-none transition-[box-shadow] ${isDrag ? 'ring-2 ring-white/70' : ''}`}
                  style={{ top: yy, background: c, color: '#fff', ...(y.entry != null && Math.abs(yy - y.entry) < 16 ? { right: 'auto', left: 12 } : {}) }}
                  onPointerDown={(e) => startDrag(e, t, kind, price)}
                  data-testid={`drag-${kind}`} title="Drag to move">
                  <span>{kind.toUpperCase()} {price.toFixed(2)}{kind === 'sl' && trails[t.trade_id] ? ` · trailing ${trails[t.trade_id].dist}` : ''}</span>
                  <span className="px-1.5 rounded bg-black/20" data-testid={`drag-${kind}-move`}>{usdSigned(mv)}</span>
                  <span className="px-1.5 rounded bg-black/20" data-testid={`drag-${kind}-money`}>{usdSigned(m.total)}{t.accounts > 1 ? ` · ${t.accounts} acc` : ''}</span>
                </div>
              </div>
            );
          };
          const out = (sign) => Math.round((Number(t.entry) + sign * (long ? 1 : -1) * Math.max(1, Number(t.entry) * 0.002)) * 100) / 100;
          return (
            <div key={t.key}>
              {y.entry != null && (
                <>
                  <div className="absolute left-0 right-0" style={{ top: y.entry, borderTop: `2px solid ${color}` }} />
                  <div className={`${pill} z-[1]`} style={{ top: y.entry, background: '#1e222d', border: `1px solid ${color}`, color: '#d1d4dc', right: 12 }} data-testid="entry-pill">
                    <span style={{ color }}>{long ? 'Buy' : 'Sell'} {t.qty}{t.accounts > 1 ? ` × ${t.accounts}` : ''}</span>
                    <span>{Number(t.entry).toFixed(2)}</span>
                    {now && <span className={now.total >= 0 ? 'text-[#089981]' : 'text-[#f23645]'} data-testid="entry-pnl">{usdSigned(now.total)}</span>}
                    {t.closable && t.tp == null && <button type="button" onPointerDown={(e) => startDrag(e, t, 'tp', out(1))} className="px-1.5 h-5 rounded bg-[#089981]/20 text-[#089981] hover:bg-[#089981]/30 cursor-ns-resize" title="Drag out a take profit" data-testid="add-tp">TP</button>}
                    {t.closable && t.sl == null && <button type="button" onPointerDown={(e) => startDrag(e, t, 'sl', out(-1))} className="px-1.5 h-5 rounded bg-[#f23645]/20 text-[#f23645] hover:bg-[#f23645]/30 cursor-ns-resize" title="Drag out a stop loss" data-testid="add-sl">SL</button>}
                    {t.closable && Number(t.sl) !== Number(t.entry) && <button type="button" onClick={() => onBreakEven?.(t)} className={mini} title="Move the stop to the entry price" data-testid="entry-be">BE</button>}
                    {t.closable && <button type="button" onClick={() => setTrailFor(trailFor === t.key ? null : t.key)} className={`${mini} ${trails[t.trade_id] ? 'text-[#e8c468]' : ''}`} title="Trailing stop" data-testid="entry-trail">Trail</button>}
                    {t.closable && <button type="button" onClick={() => onHalf?.(t)} className={mini} title="Close half" data-testid="entry-half">½</button>}
                    {t.closable && <button type="button" aria-label="Close this trade" onClick={() => onCloseTrade?.(t)} className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#f23645] hover:text-white" data-testid="entry-close"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  {trailFor === t.key && (
                    <TrailBox top={y.entry + 18} current={trails[t.trade_id]?.dist} onDone={(dist) => { setTrailFor(null); if (dist != null) onTrail?.(t, dist); }} />
                  )}
                </>
              )}
              {t.closable && level('tp')}
              {t.closable && level('sl')}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// "Trail the stop N points behind the price" box under the entry pill
function TrailBox({ top, current, onDone }) {
  const [v, setV] = useState(current ? String(current) : '5');
  return (
    <div className="pointer-events-auto absolute right-3 z-20 flex items-center gap-1.5 p-1.5 rounded-lg bg-[#1e222d] border border-[#363a45] shadow-[0_10px_30px_rgba(0,0,0,.5)] text-[11px] animate-in fade-in-0 zoom-in-95 duration-pop ease-pop calm:animate-none"
      style={{ top }} data-testid="trail-box">
      <span className="text-[#9598a1]">Trail</span>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onDone(Number(v) || 0)} inputMode="decimal"
        className="w-14 h-6 px-1.5 rounded bg-[#131722] border border-[#363a45] text-center text-[#d1d4dc] outline-none focus:border-[#2962ff]" data-testid="trail-input" />
      <span className="text-[#9598a1]">points behind</span>
      <button type="button" onClick={() => onDone(Number(v) || 0)} className="px-2 h-6 rounded bg-[#2962ff] text-white" data-testid="trail-set">Set</button>
      {current && <button type="button" onClick={() => onDone(0)} className="px-2 h-6 rounded border border-[#363a45] hover:bg-[#2a2e39]">Off</button>}
    </div>
  );
}
