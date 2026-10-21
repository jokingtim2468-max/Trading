import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, createSeriesMarkers, LineStyle } from 'lightweight-charts';
import { Play, Pause, SkipForward, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SPEEDS = [5, 20, 100, 500, 2000]; // bars per second
const sec = (ms) => Math.floor(ms / 1000);
const money = (v) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
// First bar index at or after a time (bars.time is sorted)
function indexAt(times, t) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
}

// Replays the tested chart bar by bar: entries and exits appear when they happened, and the open trade shows its
// entry, stop and target lines — so you can see where and when the script trades.
export default function TradeReplay({ bars, trades, balance }) {
  const box = useRef(null);
  const chart = useRef(null);
  const series = useRef(null);
  const markers = useRef(null);
  const lines = useRef([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(20);
  const n = bars.time.length;
  const idxRef = useRef(0);

  // Trade times as bar indices, in entry order
  const tr = useMemo(() => trades.map((t) => ({ ...t, ei: indexAt(bars.time, t.entryTime), xi: indexAt(bars.time, t.exitTime) }))
    .sort((a, b) => a.ei - b.ei), [trades, bars]);
  const bar = (i) => ({ time: sec(bars.time[i]), open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i] });

  // Markers and open-trade lines for everything up to bar i
  const draw = (i) => {
    const m = [];
    for (const t of tr) {
      if (t.ei > i) break;
      const long = t.side === 'long';
      m.push({ time: sec(bars.time[t.ei]), position: long ? 'belowBar' : 'aboveBar', color: long ? '#089981' : '#f23645', shape: long ? 'arrowUp' : 'arrowDown', text: `${long ? 'Buy' : 'Sell'} ${t.lots}` });
      if (t.xi <= i) m.push({ time: sec(bars.time[t.xi]), position: long ? 'aboveBar' : 'belowBar', color: t.pnl >= 0 ? '#089981' : '#f23645', shape: 'circle', text: `${t.reason || 'exit'} ${money(t.pnl)}` });
    }
    m.sort((a, b) => a.time - b.time);
    markers.current?.setMarkers(m);
    lines.current.forEach((l) => series.current.removePriceLine(l));
    lines.current = [];
    const open = tr.find((t) => t.ei <= i && t.xi > i);
    if (open) {
      const add = (price, color, title, style = LineStyle.Solid) => Number.isFinite(price) && lines.current.push(series.current.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
      add(open.entry, '#2962ff', `${open.side === 'long' ? 'Buy' : 'Sell'} ${open.lots}`);
      add(open.sl0, '#f23645', 'SL', LineStyle.Dashed);
      add(open.tp0, '#089981', 'TP', LineStyle.Dashed);
    }
  };

  // Jump to bar i (rebuilds the chart up to it)
  const seek = (i) => {
    const to = Math.max(0, Math.min(n - 1, i));
    const data = new Array(to + 1);
    for (let k = 0; k <= to; k++) data[k] = bar(k);
    series.current.setData(data);
    idxRef.current = to; setIdx(to);
    draw(to);
    chart.current.timeScale().scrollToRealTime();
  };

  useEffect(() => {
    const fg = getComputedStyle(document.body).color;
    const c = createChart(box.current, {
      height: 380, layout: { background: { color: 'transparent' }, textColor: fg, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(128,128,128,.12)' }, horzLines: { color: 'rgba(128,128,128,.12)' } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8 }, autoSize: true,
      localization: { locale: 'en-US' }, // the browser's own tag can be invalid (e.g. en-US@posix) and crash the chart
    });
    chart.current = c;
    series.current = c.addSeries(CandlestickSeries, { upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645' });
    markers.current = createSeriesMarkers(series.current, []);
    seek(Math.min(n - 1, (tr[0]?.ei ?? 100) - 60 > 0 ? tr[0].ei - 60 : Math.min(100, n - 1))); // start just before the first trade
    return () => c.remove();
  }, [bars]);

  // Playback: a few bars per animation frame at the chosen speed
  useEffect(() => {
    if (!playing) return undefined;
    let raf, last = performance.now(), carry = 0;
    const tick = (now) => {
      carry += ((now - last) / 1000) * speed; last = now;
      const steps = Math.floor(carry); carry -= steps;
      if (steps > 0) {
        let i = idxRef.current;
        for (let s = 0; s < steps && i < n - 1; s++) { i++; series.current.update(bar(i)); }
        idxRef.current = i; setIdx(i);
        // Redraw markers/lines only when a trade opened or closed in this frame
        if (tr.some((t) => (t.ei > i - steps && t.ei <= i) || (t.xi > i - steps && t.xi <= i))) draw(i);
        if (i >= n - 1) { setPlaying(false); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const t = bars.time[idx];
  const closed = tr.filter((x) => x.xi <= idx);
  const bal = balance + closed.reduce((s, x) => s + x.pnl, 0);
  const open = tr.find((x) => x.ei <= idx && x.xi > idx);
  const next = tr.find((x) => x.ei > idx);

  return (
    <div className="space-y-2" data-testid="trade-replay">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { if (idx >= n - 1) seek(0); setPlaying((p) => !p); }} data-testid="replay-play">
          {playing ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}{playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="outline" disabled={!next} onClick={() => { setPlaying(false); seek(next.ei + 1); }} data-testid="replay-next"><SkipForward className="w-4 h-4 mr-1" />Next trade</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); seek(0); }}><RotateCcw className="w-4 h-4" /></Button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed" className="h-8 rounded-md border border-border bg-background px-2 text-sm">
          {SPEEDS.map((s) => <option key={s} value={s}>{s} bars/s</option>)}
        </select>
        <span className="text-xs text-muted-foreground tabular-nums ml-auto" data-testid="replay-status">
          {t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : ''} · balance <b className={bal >= balance ? 'text-chart-2' : 'text-destructive'}>${bal.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b> · {closed.length}/{tr.length} trades
          {open ? ` · in a ${open.side} from ${+open.entry.toFixed(5)}` : ''}
        </span>
      </div>
      <div ref={box} className="w-full rounded-lg border border-border" />
      <input type="range" min={0} max={n - 1} value={idx} aria-label="Replay position" className="w-full"
        onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} />
    </div>
  );
}
