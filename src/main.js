// App shell: multi-chart layout, header, drawing toolbar, Favorites /
// Market Watch / Experts panel, Pine editor, dialogs. Read-only market data;
// orders are handed off to TradingView (FTMO's execution platform).
import { TIMEFRAMES, DEFAULT_FAVORITES } from './symbols.js';
import { BUILTINS } from './indicators.js';
import { compilePine } from './pine.js';
import { MT5Client } from './data.js';
import { SETTINGS_SCHEMA, THEMES, loadSettings, saveSettings, applyThemeCss } from './settings.js';
import { SAMPLE_SCRIPTS } from './samples.js';
import { ChartPane, ICON, quoteParts } from './chartpane.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// TradingView's multi-chart layouts (cell count + CSS grid areas).
const LAYOUTS = {
  '1': { n: 1, cols: '1fr', rows: '1fr' },
  '2v': { n: 2, cols: '1fr 1fr', rows: '1fr' },
  '2h': { n: 2, cols: '1fr', rows: '1fr 1fr' },
  '3': { n: 3, cols: '2fr 1fr', rows: '1fr 1fr', areas: '"a b" "a c"' },
  '3v': { n: 3, cols: '1fr 1fr 1fr', rows: '1fr' },
  '4': { n: 4, cols: '1fr 1fr', rows: '1fr 1fr' },
  '6': { n: 6, cols: '1fr 1fr 1fr', rows: '1fr 1fr' },
  '8': { n: 8, cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' },
};
const QUICK_TF = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];
const CHART_TYPE_ICON = {
  Candles: '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="none" stroke="currentColor" d="M9 7v3m0 9v3m-2-12h4v9H7zm12-5v4m0 10v2m-2-12h4v10h-4z"/></svg>',
  'Hollow candles': '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="none" stroke="currentColor" d="M9 7v3m0 9v3m-2-12h4v9H7zm12-5v4m0 10v2m-2-12h4v10h-4z"/></svg>',
  Bars: '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="none" stroke="currentColor" d="M9 6v16M6 9h3m0 9h3M19 8v14m-3-3h3m0-7h3"/></svg>',
  Line: '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="none" stroke="currentColor" d="m5 19 6-7 5 4 7-9"/></svg>',
  Area: '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="currentColor" fill-opacity=".25" stroke="currentColor" d="m5 19 6-7 5 4 7-9v16H5z"/></svg>',
  Baseline: '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="none" stroke="currentColor" d="M4 15h20M5 19l5-8 5 6 4-9 4 5"/></svg>',
  'Heikin Ashi': '<svg viewBox="0 0 28 28" width="22" height="22"><path fill="none" stroke="currentColor" d="M9 6v16m-2-12h4v8H7zm12-6v16m-2-11h4v7h-4z"/></svg>',
};
const TOOLS = [
  ['cursor', 'Cross', '<path fill="none" stroke="currentColor" d="M14 5v18M5 14h18"/>'],
  ['trend', 'Trend line', '<path fill="none" stroke="currentColor" d="m7.5 20.5 13-13"/><circle cx="6.5" cy="21.5" r="1.5" fill="none" stroke="currentColor"/><circle cx="21.5" cy="6.5" r="1.5" fill="none" stroke="currentColor"/>'],
  ['hline', 'Horizontal line', '<path fill="none" stroke="currentColor" d="M4 14h20"/><circle cx="14" cy="14" r="1.5" fill="none" stroke="currentColor"/>'],
  ['vline', 'Vertical line', '<path fill="none" stroke="currentColor" d="M14 4v20"/><circle cx="14" cy="14" r="1.5" fill="none" stroke="currentColor"/>'],
  ['rect', 'Rectangle', '<rect x="6.5" y="8.5" width="15" height="11" fill="none" stroke="currentColor"/>'],
  ['fib', 'Fib retracement', '<path fill="none" stroke="currentColor" d="M5 7h18M5 11.5h18M5 16.5h18M5 21h18"/>'],
  ['clear', 'Remove drawings', '<path fill="none" stroke="currentColor" d="M9 9v12h10V9M7 9h14m-9-2h4M12 12v6m4-6v6"/>'],
];
const STAR = (on) => `<svg viewBox="0 0 18 18" width="18" height="18"><path fill="${on ? '#FFB300' : 'none'}" stroke="${on ? '#FFB300' : 'currentColor'}" stroke-width="1.2" d="m9 2.3 2 4.3 4.6.5-3.4 3.2.9 4.6L9 12.6l-4.1 2.3.9-4.6-3.4-3.2 4.6-.5z"/></svg>`;
const layoutIcon = (key) => {
  const L = LAYOUTS[key], cols = L.cols.split(' ').length, rows = L.rows.split(' ').length;
  let r = '';
  if (key === '3') r = '<rect x="3.5" y="5.5" width="12" height="17"/><rect x="16.5" y="5.5" width="8" height="8"/><rect x="16.5" y="14.5" width="8" height="8"/>';
  else for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) r += `<rect x="${3.5 + (i * 21) / cols}" y="${5.5 + (j * 17) / rows}" width="${21 / cols - 1}" height="${17 / rows - 1}"/>`;
  return `<svg viewBox="0 0 28 28" width="22" height="22"><g fill="none" stroke="currentColor">${r}</g></svg>`;
};

class App {
  constructor() {
    this.settings = loadSettings();
    this.client = new MT5Client(this.settings.bridgeUrl);
    this.symbols = [];
    this.favorites = store.get('mt5tv.favorites', DEFAULT_FAVORITES);
    if (!this.favorites.includes('XAUUSD')) this.favorites.unshift('XAUUSD'); // XAUUSD is always a favorite
    this.scripts = store.get('mt5tv.scripts', SAMPLE_SCRIPTS);
    this.drawings = store.get('mt5tv.drawings', {});
    const saved = store.get('mt5tv.layout', null);
    this.layout = saved?.layout && LAYOUTS[saved.layout] ? saved : {
      layout: '1', active: 0,
      sync: { symbol: false, interval: false, crosshair: true, time: false },
      cells: [{ symbol: store.get('mt5tv.symbol', 'XAUUSD'), tf: store.get('mt5tv.tf', 'H1'), indicators: store.get('mt5tv.indicators', []) }],
    };
    this.panes = [];
    this.tool = 'cursor';
    this.sideTab = store.get('mt5tv.sideTab', 'watch');
    this.quotes = {};
    this.watchFilter = '';
  }

  // ---------- helpers ----------
  log(msg) { const j = $('#journal'); j.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + j.textContent; }
  accent() { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2962FF'; }
  symbolInfo(name) { return this.symbols.find((s) => s.name === name); }
  get active() { return this.panes[this.layout.active] || this.panes[0]; }
  persistLayout() { this.layout.cells = this.panes.map((p) => p.cfg); store.set('mt5tv.layout', this.layout); }
  drawingsFor(sym) { return (this.drawings[sym] ||= []); }
  drawingsChanged(sym) { store.set('mt5tv.drawings', this.drawings); this.panes.filter((p) => p.cfg.symbol === sym).forEach((p) => p.scheduleOverlay()); }

  // ---------- boot ----------
  async init() {
    applyThemeCss(this.settings.theme);
    this.buildStaticUi();
    await this.connect(true);
    this.buildPanes();
    this.renderHeader();
    this.renderSide();
    this.renderPineList();
    this.setBottom(store.get('mt5tv.bottom', { tab: 'pine', open: false }));
    setInterval(() => this.pollQuotes(), 1000);
  }

  async connect(first) {
    const st = await this.client.connect();
    this.client.url = this.settings.bridgeUrl;
    $('#conn').textContent = this.client.connected ? `MT5 · ${st.server || ''} ${st.login || ''}` : 'Demo data — MT5 bridge offline';
    $('#conn').className = `conn ${this.client.connected ? 'on' : 'off'}`;
    $('#conn').title = this.client.connected ? 'Live prices from your MT5 terminal (read-only)' : 'Start the bridge on your MT5 PC, then Settings → MT5: Server → Connect';
    this.symbols = await this.client.symbols();
    if (first) this.log(this.client.connected ? 'Connected to MT5 (read-only price feed)' : 'MT5 bridge not reachable — showing demo data');
  }

  buildPanes() {
    const L = LAYOUTS[this.layout.layout];
    while (this.layout.cells.length < L.n) {
      const base = this.layout.cells.at(-1) || { symbol: 'XAUUSD', tf: 'H1' };
      const nextSym = this.favorites.find((f) => !this.layout.cells.some((c) => c.symbol === f)) || base.symbol;
      this.layout.cells.push({ symbol: this.layout.sync.symbol ? base.symbol : nextSym, tf: base.tf, indicators: [] });
    }
    this.panes.forEach((p) => p.destroy());
    const grid = $('#grid');
    grid.style.gridTemplateColumns = L.cols;
    grid.style.gridTemplateRows = L.rows;
    grid.style.gridTemplateAreas = L.areas || '';
    this.panes = this.layout.cells.slice(0, L.n).map((cfg, i) => {
      const p = new ChartPane(this, cfg);
      if (L.areas) p.el.style.gridArea = 'abc'[i];
      grid.appendChild(p.el);
      p.applyOptions();
      p.load();
      return p;
    });
    if (this.layout.active >= L.n) this.layout.active = 0;
    grid.classList.toggle('multi', L.n > 1);
    this.setActive(this.active, true);
    this.persistLayout();
  }

  setActive(pane, force) {
    const idx = this.panes.indexOf(pane);
    if (idx < 0 || (idx === this.layout.active && !force)) return;
    this.layout.active = idx;
    this.panes.forEach((p, i) => p.el.classList.toggle('active', i === idx));
    store.set('mt5tv.layout', this.layout);
    this.renderHeader();
    this.renderSide();
  }

  // Symbol / interval changes go to the active chart, or to all charts when synced.
  setSymbol(sym) {
    const targets = this.layout.sync.symbol ? this.panes : [this.active];
    targets.forEach((p) => p.setSymbol(sym));
    this.persistLayout(); this.renderHeader(); this.renderSide();
  }
  setTf(tf) {
    const targets = this.layout.sync.interval ? this.panes : [this.active];
    targets.forEach((p) => p.setTf(tf));
    this.persistLayout(); this.renderHeader();
  }

  syncCrosshair(src, p) {
    if (!this.layout.sync.crosshair || this.syncing || this.panes.length < 2) return;
    this.syncing = true;
    for (const o of this.panes) {
      if (o === src || !o.main) continue;
      if (!p.time) { o.chart.clearCrosshairPosition(); continue; }
      let lo = 0, hi = o.bars.length - 1, hit = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (o.bars[m].time <= p.time) { hit = m; lo = m + 1; } else hi = m - 1; }
      if (hit < 0) o.chart.clearCrosshairPosition();
      else o.chart.setCrosshairPosition(o.bars[hit].close, o.bars[hit].time, o.main);
    }
    this.syncing = false;
  }

  syncTime(src) {
    if (!this.layout.sync.time || this.syncingTime || this.panes.length < 2) return;
    const r = src.chart.timeScale().getVisibleRange();
    if (!r) return;
    this.syncingTime = true;
    this.panes.forEach((o) => { if (o !== src && o.bars.length) try { o.chart.timeScale().setVisibleRange(r); } catch { /* out of data range */ } });
    this.syncingTime = false;
  }

  // ---------- quotes ----------
  async pollQuotes() {
    const want = new Set(this.panes.map((p) => p.cfg.symbol));
    if (this.sideTab === 'watch') this.watchList().slice(0, 60).forEach((s) => want.add(s.name));
    if (this.sideTab === 'fav') this.favorites.forEach((s) => want.add(s));
    let ticks;
    try { ticks = await this.client.ticks([...want]); } catch (e) {
      if (this.client.connected) { this.log(`Price feed lost: ${e.message}`); await this.connect(false); this.panes.forEach((p) => p.load()); }
      return;
    }
    for (const t of ticks) {
      const prev = this.quotes[t.symbol];
      t.dir = prev ? (t.bid > prev.bid ? 1 : t.bid < prev.bid ? -1 : prev.dir) : 0;
      this.quotes[t.symbol] = t;
      this.panes.forEach((p) => p.onTick(t));
    }
    this.updateWatchQuotes();
  }

  // ---------- trade hand-off ----------
  handOffTrade(symbol, side) {
    const go = () => {
      const tv = (this.settings.tvPrefix ? `${this.settings.tvPrefix.trim()}:` : '') + symbol;
      window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`, 'tv-trade');
      this.log(`${side} ${symbol}: opened on TradingView for execution`);
    };
    if (store.get('mt5tv.handoffAck', false)) return go();
    this.openDialog('Trade on TradingView', ['x'], (_, el) => {
      el.innerHTML = `<p class="note">This app never sends orders. Orders, closes, TP and SL go through FTMO's own TradingView connection, so every trade is a normal manual trade on FTMO's infrastructure — no EA, no API, no scripts.</p>
        <p class="note">Clicking <b>${esc(side)}</b> opens <b>${esc(symbol)}</b> on TradingView. Connect your FTMO account in TradingView's <i>Trading Panel</i> once, then place the order there (one-click buy/sell, drag TP/SL on the chart).</p>
        <p class="note muted">Set the broker prefix in Settings → Trading if TradingView needs one for FTMO's symbols.</p>`;
    }, () => { store.set('mt5tv.handoffAck', true); go(); }, 'Open TradingView');
  }

  // ---------- header ----------
  buildStaticUi() {
    $('#drawbar').innerHTML = TOOLS.map(([k, title, path]) => `<button data-tool="${k}" title="${title}"><svg viewBox="0 0 28 28" width="28" height="28">${path}</svg></button>`).join('');
    $('#drawbar').onclick = (e) => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      if (b.dataset.tool === 'clear') {
        const sym = this.active.cfg.symbol;
        if (this.drawingsFor(sym).length && confirm(`Remove all drawings on ${sym}?`)) { this.drawings[sym] = []; this.drawingsChanged(sym); }
        return;
      }
      this.setTool(b.dataset.tool);
    };
    this.setTool('cursor');
    $('#symbolBtn').onclick = () => this.openSymbolSearch();
    $('#favToggle').onclick = () => this.toggleFav(this.active.cfg.symbol);
    $('#tfBar').onclick = (e) => e.target.dataset.tf && this.setTf(e.target.dataset.tf);
    $('#tfMore').onclick = (e) => this.menu(e.currentTarget, TIMEFRAMES.map(([t]) => ({ label: t, checked: t === this.active.cfg.tf, run: () => this.setTf(t) })));
    $('#chartTypeBtn').onclick = (e) => this.menu(e.currentTarget, Object.keys(CHART_TYPE_ICON).map((t) => ({ icon: CHART_TYPE_ICON[t], label: t, checked: t === this.settings.chartType, run: () => this.updateSettings({ chartType: t }) })));
    $('#indBtn').onclick = () => this.openIndicators();
    $('#layoutBtn').onclick = (e) => this.openLayoutMenu(e.currentTarget);
    $('#settingsBtn').onclick = () => this.openSettings();
    $('#sideTabs').onclick = (e) => { if (e.target.dataset.tab) { this.sideTab = e.target.dataset.tab; store.set('mt5tv.sideTab', this.sideTab); this.renderSide(); } };
    $('#bottomTabs').onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) this.setBottom({ tab: t.dataset.tab, open: true }); };
    $('#bottomToggle').onclick = () => this.setBottom({ ...this.bottom, open: !this.bottom.open });
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select') || $('#dlg').open) return;
      if (e.key === 'Escape') this.setTool('cursor');
      if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) this.openSymbolSearch(e.key);
    });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) $('#menu').classList.add('hidden'); });
    this.bindPine();
  }

  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll('#drawbar [data-tool]').forEach((x) => x.classList.toggle('active', x.dataset.tool === tool));
    document.body.classList.toggle('drawing', tool !== 'cursor');
    this.panes.forEach((p) => (p.pending = null));
  }

  renderHeader() {
    const p = this.active;
    if (!p) return;
    $('#symbolName').textContent = p.cfg.symbol;
    const fav = this.favorites.includes(p.cfg.symbol);
    $('#favToggle').innerHTML = STAR(fav);
    $('#favToggle').title = fav ? 'Remove from favorites' : 'Add to favorites';
    const tfs = QUICK_TF.includes(p.cfg.tf) ? QUICK_TF : [...QUICK_TF, p.cfg.tf];
    $('#tfBar').innerHTML = tfs.map((t) => `<button data-tf="${t}" class="hb${t === p.cfg.tf ? ' on' : ''}">${t}</button>`).join('');
    $('#chartTypeBtn').innerHTML = CHART_TYPE_ICON[this.settings.chartType];
    $('#layoutBtn').innerHTML = layoutIcon(this.layout.layout);
  }

  menu(anchor, items) {
    const m = $('#menu');
    m.innerHTML = items.map((it, i) => it.sep ? '<div class="menu-sep"></div>' : it.header ? `<div class="menu-h">${esc(it.header)}</div>`
      : `<button data-i="${i}" class="${it.checked ? 'on' : ''}">${it.icon || ''}<span>${esc(it.label)}</span>${it.toggle != null ? `<i class="sw${it.toggle ? ' on' : ''}"></i>` : ''}</button>`).join('');
    const r = anchor.getBoundingClientRect();
    m.style.left = `${Math.min(r.left, innerWidth - 240)}px`;
    m.style.top = `${r.bottom + 4}px`;
    m.classList.remove('hidden');
    m.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const it = items[+b.dataset.i];
      it.run();
      if (it.toggle == null) m.classList.add('hidden');
      else { it.toggle = !it.toggle; b.querySelector('.sw').classList.toggle('on', it.toggle); }
    };
  }

  openLayoutMenu(anchor) {
    const m = $('#menu');
    const s = this.layout.sync;
    m.innerHTML = `<div class="menu-h">Layout</div><div class="layout-grid">${Object.keys(LAYOUTS).map((k) => `<button data-layout="${k}" class="${k === this.layout.layout ? 'on' : ''}" title="${LAYOUTS[k].n} chart${LAYOUTS[k].n > 1 ? 's' : ''}">${layoutIcon(k)}</button>`).join('')}</div>
      <div class="menu-sep"></div><div class="menu-h">Sync in layout</div>
      ${[['symbol', 'Symbol'], ['interval', 'Interval'], ['crosshair', 'Crosshair'], ['time', 'Time']].map(([k, l]) => `<button data-sync="${k}"><span>${l}</span><i class="sw${s[k] ? ' on' : ''}"></i></button>`).join('')}`;
    const r = anchor.getBoundingClientRect();
    m.style.left = `${Math.min(r.left, innerWidth - 240)}px`;
    m.style.top = `${r.bottom + 4}px`;
    m.classList.remove('hidden');
    m.onclick = (e) => {
      const l = e.target.closest('[data-layout]'), y = e.target.closest('[data-sync]');
      if (l) { this.layout.layout = l.dataset.layout; this.buildPanes(); this.renderHeader(); m.classList.add('hidden'); }
      if (y) {
        const k = y.dataset.sync;
        s[k] = !s[k];
        y.querySelector('.sw').classList.toggle('on', s[k]);
        if (k === 'symbol' && s[k]) this.setSymbol(this.active.cfg.symbol);
        if (k === 'interval' && s[k]) this.setTf(this.active.cfg.tf);
        store.set('mt5tv.layout', this.layout);
      }
    };
  }

  toggleFav(name) {
    const i = this.favorites.indexOf(name);
    if (i >= 0) this.favorites.splice(i, 1); else this.favorites.push(name);
    store.set('mt5tv.favorites', this.favorites);
    this.renderHeader(); this.renderSide();
  }

  // ---------- side panel ----------
  watchList() {
    const q = this.watchFilter.toUpperCase();
    return q ? this.symbols.filter((s) => s.name.includes(q) || (s.desc || '').toUpperCase().includes(q)) : this.symbols;
  }

  renderSide() {
    document.querySelectorAll('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.sideTab));
    const body = $('#sideBody');
    if (this.sideTab === 'ea') return this.renderExperts();
    const cur = this.active?.cfg.symbol;
    const list = this.sideTab === 'fav' ? this.favorites.map((f) => this.symbolInfo(f) || { name: f, desc: '' }) : this.watchList();
    let html = this.sideTab === 'watch' ? `<div class="mw-search"><input id="watchSearch" placeholder="Search symbol" value="${esc(this.watchFilter)}"></div>` : '';
    html += `<table class="mw"><thead><tr><th></th><th>Symbol</th><th>Bid</th><th>Ask</th><th>Spr</th></tr></thead><tbody>`;
    let grp = null;
    for (const s of list) {
      if (this.sideTab === 'watch' && !this.watchFilter && s.group !== grp) { grp = s.group; html += `<tr class="mw-grp"><td colspan="5">${esc(grp)}</td></tr>`; }
      const fav = this.favorites.includes(s.name);
      html += `<tr data-sym="${esc(s.name)}" class="${s.name === cur ? 'cur' : ''}" title="${esc(s.desc)}"><td><button class="star" data-star="${esc(s.name)}">${STAR(fav)}</button></td><td class="mw-name">${esc(s.name)}</td><td class="mw-bid"></td><td class="mw-ask"></td><td class="mw-spr"></td></tr>`;
    }
    html += '</tbody></table>';
    if (!list.length) html += `<p class="empty">${this.sideTab === 'fav' ? 'Star a symbol in Market Watch to pin it here.' : `No MT5 symbol matches “${esc(this.watchFilter)}”.`}</p>`;
    body.innerHTML = html;
    const search = $('#watchSearch');
    if (search) {
      search.oninput = () => { this.watchFilter = search.value.trim(); const pos = search.selectionStart; this.renderSide(); const n = $('#watchSearch'); n.focus(); n.setSelectionRange(pos, pos); };
    }
    body.onclick = (e) => {
      const star = e.target.closest('[data-star]');
      if (star) return this.toggleFav(star.dataset.star);
      const row = e.target.closest('[data-sym]');
      if (row) this.setSymbol(row.dataset.sym);
    };
    body.ondblclick = (e) => { const row = e.target.closest('[data-sym]'); if (row) this.handOffTrade(row.dataset.sym, 'New order'); };
    this.updateWatchQuotes();
  }

  // MT5 Market Watch colouring: blue when the price ticked up, red when down.
  updateWatchQuotes() {
    document.querySelectorAll('#sideBody tr[data-sym]').forEach((row) => {
      const t = this.quotes[row.dataset.sym];
      if (!t) return;
      const cls = t.dir > 0 ? 'q-up' : t.dir < 0 ? 'q-down' : '';
      const fmt = (v) => { const q = quoteParts(v, t.digits); return `${q.small}<b>${q.big}</b>${q.sup ? `<sup>${q.sup}</sup>` : ''}`; };
      row.children[2].innerHTML = fmt(t.bid); row.children[2].className = `mw-bid ${cls}`;
      row.children[3].innerHTML = fmt(t.ask); row.children[3].className = `mw-ask ${cls}`;
      row.children[4].textContent = Math.round((t.ask - t.bid) / t.point);
    });
  }

  async renderExperts() {
    const body = $('#sideBody');
    let html = `<div class="ea-head"><label class="btn primary">Upload Expert (.mq5 / .ex5)<input id="eaFile" type="file" accept=".mq5,.ex5,.mqh" hidden multiple></label></div>
      <p class="note muted">Copies files into your terminal's <code>MQL5\\Experts</code> folder. Experts never trade through this app; don't attach them to an FTMO account if you trade it manually.</p>`;
    if (!this.client.connected) html += '<p class="empty">Connect the MT5 bridge (Settings → MT5: Server) to manage Experts.</p>';
    else {
      let list = [];
      try { list = await this.client.experts(); } catch (e) { html += `<p class="empty">${esc(e.message)}</p>`; }
      html += list.map((n) => `<div class="ea-row"><span>${esc(n)}</span><button class="hb-icon" data-del="${esc(n)}" title="Delete">${ICON.close}</button></div>`).join('') || '<p class="empty">No Experts in MQL5\\Experts yet.</p>';
    }
    if (this.sideTab !== 'ea') return;
    body.innerHTML = html;
    $('#eaFile')?.addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = ''; buf.forEach((b) => (bin += String.fromCharCode(b)));
        try { await this.client.uploadExpert(f.name, btoa(bin)); this.log(`Copied ${f.name} to MQL5\\Experts`); } catch (err) { this.log(`Upload failed: ${err.message}`); }
      }
      this.renderExperts();
    });
    body.onclick = async (e) => {
      const d = e.target.closest('[data-del]');
      if (d && confirm(`Delete ${d.dataset.del} from MQL5\\Experts?`)) { await this.client.deleteExpert(d.dataset.del).catch((err) => this.log(err.message)); this.renderExperts(); }
    };
  }

  // ---------- dialogs ----------
  openDialog(title, navItems, renderPane, onOk, okLabel = 'Ok') {
    const dlg = $('#dlg');
    let cur = navItems[0];
    const draw = () => {
      $('#dlgBody').innerHTML = `<div class="dlg-h"><span>${esc(title)}</span><button class="hb-icon" id="dlgX">${ICON.close}</button></div>
        <div class="dlg-c">${navItems.length > 1 ? `<div class="dlg-nav">${navItems.map((n) => `<button data-nav="${esc(n)}" class="${n === cur ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}<div class="dlg-p" id="dlgP"></div></div>
        ${onOk ? `<div class="dlg-f"><button class="btn" id="dlgCancel">Cancel</button><button id="dlgOk" class="btn primary">${esc(okLabel)}</button></div>` : ''}`;
      renderPane(cur, $('#dlgP'));
      $('#dlgX').onclick = () => dlg.close();
      if (onOk) { $('#dlgCancel').onclick = () => dlg.close(); $('#dlgOk').onclick = () => { dlg.close(); onOk(); }; }
      $('#dlgBody').querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { cur = b.dataset.nav; draw(); }));
    };
    draw();
    dlg.classList.toggle('narrow', navItems.length <= 1);
    if (!dlg.open) dlg.showModal();
  }

  openSymbolSearch(initial = '') {
    let q = initial;
    this.openDialog('Symbol search', ['x'], (_, el) => {
      el.innerHTML = `<input id="symQ" class="sym-q" placeholder="Search MT5 symbols" value="${esc(q)}"><div id="symList" class="sym-list"></div>`;
      const render = () => {
        const Q = q.toUpperCase();
        const list = this.symbols.filter((s) => !Q || s.name.includes(Q) || (s.desc || '').toUpperCase().includes(Q));
        $('#symList').innerHTML = list.map((s) => `<button data-sym="${esc(s.name)}"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span><i>${esc(s.group)}</i></button>`).join('') || `<p class="empty">No MT5 symbol matches “${esc(q)}”.</p>`;
      };
      const inp = $('#symQ');
      inp.oninput = () => { q = inp.value; render(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') $('#symList [data-sym]')?.click(); };
      $('#symList').onclick = (e) => { const b = e.target.closest('[data-sym]'); if (b) { $('#dlg').close(); this.setSymbol(b.dataset.sym); } };
      render();
      setTimeout(() => { inp.focus(); inp.setSelectionRange(q.length, q.length); });
    });
  }

  fieldHtml(key, f, val) {
    if (f.type === 'bool') return `<label class="field"><span>${esc(f.label)}</span><input type="checkbox" data-k="${key}" ${val ? 'checked' : ''}></label>`;
    if (f.type === 'select') return `<label class="field"><span>${esc(f.label)}</span><select data-k="${key}">${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    return `<label class="field"><span>${esc(f.label)}</span><input type="${f.type}" data-k="${key}" value="${esc(val)}"></label>`;
  }

  openSettings() {
    const draft = { ...this.settings };
    const navs = [...Object.keys(SETTINGS_SCHEMA), 'MT5: Terminal'];
    this.openDialog('Settings', navs, (sec, el) => {
      if (sec === 'MT5: Terminal') return this.renderTerminal(el);
      el.innerHTML = Object.entries(SETTINGS_SCHEMA[sec]).map(([k, f]) => this.fieldHtml(k, f, draft[k])).join('') +
        (sec === 'MT5: Server' ? '<div class="row"><button id="mt5Connect" class="btn primary">Connect</button><span id="mt5Status" class="muted"></span></div><p class="note muted">Used for prices only. Any MT5 account works, e.g. a free MetaQuotes-Demo account. Nothing is ever traded through it.</p>' : '') +
        (sec === 'Trading' ? '<p class="note muted">Orders are never sent from this app. SELL / BUY open the symbol on TradingView, where FTMO\'s own connection executes them. Leave the prefix empty to let TradingView resolve the symbol.</p>' : '');
      el.querySelectorAll('[data-k]').forEach((inp) => (inp.onchange = () => {
        const f = SETTINGS_SCHEMA[sec][inp.dataset.k];
        draft[inp.dataset.k] = f.type === 'bool' ? inp.checked : inp.value;
        if (inp.dataset.k === 'theme') {
          Object.assign(draft, THEMES[inp.value].chart);
          for (const [k, v] of Object.entries(THEMES[inp.value].chart)) { const c = el.querySelector(`[data-k="${k}"]`); if (c) c.value = v; }
        }
      }));
      const btn = el.querySelector('#mt5Connect');
      if (btn) btn.onclick = async () => {
        $('#mt5Status').textContent = 'Connecting…';
        this.client.url = draft.bridgeUrl;
        try {
          if (draft.login) await this.client.login({ login: draft.login, password: draft.password, server: draft.server, path: draft.terminalPath });
          await this.client.connect();
          $('#mt5Status').textContent = this.client.connected ? 'Connected' : 'Bridge is running but MT5 is not logged in';
        } catch (e) { $('#mt5Status').textContent = `Bridge not reachable at ${draft.bridgeUrl} (${e.message})`; }
      };
    }, () => this.updateSettings(draft, true));
  }

  async renderTerminal(el) {
    el.innerHTML = '<p class="muted">Reading terminal…</p>';
    if (!this.client.connected) { el.innerHTML = '<p class="empty">Connect to MT5 first (MT5: Server tab).</p>'; return; }
    try {
      const { terminal: t, account: a, version } = await this.client.terminal();
      const yes = (v) => `<b class="${v ? 'up' : 'down'}">${v ? 'On' : 'Off'}</b>`;
      const rows = [
        ['Account', a ? `${a.login} · ${esc(a.server)}` : '—'], ['Company', esc(t?.company)], ['Build', version ? esc(version[1]) : '—'],
        ['Connected', yes(t?.connected)], ['Ping', t?.ping_last ? `${(t.ping_last / 1000).toFixed(1)} ms` : '—'],
        ['Algo Trading button', yes(t?.trade_allowed)], ['DLL imports', yes(t?.dlls_allowed)],
        ['Push notifications', yes(t?.notifications_enabled)], ['Email', yes(t?.email_enabled)], ['FTP', yes(t?.ftp_enabled)],
        ['MQL5 community', yes(t?.community_account)], ['Max bars in chart', esc(t?.maxbars)], ['Data folder', `<code>${esc(t?.data_path)}</code>`],
      ];
      el.innerHTML = `<table class="kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        <p class="note muted">These are MT5's own Tools → Options settings, read live from the terminal. Change them in MT5; outside programs can't.</p>`;
    } catch (e) { el.innerHTML = `<p class="empty">Couldn't read the terminal: ${esc(e.message)}</p>`; }
  }

  async updateSettings(patch, reconnect) {
    const themeChanged = patch.theme && patch.theme !== this.settings.theme;
    Object.assign(this.settings, patch);
    if (themeChanged && !reconnect) Object.assign(this.settings, THEMES[this.settings.theme].chart);
    saveSettings(this.settings);
    applyThemeCss(this.settings.theme);
    if (reconnect) { this.client.url = this.settings.bridgeUrl; await this.connect(false); this.panes.forEach((p) => { p.applyOptions(); p.load(); }); }
    else this.panes.forEach((p) => p.applyOptions());
    this.renderHeader(); this.renderSide();
  }

  openIndicators() {
    const pane = this.active;
    this.openDialog(`Indicators — ${pane.cfg.symbol} ${pane.cfg.tf}`, ['Technicals', 'My scripts'], (sec, el) => {
      const items = sec === 'Technicals' ? Object.keys(BUILTINS).map((n) => ({ n, a: `b:${n}` })) : this.scripts.map((s) => ({ n: s.name, a: `p:${s.id}` }));
      el.innerHTML = `<div class="list">${items.map((i) => `<button data-add="${esc(i.a)}">${esc(i.n)}</button>`).join('')}</div>` +
        (sec === 'My scripts' ? '<p class="note muted">Write or open Pine scripts in the Pine Editor at the bottom of the screen.</p>' : '');
      el.onclick = (e) => {
        const a = e.target.closest('[data-add]')?.dataset.add;
        if (!a) return;
        if (a.startsWith('b:')) { const n = a.slice(2); pane.cfg.indicators.push({ kind: 'builtin', name: n, params: { ...BUILTINS[n].params } }); }
        else { const s = this.scripts.find((x) => x.id === a.slice(2)); pane.cfg.indicators.push({ kind: 'pine', name: s.name, scriptId: s.id, params: {} }); }
        pane.rebuildIndicators(); this.persistLayout(); $('#dlg').close();
      };
    });
  }

  editIndicator(pane, idx) {
    const ind = pane.cfg.indicators[idx];
    let fields = [];
    if (ind.kind === 'builtin') fields = Object.entries(ind.params).map(([k, v]) => ({ k, v }));
    else {
      const sc = this.scripts.find((s) => s.id === ind.scriptId);
      try { fields = compilePine(sc.code, pane.arrays(), ind.params).inputs.filter((i) => typeof i.def === 'number').map((i) => ({ k: i.title, v: ind.params[i.title] ?? i.def })); } catch { /* shows none */ }
    }
    const draft = {};
    this.openDialog(`${ind.name} — Inputs`, ['x'], (_, el) => {
      el.innerHTML = fields.map((f) => `<label class="field"><span>${esc(f.k)}</span><input type="number" step="any" data-k="${esc(f.k)}" value="${f.v}"></label>`).join('') || '<p class="empty">This indicator has no numeric inputs.</p>';
      el.querySelectorAll('[data-k]').forEach((i) => (i.onchange = () => (draft[i.dataset.k] = +i.value)));
    }, () => { ind.params = { ...ind.params, ...draft }; pane.rebuildIndicators(); this.persistLayout(); });
  }

  // ---------- bottom panel / Pine editor ----------
  setBottom(b) {
    this.bottom = b;
    store.set('mt5tv.bottom', b);
    $('#bottom').classList.toggle('open', b.open);
    document.querySelectorAll('#bottomTabs [data-tab]').forEach((t) => t.classList.toggle('on', b.open && t.dataset.tab === b.tab));
    document.querySelectorAll('#bottom .pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.tab));
    if (b.open && b.tab === 'pine') this.renderPineList();
  }

  bindPine() {
    const code = $('#pineCode');
    const gutter = () => { $('#pineGutter').textContent = code.value.split('\n').map((_, i) => i + 1).join('\n'); };
    code.addEventListener('input', gutter);
    code.addEventListener('scroll', () => ($('#pineGutter').scrollTop = code.scrollTop));
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const p = code.selectionStart; code.value = code.value.slice(0, p) + '    ' + code.value.slice(code.selectionEnd); code.selectionStart = code.selectionEnd = p + 4; gutter(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.savePine(); }
    });
    this.pineGutter = gutter;
    $('#pineList').onchange = (e) => { this.curScript = e.target.value; this.renderPineList(); };
    $('#pineNew').onclick = () => {
      const id = 's' + Date.now();
      this.scripts.push({ id, name: 'My script', code: '//@version=5\nindicator("My script", overlay=true)\nlength = input.int(20, "Length")\nplot(ta.sma(close, length), "SMA", color=color.blue)\n' });
      this.curScript = id; this.saveScripts(); this.renderPineList();
    };
    $('#pineSave').onclick = () => this.savePine();
    $('#pineAdd').onclick = () => {
      const s = this.savePine();
      if (!s) return;
      this.active.cfg.indicators.push({ kind: 'pine', name: s.name, scriptId: s.id, params: {} });
      this.active.rebuildIndicators(); this.persistLayout();
    };
    $('#pineDel').onclick = () => {
      const s = this.scripts.find((x) => x.id === this.curScript);
      if (!s || !confirm(`Delete “${s.name}”?`)) return;
      this.scripts = this.scripts.filter((x) => x.id !== s.id);
      this.panes.forEach((p) => { p.cfg.indicators = p.cfg.indicators.filter((i) => i.scriptId !== s.id); p.rebuildIndicators(); });
      this.curScript = this.scripts[0]?.id; this.saveScripts(); this.persistLayout(); this.renderPineList();
    };
    $('#pineFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const id = 's' + Date.now();
      this.scripts.push({ id, name: f.name.replace(/\.\w+$/, ''), code: await f.text() });
      this.curScript = id; this.saveScripts(); this.renderPineList(); this.savePine();
      e.target.value = '';
    };
  }

  saveScripts() { store.set('mt5tv.scripts', this.scripts); }

  renderPineList() {
    if (!this.scripts.some((s) => s.id === this.curScript)) this.curScript = this.scripts[0]?.id;
    $('#pineList').innerHTML = this.scripts.map((s) => `<option value="${esc(s.id)}" ${s.id === this.curScript ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#pineCode').value = this.scripts.find((s) => s.id === this.curScript)?.code || '';
    this.pineGutter();
  }

  savePine() {
    const s = this.scripts.find((x) => x.id === this.curScript);
    if (!s) return null;
    s.code = $('#pineCode').value;
    const msg = $('#pineMsg');
    try {
      const r = compilePine(s.code, this.active.arrays());
      s.name = r.title;
      msg.className = 'ok';
      msg.textContent = `Compiled “${r.title}”: ${r.plots.length} plot${r.plots.length === 1 ? '' : 's'}, ${r.inputs.length} input${r.inputs.length === 1 ? '' : 's'}.`;
    } catch (e) { msg.className = 'err'; msg.textContent = `Compile error: ${e.message}`; return null; }
    this.saveScripts();
    $('#pineList').querySelector(`[value="${CSS.escape(s.id)}"]`).textContent = s.name;
    this.panes.forEach((p) => p.cfg.indicators.some((i) => i.scriptId === s.id) && p.rebuildIndicators());
    return s;
  }
}

const app = new App();
if (import.meta.env?.DEV) window.__app = app; // dev-tools access
app.init();
