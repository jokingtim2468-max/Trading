// One chart cell of the layout: candles, volume, indicators, drawings,
// MT5 period separators / ask line, legend and the SELL/BUY panel.
import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, HistogramSeries,
  CrosshairMode, PriceScaleMode, LineStyle, createSeriesMarkers,
} from 'lightweight-charts';
import { TIMEFRAMES } from './symbols.js';
import { BUILTINS } from './indicators.js';
import { compilePine } from './pine.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const tfSeconds = (tf) => TIMEFRAMES.find(([n]) => n === tf)?.[1] ?? 3600;

export function heikinAshi(bars) {
  const out = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  });
  return out;
}

// Splits a quote into small / big / fractional parts the way the MT5
// one-click panel and TradingView's buy/sell buttons emphasise the pips.
export function quoteParts(price, digits) {
  const s = price.toFixed(digits);
  const fractional = digits === 3 || digits === 5;
  const sup = fractional ? s.slice(-1) : '';
  const body = fractional ? s.slice(0, -1) : s;
  let n = 0, cut = body.length;
  while (cut > 0 && n < 2) { cut--; if (body[cut] !== '.') n++; }
  return { small: body.slice(0, cut), big: body.slice(cut), sup };
}

const quoteHtml = (price, digits) => {
  if (!Number.isFinite(price)) return '—';
  const q = quoteParts(price, digits);
  return `${q.small}<em>${q.big}</em>${q.sup ? `<sup>${q.sup}</sup>` : ''}`;
};

export class ChartPane {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg; // { symbol, tf, indicators: [] } — persisted by the app
    this.bars = [];
    this.tick = null;
    this.indSeries = [];
    this.indSpecs = [];

    this.el = document.createElement('div');
    this.el.className = 'cell';
    this.el.innerHTML = `
      <div class="cell-legend">
        <div class="lg-title"><button class="lg-sym" title="Change symbol"></button><span class="lg-meta"></span><span class="lg-ohlc"></span></div>
        <div class="tw">
          <button class="tw-btn tw-sell"><span class="tw-label">SELL</span><span class="tw-px"></span></button>
          <span class="tw-spread"></span>
          <button class="tw-btn tw-buy"><span class="tw-label">BUY</span><span class="tw-px"></span></button>
        </div>
        <div class="lg-inds"></div>
      </div>
      <div class="cell-chart"></div>
      <svg class="cell-draw"></svg>`;
    this.q = (s) => this.el.querySelector(s);
    this.svg = this.q('.cell-draw');
    this.chart = createChart(this.q('.cell-chart'), { autoSize: true });

    this.el.addEventListener('mousedown', () => app.setActive(this), true);
    this.q('.lg-sym').onclick = () => app.openSymbolSearch();
    this.q('.tw-sell').onclick = (e) => { e.stopPropagation(); app.handOffTrade(this.cfg.symbol, 'SELL'); };
    this.q('.tw-buy').onclick = (e) => { e.stopPropagation(); app.handOffTrade(this.cfg.symbol, 'BUY'); };
    this.q('.lg-inds').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'), ed = e.target.closest('[data-edit]');
      if (rm) { this.cfg.indicators.splice(+rm.dataset.rm, 1); this.rebuildIndicators(); app.persistLayout(); }
      if (ed) app.editIndicator(this, +ed.dataset.edit);
    });
    this.svg.addEventListener('click', (e) => this.onDrawClick(e));

    this.chart.subscribeCrosshairMove((p) => { this.showHoverOhlc(p); app.syncCrosshair(this, p); });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => { this.scheduleOverlay(); app.syncTime(this); });
    this.resizeObs = new ResizeObserver(() => requestAnimationFrame(() => { this.applyInitialView(); this.scheduleOverlay(); }));
    this.resizeObs.observe(this.el);
  }

  get settings() { return this.app.settings; }
  get info() { return this.app.symbolInfo(this.cfg.symbol); }
  get digits() { return this.tick?.digits ?? this.info?.digits ?? 2; }

  // ---------- options / series ----------
  applyOptions() {
    const s = this.settings;
    this.chart.applyOptions({
      layout: { background: { color: s.background }, textColor: s.textColor, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font'), panes: { separatorColor: s.gridColor, separatorHoverColor: s.gridColor } },
      grid: { vertLines: { color: s.gridColor }, horzLines: { color: s.gridColor } },
      crosshair: { mode: s.crosshair === 'Magnet' ? CrosshairMode.Magnet : CrosshairMode.Normal },
      rightPriceScale: { borderColor: s.gridColor, mode: s.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: s.gridColor, timeVisible: true, secondsVisible: false, rightOffset: s.chartShift ? 10 : 2, shiftVisibleRangeOnNewBar: s.autoScroll },
      localization: s.timezone === 'UTC' ? { timeFormatter: (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') } : {},
    });
    this.q('.tw').classList.toggle('hidden', !s.showTradeWidget);
    if (this.bars.length) { this.buildMainSeries(); this.setMainData(); this.rebuildIndicators(); }
  }

  buildMainSeries() {
    if (this.main) this.chart.removeSeries(this.main);
    if (this.vol) { this.chart.removeSeries(this.vol); this.vol = null; }
    this.askLine = null;
    const s = this.settings, t = s.chartType, d = this.digits;
    const priceFormat = { type: 'price', precision: d, minMove: 1 / 10 ** d };
    const common = { priceFormat, priceLineVisible: s.showBidLine, lastValueVisible: true };
    const candle = { upColor: s.upColor, downColor: s.downColor, borderUpColor: s.upBorder, borderDownColor: s.downBorder, wickUpColor: s.upBorder, wickDownColor: s.downBorder, borderVisible: true };
    if (t === 'Candles' || t === 'Heikin Ashi') this.main = this.chart.addSeries(CandlestickSeries, { ...common, ...candle });
    else if (t === 'Hollow candles') this.main = this.chart.addSeries(CandlestickSeries, { ...common, ...candle, upColor: 'transparent' });
    else if (t === 'Bars') this.main = this.chart.addSeries(BarSeries, { ...common, upColor: s.upBorder, downColor: s.downBorder, thinBars: false });
    else if (t === 'Line') this.main = this.chart.addSeries(LineSeries, { ...common, color: this.app.accent(), lineWidth: 2 });
    else if (t === 'Area') this.main = this.chart.addSeries(AreaSeries, { ...common, lineColor: this.app.accent(), topColor: this.app.accent() + '55', bottomColor: this.app.accent() + '05', lineWidth: 2 });
    else this.main = this.chart.addSeries(BaselineSeries, { ...common, topLineColor: s.upBorder, bottomLineColor: s.downBorder, topFillColor1: s.upBorder + '33', bottomFillColor2: s.downBorder + '33' });
    this.markers = createSeriesMarkers(this.main, []);
    if (s.showVolume) {
      this.vol = this.chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      this.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
  }

  barData(b) {
    return ['Line', 'Area', 'Baseline'].includes(this.settings.chartType) ? { time: b.time, value: b.close } : b;
  }

  setMainData() {
    const s = this.settings;
    const bars = s.chartType === 'Heikin Ashi' ? heikinAshi(this.bars) : this.bars;
    this.main.setData(bars.map((b) => this.barData(b)));
    if (s.chartType === 'Baseline' && bars.length) this.main.applyOptions({ baseValue: { type: 'price', price: bars[Math.floor(bars.length / 2)].close } });
    this.vol?.setData(this.bars.map((b) => this.volData(b)));
  }

  volData(b) {
    const up = b.close >= b.open, s = this.settings;
    return { time: b.time, value: b.volume, color: (up ? s.upBorder : s.downBorder) + '55' };
  }

  arrays() {
    const b = this.bars;
    return { open: b.map((x) => x.open), high: b.map((x) => x.high), low: b.map((x) => x.low), close: b.map((x) => x.close), volume: b.map((x) => x.volume) };
  }

  // ---------- data ----------
  async load() {
    const { symbol, tf } = this.cfg;
    const token = (this.loadToken = Symbol());
    const bars = await this.app.client.bars(symbol, tf, tfSeconds(tf), +this.settings.maxBars);
    if (token !== this.loadToken) return; // a newer load superseded this one
    this.bars = bars;
    this.tick = null;
    this.buildMainSeries();
    this.setMainData();
    this.rebuildIndicators();
    this.needsInitialView = true;
    this.applyInitialView();
    this.renderTitle();
    this.renderQuote();
    this.scheduleOverlay();
  }

  // TradingView's default zoom, scrolled to the latest bar. Deferred until the
  // cell has been laid out, since a zero-width chart clamps the bar spacing.
  applyInitialView() {
    if (!this.needsInitialView || !this.bars.length || this.chart.timeScale().width() === 0) return;
    this.needsInitialView = false;
    this.chart.timeScale().applyOptions({ barSpacing: 7 });
    this.chart.timeScale().scrollToRealTime();
  }

  setSymbol(symbol) { this.cfg.symbol = symbol; return this.load(); }
  setTf(tf) { this.cfg.tf = tf; return this.load(); }

  onTick(t) {
    if (!this.bars.length || t.symbol !== this.cfg.symbol) return;
    this.tick = t;
    const sec = tfSeconds(this.cfg.tf);
    const barTime = Math.floor(t.time / sec) * sec;
    const last = this.bars.at(-1);
    const px = t.bid;
    let newBar = false;
    if (barTime === last.time) Object.assign(last, { close: px, high: Math.max(last.high, px), low: Math.min(last.low, px), volume: last.volume + 1 });
    else if (barTime > last.time) { this.bars.push({ time: barTime, open: px, high: px, low: px, close: px, volume: 1 }); newBar = true; }
    else return;
    if (this.settings.chartType === 'Heikin Ashi') this.setMainData();
    else { this.main.update(this.barData(this.bars.at(-1))); this.vol?.update(this.volData(this.bars.at(-1))); }
    this.updateAskLine();
    this.updateIndicatorData();
    this.renderQuote();
    if (newBar) this.scheduleOverlay();
  }

  updateAskLine() {
    if (!this.tick || !this.settings.showAskLine) { if (this.askLine) { this.main.removePriceLine(this.askLine); this.askLine = null; } return; }
    const opts = { price: this.tick.ask, color: '#F23645', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Ask' };
    if (this.askLine) this.askLine.applyOptions(opts);
    else this.askLine = this.main.createPriceLine(opts);
  }

  // ---------- indicators ----------
  computeIndicator(ind, arrays) {
    if (ind.kind === 'builtin') {
      const def = BUILTINS[ind.name];
      if (!def) throw new Error('Unknown indicator');
      return { plots: def.calc(arrays, ind.params), overlay: def.pane === 'main', hlines: (def.levels || []).map((price) => ({ price })), markers: [], title: ind.name };
    }
    const sc = this.app.scripts.find((s) => s.id === ind.scriptId);
    if (!sc) throw new Error('Script was deleted');
    const r = compilePine(sc.code, arrays, ind.params || {});
    return { plots: r.plots, overlay: r.overlay, hlines: r.hlines, markers: r.markers, title: r.title };
  }

  rebuildIndicators() {
    this.indSeries.forEach((s) => this.chart.removeSeries(s));
    this.indSeries = [];
    this.indSpecs = [];
    const arrays = this.arrays();
    let pane = 1;
    this.cfg.indicators.forEach((ind, idx) => {
      let r;
      try { r = this.computeIndicator(ind, arrays); }
      catch (e) { this.app.log(`${ind.name}: ${e.message}`); this.indSpecs.push({ idx, error: e.message, series: [] }); return; }
      const paneIndex = r.overlay ? 0 : pane++;
      const series = r.plots.map((p, i) => {
        const S = p.type === 'histogram' ? HistogramSeries : LineSeries;
        const s = this.chart.addSeries(S, { color: p.color, lineWidth: p.width || 1.5, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, paneIndex);
        if (i === 0) r.hlines.forEach((h) => s.createPriceLine({ price: h.price, color: h.color || this.settings.textColor + '88', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
        this.indSeries.push(s);
        return s;
      });
      this.indSpecs.push({ idx, title: r.title, series });
    });
    this.updateIndicatorData();
    this.renderIndicatorLegend();
  }

  updateIndicatorData() {
    const now = Date.now();
    if (this.lastIndCalc && now - this.lastIndCalc < 900 && this.tick) return; // cap at ~1 recompute/s
    this.lastIndCalc = now;
    const arrays = this.arrays();
    const markers = [];
    for (const spec of this.indSpecs) {
      if (spec.error) continue;
      let r;
      try { r = this.computeIndicator(this.cfg.indicators[spec.idx], arrays); } catch { continue; }
      r.plots.forEach((p, i) => spec.series[i]?.setData(this.bars.map((b, j) => (Number.isFinite(p.data[j])
        ? { time: b.time, value: p.data[j], ...(p.type === 'histogram' ? { color: p.data[j] >= 0 ? '#26A69A99' : '#EF535099' } : {}) }
        : { time: b.time }))));
      r.markers.forEach((m) => this.bars[m.index] && markers.push({ time: this.bars[m.index].time, position: m.position, color: m.color, shape: m.shape, text: m.text }));
    }
    this.markers?.setMarkers(markers.sort((a, b) => a.time - b.time));
  }

  renderIndicatorLegend() {
    this.q('.lg-inds').innerHTML = this.indSpecs.map(({ idx, title, error }) => {
      const ind = this.cfg.indicators[idx];
      const params = ind.kind === 'builtin' ? Object.values(ind.params).join(' ') : Object.values(ind.params || {}).join(' ');
      return `<div class="lg-ind${error ? ' err' : ''}"><span>${esc(title || ind.name)}${params ? ` <i>${esc(params)}</i>` : ''}${error ? ` <i>— ${esc(error)}</i>` : ''}</span>
        <button data-edit="${idx}" title="Settings">${ICON.gear}</button><button data-rm="${idx}" title="Remove">${ICON.close}</button></div>`;
    }).join('');
  }

  // ---------- legend / quote ----------
  renderTitle() {
    const { symbol, tf } = this.cfg;
    this.q('.lg-sym').textContent = symbol;
    this.q('.lg-meta').textContent = `${tf} · ${this.app.client.connected ? 'MT5' : 'Demo'}`;
    this.showHoverOhlc({});
  }

  showHoverOhlc(p) {
    if (!this.settings.showOHLC) { this.q('.lg-ohlc').innerHTML = ''; return; }
    const b = (p.time && this.bars.find((x) => x.time === p.time)) || this.bars.at(-1);
    if (!b) return;
    const d = this.digits, cls = b.close >= b.open ? 'up' : 'down';
    const chg = b.close - b.open;
    this.q('.lg-ohlc').innerHTML = ['O', 'H', 'L', 'C'].map((k, i) => `${k}<b class="${cls}">${[b.open, b.high, b.low, b.close][i].toFixed(d)}</b>`).join(' ') +
      ` <b class="${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(d)} (${((chg / b.open) * 100).toFixed(2)}%)</b>`;
  }

  renderQuote() {
    const t = this.tick;
    const last = this.bars.at(-1);
    const d = this.digits;
    const bid = t?.bid ?? last?.close, ask = t?.ask ?? NaN;
    const prev = this.prevQuote || {};
    const dir = (now, before) => (before == null || now === before ? '' : now > before ? 'tick-up' : 'tick-down');
    const sell = this.q('.tw-sell .tw-px'), buy = this.q('.tw-buy .tw-px');
    sell.innerHTML = quoteHtml(bid, d);
    buy.innerHTML = quoteHtml(ask, d);
    sell.className = `tw-px ${dir(bid, prev.bid)}`;
    buy.className = `tw-px ${dir(ask, prev.ask)}`;
    const point = t?.point ?? 10 ** -d;
    this.q('.tw-spread').textContent = Number.isFinite(ask) ? Math.round((ask - bid) / point) : '';
    this.q('.tw-sell').title = this.q('.tw-buy').title = `Opens ${this.cfg.symbol} on TradingView to trade with your FTMO account`;
    this.prevQuote = { bid, ask };
  }

  // ---------- drawings / overlay ----------
  scheduleOverlay() {
    if (this.overlayQueued) return;
    this.overlayQueued = true;
    requestAnimationFrame(() => { this.overlayQueued = false; this.redrawOverlay(); });
  }

  onDrawClick(e) {
    const tool = this.app.tool;
    if (tool === 'cursor' || !this.main) return;
    const r = this.svg.getBoundingClientRect();
    const p = { time: this.chart.timeScale().coordinateToTime(e.clientX - r.left), price: this.main.coordinateToPrice(e.clientY - r.top) };
    if (p.time == null || p.price == null) return;
    const list = this.app.drawingsFor(this.cfg.symbol);
    if (tool === 'hline' || tool === 'vline') { list.push({ t: tool, a: p }); this.app.drawingsChanged(this.cfg.symbol); this.app.setTool('cursor'); return; }
    if (!this.pending) { this.pending = p; return; }
    list.push({ t: tool, a: this.pending, b: p });
    this.pending = null;
    this.app.drawingsChanged(this.cfg.symbol);
    this.app.setTool('cursor');
  }

  redrawOverlay() {
    if (!this.main) return;
    const ts = this.chart.timeScale();
    const X = (t) => ts.timeToCoordinate(t), Y = (p) => this.main.priceToCoordinate(p);
    const W = this.svg.clientWidth, H = this.svg.clientHeight;
    const line = this.app.accent();
    let h = '';
    if (this.settings.showPeriodSeparators) {
      const tf = tfSeconds(this.cfg.tf);
      const key = tf < 14400 ? (t) => Math.floor(t / 86400) : tf < 86400 ? (t) => Math.floor((t / 86400 + 3) / 7) : tf < 604800 ? (t) => new Date(t * 1000).getUTCMonth() : (t) => new Date(t * 1000).getUTCFullYear();
      for (let i = 1; i < this.bars.length; i++) {
        if (key(this.bars[i].time) === key(this.bars[i - 1].time)) continue;
        const x = X(this.bars[i].time);
        if (x != null) h += `<line x1="${x}" x2="${x}" y1="0" y2="${H}" class="sep-line"/>`;
      }
    }
    for (const d of this.app.drawingsFor(this.cfg.symbol)) {
      const ax = X(d.a.time), ay = Y(d.a.price);
      if (d.t === 'hline' && ay != null) h += `<line x1="0" x2="${W}" y1="${ay}" y2="${ay}" stroke="${line}"/>`;
      if (d.t === 'vline' && ax != null) h += `<line x1="${ax}" x2="${ax}" y1="0" y2="${H}" stroke="${line}"/>`;
      if (!d.b) continue;
      const bx = X(d.b.time), by = Y(d.b.price);
      if ([ax, ay, bx, by].some((v) => v == null)) continue;
      if (d.t === 'trend') h += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${line}" stroke-width="2"/>`;
      if (d.t === 'rect') h += `<rect x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" width="${Math.abs(bx - ax)}" height="${Math.abs(by - ay)}" fill="${line}22" stroke="${line}"/>`;
      if (d.t === 'fib') {
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((lv) => {
          const pr = d.b.price + (d.a.price - d.b.price) * lv, y = Y(pr);
          h += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="#FF9800"/><text x="${x0 + 4}" y="${y - 3}" class="fib-t">${lv} (${pr.toFixed(this.digits)})</text>`;
        });
      }
    }
    this.svg.innerHTML = h;
  }

  destroy() {
    this.resizeObs.disconnect();
    this.chart.remove();
    this.el.remove();
  }
}

// Small stroke icons in TradingView's 18px style.
export const ICON = {
  gear: '<svg viewBox="0 0 18 18" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M9 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.6-2.5c0-.4 0-.7-.1-1l1.5-1.2-1.5-2.6-1.8.7a5.6 5.6 0 0 0-1.7-1L10.7 2H7.3L7 3.9c-.6.2-1.2.6-1.7 1l-1.8-.7L2 6.8 3.5 8a6 6 0 0 0 0 2L2 11.2l1.5 2.6 1.8-.7c.5.4 1.1.8 1.7 1l.3 1.9h3.4l.3-1.9c.6-.2 1.2-.6 1.7-1l1.8.7 1.5-2.6-1.5-1.2c.1-.3.1-.6.1-1Z"/></svg>',
  close: '<svg viewBox="0 0 18 18" width="14" height="14"><path stroke="currentColor" stroke-width="1.2" d="m4.5 4.5 9 9m0-9-9 9"/></svg>',
};
