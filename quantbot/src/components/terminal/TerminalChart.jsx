import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { moveAt, moneyAt, usdSigned } from '@/lib/tradeMath';
import { createChart, CandlestickSeries, CrosshairMode, LineStyle } from 'lightweight-charts';

// The Terminal's chart: candles drawn with TradingView's open-source Lightweight Charts (Apache 2.0, credited in the
// page footer), colored from the chart settings; the model's high / low, horizontal lines and the open positions'
// stops and targets as price lines. onPriceAt(price) reports the price under the last right-click.
export default function TerminalChart({ bars, settings, levels = [], lines = [], tool, onAddLine, onPriceAt, onCrosshair, trades = [], last = null, onModify, onCloseTrade }) {
  const box = useRef(null);
  const chart = useRef(null);
  const series = useRef(null);
  const drawn = useRef([]);

  useEffect(() => {
    const c = createChart(box.current, {
      autoSize: true,
      layout: { attributionLogo: false, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    chart.current = c;
    series.current = c.addSeries(CandlestickSeries, {});
    c.subscribeCrosshairMove((p) => {
      const d = p.seriesData?.get(series.current);
      onCrosshair?.(d && d.open != null ? d : null);
    });
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

  useEffect(() => {
    if (!series.current || !bars) return;
    const data = [];
    for (let i = 0; i < bars.time.length; i++) {
      const t = Math.floor(bars.time[i] / 1000);
      if (data.length && t <= data[data.length - 1].time) continue;
      data.push({ time: t, open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i] });
    }
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
      if (price != null) onAddLine?.(price);
    };
    chart.current.subscribeClick(onClick);
    return () => chart.current?.unsubscribeClick(onClick);
  }, [tool, onAddLine]);

  // Where each open trade's entry, stop and target sit on screen, re-read every frame (the chart scrolls and zooms)
  const [ys, setYs] = useState({ map: {}, scale: 60 });
  const [drag, setDrag] = useState(null); // { key, trade, kind: 'sl' | 'tp', price }
  const dragRef = useRef(null);
  dragRef.current = drag;
  useEffect(() => {
    let id;
    const tick = () => {
      if (series.current && chart.current) {
        const map = {};
        for (const t of trades) {
          const at = (p) => (p == null ? null : series.current.priceToCoordinate(Number(p)));
          const dragging = drag && drag.key === t.key;
          map[t.key] = { entry: at(t.entry), sl: at(dragging && drag.kind === 'sl' ? drag.price : t.sl), tp: at(dragging && drag.kind === 'tp' ? drag.price : t.tp) };
        }
        const scale = chart.current.priceScale('right').width();
        setYs((old) => (JSON.stringify(old) === JSON.stringify({ map, scale }) ? old : { map, scale }));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [trades, drag]);

  const priceAtY = (clientY) => {
    const r = box.current.getBoundingClientRect();
    const p = series.current.coordinateToPrice(clientY - r.top);
    return p == null ? null : Math.round(p * 100) / 100;
  };
  const startDrag = (e, t, kind, from) => {
    e.preventDefault(); e.stopPropagation();
    setDrag({ key: t.key, trade: t, kind, price: from });
  };
  // While dragging, the window follows the pointer (the handle can change under it, e.g. "TP" becomes the TP line)
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => { const p = priceAtY(e.clientY); if (p != null) setDrag((d) => (d ? { ...d, price: p } : d)); };
    const up = () => { const d = dragRef.current; if (d) onModify?.(d.trade, d.kind, d.price); setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [dragging]);

  const onContext = (e) => {
    const r = box.current.getBoundingClientRect();
    onPriceAt?.(series.current?.coordinateToPrice(e.clientY - r.top) ?? null);
  };

  return (
    <div className="absolute inset-0">
      <div ref={box} onContextMenu={onContext} className={`absolute inset-0 ${tool === 'hline' ? 'cursor-crosshair' : ''}`} data-testid="terminal-chart" />
      <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden" style={{ right: ys.scale }}>
        {trades.map((t) => {
          const y = ys.map[t.key];
          if (!y) return null;
          const long = t.side === 'long';
          const color = long ? '#2962ff' : '#f23645';
          const now = last != null ? moneyAt(t, last, t.accounts) : null;
          const pill = 'pointer-events-auto absolute right-3 -translate-y-1/2 flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md text-[11px] font-medium tabular-nums shadow-[0_4px_14px_rgba(0,0,0,.45)] select-none';
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
                <div className={`${pill} cursor-ns-resize touch-none transition-[box-shadow] ${isDrag ? 'ring-2 ring-white/70' : ''}`} style={{ top: yy, background: c, color: '#fff' }}
                  onPointerDown={(e) => startDrag(e, t, kind, price)}
                  data-testid={`drag-${kind}`} title="Drag to move">
                  <span>{kind.toUpperCase()} {price.toFixed(2)}</span>
                  <span className="px-1.5 rounded bg-black/20" data-testid={`drag-${kind}-move`}>{usdSigned(mv)}</span>
                  <span className="px-1.5 rounded bg-black/20" data-testid={`drag-${kind}-money`}>{usdSigned(m.total)}{t.accounts > 1 ? ` · ${t.accounts} acc` : ''}</span>
                </div>
              </div>
            );
          };
          return (
            <div key={t.key}>
              {y.entry != null && (
                <>
                  <div className="absolute left-0 right-0" style={{ top: y.entry, borderTop: `2px solid ${color}` }} />
                  <div className={pill} style={{ top: y.entry, background: '#1e222d', border: `1px solid ${color}`, color: '#d1d4dc', right: 12 }} data-testid="entry-pill">
                    <span style={{ color }}>{long ? 'Buy' : 'Sell'} {t.qty}{t.accounts > 1 ? ` × ${t.accounts}` : ''}</span>
                    <span>{Number(t.entry).toFixed(2)}</span>
                    {now && <span className={now.total >= 0 ? 'text-[#089981]' : 'text-[#f23645]'} data-testid="entry-pnl">{usdSigned(now.total)}</span>}
                    {t.closable && t.tp == null && <button type="button" onPointerDown={(e) => { const p = Math.round((Number(t.entry) + (long ? 1 : -1) * Math.max(1, Number(t.entry) * 0.002)) * 100) / 100; startDrag(e, t, 'tp', p); }} className="px-1.5 h-5 rounded bg-[#089981]/20 text-[#089981] hover:bg-[#089981]/30 cursor-ns-resize" title="Drag out a take profit" data-testid="add-tp">TP</button>}
                    {t.closable && t.sl == null && <button type="button" onPointerDown={(e) => { const p = Math.round((Number(t.entry) - (long ? 1 : -1) * Math.max(1, Number(t.entry) * 0.002)) * 100) / 100; startDrag(e, t, 'sl', p); }} className="px-1.5 h-5 rounded bg-[#f23645]/20 text-[#f23645] hover:bg-[#f23645]/30 cursor-ns-resize" title="Drag out a stop loss" data-testid="add-sl">SL</button>}
                    {t.closable && <button type="button" aria-label="Close this trade" onClick={() => onCloseTrade?.(t)} className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#f23645] hover:text-white" data-testid="entry-close"><X className="w-3.5 h-3.5" /></button>}
                  </div>
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
