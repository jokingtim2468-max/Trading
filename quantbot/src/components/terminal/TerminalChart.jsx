import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, CrosshairMode, LineStyle } from 'lightweight-charts';

// The Terminal's chart: candles drawn with TradingView's open-source Lightweight Charts (Apache 2.0, credited in the
// page footer), colored from the chart settings; the model's high / low, horizontal lines and the open positions'
// stops and targets as price lines. onPriceAt(price) reports the price under the last right-click.
export default function TerminalChart({ bars, settings, levels = [], lines = [], tool, onAddLine, onPriceAt, onCrosshair }) {
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

  const onContext = (e) => {
    const r = box.current.getBoundingClientRect();
    onPriceAt?.(series.current?.coordinateToPrice(e.clientY - r.top) ?? null);
  };

  return <div ref={box} onContextMenu={onContext} className={`absolute inset-0 ${tool === 'hline' ? 'cursor-crosshair' : ''}`} data-testid="terminal-chart" />;
}
