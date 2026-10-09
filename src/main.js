import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, HistogramSeries,
  CrosshairMode, PriceScaleMode, createSeriesMarkers,
} from 'lightweight-charts';
import { TIMEFRAMES, DEFAULT_FAVORITES } from './symbols.js';
import { BUILTINS } from './indicators.js';
import { compilePine } from './pine.js';
import { MT5Client } from './data.js';
import { SETTINGS_SCHEMA, loadSettings, saveSettings } from './settings.js';
import { SAMPLE_SCRIPTS } from './samples.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let settings = loadSettings();
const client = new MT5Client(settings.bridgeUrl);
const state = {
  symbol: store.get('mt5tv.symbol', 'XAUUSD'),
  tf: store.get('mt5tv.tf', 'H1'),
  symbols: [],
  favorites: store.get('mt5tv.favorites', DEFAULT_FAVORITES),
  indicators: store.get('mt5tv.indicators', []), // {kind:'builtin'|'pine', name, params|scriptId}
  scripts: store.get('mt5tv.scripts', SAMPLE_SCRIPTS),
  drawings: store.get('mt5tv.drawings', {}),
  bars: [],
  sideTab: 'fav',
  tool: 'cursor',
};
// XAUUSD is always favorited by default.
if (!state.favorites.includes('XAUUSD')) state.favorites.unshift('XAUUSD');

const log = (msg) => { const j = $('#journal'); j.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + j.textContent; };

// ---------------- Chart ----------------
const chart = createChart($('#chart'), { autoSize: true });
let mainSeries, volSeries, indSeries = [], mainMarkers, priceLines = [];

function applyChartOptions() {
  chart.applyOptions({
    layout: { background: { color: settings.background }, textColor: settings.textColor, panes: { separatorColor: '#2A2E39' } },
    grid: { vertLines: { color: settings.gridColor }, horzLines: { color: settings.gridColor } },
    crosshair: { mode: settings.crosshair === 'Magnet' ? CrosshairMode.Magnet : CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2A2E39', mode: settings.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
    timeScale: { borderColor: '#2A2E39', timeVisible: true, secondsVisible: false, rightOffset: settings.chartShift ? 12 : 0, shiftVisibleRangeOnNewBar: settings.autoScroll },
    localization: settings.timezone === 'UTC' ? { timeFormatter: (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') } : {},
  });
  document.body.style.background = settings.background;
}

function heikinAshi(bars) {
  const out = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  });
  return out;
}

function buildMainSeries() {
  if (mainSeries) chart.removeSeries(mainSeries);
  if (volSeries) { chart.removeSeries(volSeries); volSeries = null; }
  const t = settings.chartType;
  const up = settings.upColor, dn = settings.downColor;
  const sym = state.symbols.find((s) => s.name === state.symbol);
  const digits = sym?.digits ?? 2;
  const priceFormat = { type: 'price', precision: digits, minMove: 1 / 10 ** digits };
  if (t === 'Candles' || t === 'Heikin Ashi') mainSeries = chart.addSeries(CandlestickSeries, { upColor: up, downColor: dn, borderVisible: false, wickUpColor: up, wickDownColor: dn, priceFormat });
  else if (t === 'Hollow candles') mainSeries = chart.addSeries(CandlestickSeries, { upColor: 'transparent', downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceFormat });
  else if (t === 'Bars') mainSeries = chart.addSeries(BarSeries, { upColor: up, downColor: dn, priceFormat });
  else if (t === 'Line') mainSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 2, priceFormat });
  else if (t === 'Area') mainSeries = chart.addSeries(AreaSeries, { lineColor: '#2962FF', topColor: '#2962FF55', bottomColor: '#2962FF05', priceFormat });
  else mainSeries = chart.addSeries(BaselineSeries, { topLineColor: up, bottomLineColor: dn, priceFormat });
  mainMarkers = createSeriesMarkers(mainSeries, []);
  if (settings.showVolume) {
    volSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }
}

function setMainData() {
  const t = settings.chartType;
  const bars = t === 'Heikin Ashi' ? heikinAshi(state.bars) : state.bars;
  if (['Line', 'Area', 'Baseline'].includes(t)) {
    mainSeries.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    if (t === 'Baseline' && bars.length) mainSeries.applyOptions({ baseValue: { type: 'price', price: bars[Math.floor(bars.length / 2)].close } });
  } else mainSeries.setData(bars);
  volSeries?.setData(state.bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? settings.upColor + '66' : settings.downColor + '66' })));
}

function barsArrays() {
  const b = state.bars;
  return { open: b.map((x) => x.open), high: b.map((x) => x.high), low: b.map((x) => x.low), close: b.map((x) => x.close), volume: b.map((x) => x.volume) };
}

function renderIndicators() {
  indSeries.forEach((s) => chart.removeSeries(s));
  indSeries = [];
  const markers = [];
  const arrays = barsArrays();
  let pane = 1;
  const legendItems = [];
  state.indicators.forEach((ind, idx) => {
    let out, overlay, hlines = [];
    try {
      if (ind.kind === 'builtin') {
        const def = BUILTINS[ind.name];
        out = def.calc(arrays, ind.params);
        overlay = def.pane === 'main';
        hlines = (def.levels || []).map((p) => ({ price: p, color: '#787B86' }));
      } else {
        const sc = state.scripts.find((s) => s.id === ind.scriptId);
        if (!sc) return;
        const r = compilePine(sc.code, arrays, ind.params || {});
        out = r.plots; overlay = r.overlay; hlines = r.hlines;
        r.markers.forEach((m) => markers.push({ time: state.bars[m.index].time, position: m.position, color: m.color, shape: m.shape, text: m.text }));
        ind.title = r.title;
      }
    } catch (e) { log(`Indicator error (${ind.name}): ${e.message}`); return; }
    const paneIndex = overlay ? 0 : pane++;
    out.forEach((p) => {
      const S = p.type === 'histogram' ? HistogramSeries : LineSeries;
      const s = chart.addSeries(S, { color: p.color, lineWidth: p.width || 1.5, priceLineVisible: false, lastValueVisible: true, title: '' }, paneIndex);
      s.setData(state.bars.map((b, i) => (Number.isFinite(p.data[i]) ? { time: b.time, value: p.data[i], ...(p.type === 'histogram' ? { color: p.data[i] >= 0 ? '#26A69A88' : '#EF535088' } : {}) } : { time: b.time })));
      indSeries.push(s);
      if (p === out[0]) hlines.forEach((h) => s.createPriceLine({ price: h.price, color: h.color, lineStyle: 2, lineWidth: 1, axisLabelVisible: false }));
    });
    legendItems.push({ idx, label: ind.kind === 'pine' ? `${ind.title || ind.name} (Pine)` : `${ind.name} ${Object.values(ind.params).join(' ')}` });
  });
  mainMarkers?.setMarkers(markers.sort((a, b) => a.time - b.time));
  renderLegend(legendItems);
}

function renderLegend(items = []) {
  const sym = state.symbols.find((s) => s.name === state.symbol);
  const last = state.bars.at(-1);
  const d = sym?.digits ?? 2;
  const ohlc = settings.showOHLC && last ? ` <span class="${last.close >= last.open ? 'up' : 'down'}">O ${last.open.toFixed(d)} H ${last.high.toFixed(d)} L ${last.low.toFixed(d)} C ${last.close.toFixed(d)}</span>` : '';
  $('#legend').innerHTML = `<div><b>${state.symbol}</b> · ${state.tf} · ${client.connected ? 'MT5' : 'Demo'}${ohlc}</div>` +
    items.map((it) => `<div class="ind">${esc(it.label)} <button data-edit="${it.idx}" title="Settings">⚙</button><button data-rm="${it.idx}" title="Remove">✕</button></div>`).join('');
}
$('#legend').addEventListener('click', (e) => {
  const rm = e.target.dataset.rm, ed = e.target.dataset.edit;
  if (rm != null) { state.indicators.splice(+rm, 1); persistInds(); renderIndicators(); }
  if (ed != null) editIndicator(+ed);
});
function persistInds() { store.set('mt5tv.indicators', state.indicators); }

// ---------------- Data loading ----------------
let pollTimer;
async function loadChart() {
  const tfSec = TIMEFRAMES.find(([n]) => n === state.tf)[1];
  const max = settings.maxBars === 'Unlimited' ? 20000 : Math.min(+settings.maxBars, 20000);
  state.bars = await client.bars(state.symbol, state.tf, tfSec, Math.min(max, 2000));
  buildMainSeries();
  setMainData();
  renderIndicators();
  chart.timeScale().fitContent();
  chart.timeScale().scrollToRealTime();
  updateFavToggle();
  renderTopbar();
  renderSide();
  await refreshTradeLevels();
  redrawDrawings();
  clearInterval(pollTimer);
  if (client.connected) pollTimer = setInterval(pollTick, 1000);
}

async function pollTick() {
  try {
    const t = await client.tick(state.symbol);
    if (!t) return;
    const tfSec = TIMEFRAMES.find(([n]) => n === state.tf)[1];
    const last = state.bars.at(-1);
    const barTime = Math.floor(t.time / tfSec) * tfSec;
    const price = t.bid;
    if (last && barTime === last.time) Object.assign(last, { close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) });
    else if (last && barTime > last.time) state.bars.push({ time: barTime, open: price, high: price, low: price, close: price, volume: 0 });
    setMainData();
    drawBidAsk(t);
  } catch { /* bridge hiccup */ }
}

let bidLine, askLine;
function drawBidAsk(t) {
  if (bidLine) mainSeries.removePriceLine(bidLine);
  if (askLine) mainSeries.removePriceLine(askLine);
  bidLine = askLine = null;
  if (settings.showBidLine) bidLine = mainSeries.createPriceLine({ price: t.bid, color: '#787B86', lineWidth: 1, lineStyle: 0, title: 'Bid' });
  if (settings.showAskLine) askLine = mainSeries.createPriceLine({ price: t.ask, color: '#F23645', lineWidth: 1, lineStyle: 0, title: 'Ask' });
}

async function refreshTradeLevels() {
  priceLines.forEach((l) => mainSeries.removePriceLine(l));
  priceLines = [];
  if (!client.connected) { $('#tradeTbl').innerHTML = '<tr><td>Connect the MT5 bridge to see positions (Settings → MT5: Server).</td></tr>'; return; }
  try {
    const [pos, acc] = await Promise.all([client.positions(), client.account()]);
    $('#tradeTbl').innerHTML = `<tr><th>Ticket</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>S/L</th><th>T/P</th><th>Profit</th><th></th></tr>` +
      pos.map((p) => `<tr><td>${p.ticket}</td><td>${p.symbol}</td><td>${p.type}</td><td>${p.volume}</td><td>${p.price_open}</td><td>${p.sl || ''}</td><td>${p.tp || ''}</td><td class="${p.profit >= 0 ? 'up' : 'down'}">${p.profit.toFixed(2)}</td><td><button data-close="${p.ticket}">✕</button></td></tr>`).join('') +
      `<tr><td colspan="9">Balance ${acc.balance} ${acc.currency} · Equity ${acc.equity} · Margin ${acc.margin} · Free ${acc.margin_free} · Level ${acc.margin_level ? acc.margin_level.toFixed(1) + '%' : '—'}</td></tr>`;
    if (settings.showTradeLevels) pos.filter((p) => p.symbol === state.symbol).forEach((p) => {
      priceLines.push(mainSeries.createPriceLine({ price: p.price_open, color: p.type === 'BUY' ? '#2962FF' : '#F23645', lineStyle: 1, title: `${p.type} ${p.volume}` }));
      if (p.sl) priceLines.push(mainSeries.createPriceLine({ price: p.sl, color: '#F23645', lineStyle: 2, title: 'SL' }));
      if (p.tp) priceLines.push(mainSeries.createPriceLine({ price: p.tp, color: '#089981', lineStyle: 2, title: 'TP' }));
    });
    const hist = await client.history();
    $('#histTbl').innerHTML = '<tr><th>Time</th><th>Ticket</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>Profit</th></tr>' +
      hist.map((h) => `<tr><td>${new Date(h.time * 1000).toLocaleString()}</td><td>${h.ticket}</td><td>${h.symbol}</td><td>${h.type}</td><td>${h.volume}</td><td>${h.price}</td><td class="${h.profit >= 0 ? 'up' : 'down'}">${h.profit.toFixed(2)}</td></tr>`).join('');
  } catch (e) { log(`Trade refresh failed: ${e.message}`); }
}
$('#tradeTbl').addEventListener('click', async (e) => {
  const t = e.target.dataset.close;
  if (!t) return;
  try { await client.close(+t); log(`Closed #${t}`); refreshTradeLevels(); } catch (err) { log(`Close failed: ${err.message}`); }
});

// ---------------- Trading ----------------
$('#lots').value = store.get('mt5tv.lastLots', settings.defaultVolume);
async function sendOrder(side) {
  if (!client.connected) { alert('Connect to MT5 first: Settings → MT5: Server. Orders are only sent through your own MT5 terminal.'); return; }
  const volume = +$('#lots').value;
  if (!settings.oneClickTrading && !confirm(`${side} ${volume} lots ${state.symbol} at market?`)) return;
  if (settings.volumeMode === 'Last used') store.set('mt5tv.lastLots', volume);
  try {
    const r = await client.order({ symbol: state.symbol, side, volume, deviation: settings.deviation, sl_points: settings.defaultSL, tp_points: settings.defaultTP, magic: settings.magic, filling: settings.fillingMode });
    log(`${side} ${volume} ${state.symbol}: ${r.comment || r.retcode}`);
    refreshTradeLevels();
  } catch (e) { log(`Order failed: ${e.message}`); alert(e.message); }
}
$('#buyBtn').onclick = () => sendOrder('BUY');
$('#sellBtn').onclick = () => sendOrder('SELL');

// ---------------- Top bar ----------------
const QUICK_TF = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];
function renderTopbar() {
  $('#symbolBtn').textContent = state.symbol;
  $('#tfBar').innerHTML = QUICK_TF.map((t) => `<button data-tf="${t}" class="${t === state.tf ? 'active' : ''}">${t}</button>`).join('');
  $('#tfMore').innerHTML = `<option value="">More…</option>` + TIMEFRAMES.map(([t]) => `<option ${t === state.tf ? 'selected' : ''}>${t}</option>`).join('');
  $('#chartType').innerHTML = SETTINGS_SCHEMA['Chart (TradingView)'].chartType.options.map((o) => `<option ${o === settings.chartType ? 'selected' : ''}>${o}</option>`).join('');
}
function setTf(tf) { if (!tf) return; state.tf = tf; store.set('mt5tv.tf', tf); loadChart(); }
$('#tfBar').onclick = (e) => setTf(e.target.dataset.tf);
$('#tfMore').onchange = (e) => setTf(e.target.value);
$('#chartType').onchange = (e) => { settings.chartType = e.target.value; saveSettings(settings); buildMainSeries(); setMainData(); refreshTradeLevels(); };
$('#symbolBtn').onclick = () => { state.sideTab = 'watch'; renderSide(); $('#sideSearch').focus(); };

function setSymbol(name) {
  state.symbol = name; store.set('mt5tv.symbol', name);
  loadChart();
}
function toggleFav(name) {
  const i = state.favorites.indexOf(name);
  if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(name);
  store.set('mt5tv.favorites', state.favorites);
  updateFavToggle(); renderSide();
}
function updateFavToggle() {
  const on = state.favorites.includes(state.symbol);
  $('#favToggle').textContent = on ? '★' : '☆';
  $('#favToggle').style.color = on ? '#FFB300' : '';
  $('#favToggle').title = on ? 'Remove from favorites' : 'Add to favorites';
}
$('#favToggle').onclick = () => toggleFav(state.symbol);

// ---------------- Side panel ----------------
function renderSide() {
  document.querySelectorAll('#sideTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.sideTab));
  const q = $('#sideSearch').value.trim().toUpperCase();
  $('#sideSearch').classList.toggle('hidden', state.sideTab === 'ea');
  if (state.sideTab === 'ea') return renderEAList();
  let list = state.symbols;
  if (state.sideTab === 'fav') list = state.favorites.map((f) => list.find((s) => s.name === f) || { name: f, desc: '', group: '' });
  if (q) list = list.filter((s) => s.name.includes(q) || (s.desc || '').toUpperCase().includes(q));
  let html = '', grp = null;
  for (const s of list) {
    if (state.sideTab === 'watch' && s.group !== grp) { grp = s.group; html += `<div class="grp">${grp}</div>`; }
    const fav = state.favorites.includes(s.name);
    html += `<div class="item ${s.name === state.symbol ? 'cur' : ''}" data-sym="${s.name}"><button class="star ${fav ? 'on' : ''}" data-star="${s.name}">${fav ? '★' : '☆'}</button><div>${esc(s.name)}<small>${esc(s.desc)}</small></div><span></span><span></span></div>`;
  }
  if (!list.length) html = `<div class="grp">${state.sideTab === 'fav' ? 'No favorites — click ☆ next to any symbol' : 'No symbols match'}</div>`;
  $('#sideList').innerHTML = html;
}
$('#sideTabs').onclick = (e) => { if (e.target.dataset.tab) { state.sideTab = e.target.dataset.tab; renderSide(); } };
$('#sideSearch').oninput = renderSide;
$('#sideList').addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  if (star) { e.stopPropagation(); return toggleFav(star.dataset.star); }
  const it = e.target.closest('[data-sym]');
  if (it) setSymbol(it.dataset.sym);
});

// ---------------- Expert Advisors ----------------
let eaCache = [];
async function renderEAList() {
  let html = `<div class="row" style="padding:8px"><label class="btn primary">Upload EA (.mq5/.ex5)<input id="eaFile" type="file" accept=".mq5,.ex5,.mqh" hidden multiple></label></div>`;
  if (!client.connected) html += `<div class="grp">Connect the MT5 bridge to install EAs into your terminal's MQL5\\Experts folder.</div>`;
  else {
    try { eaCache = await client.experts(); } catch (e) { eaCache = []; html += `<div class="grp">${esc(e.message)}</div>`; }
    html += eaCache.map((n) => `<div class="item" style="grid-template-columns:1fr auto"><div>${esc(n)}<small>MQL5\\Experts\\${esc(n)}</small></div><button data-del="${esc(n)}">✕</button></div>`).join('') || '<div class="grp">No EAs installed yet</div>';
    html += `<div class="grp">Algo trading: ${settings.allowAlgoTrading ? 'ALLOWED' : 'disabled'} (Settings → MT5: Expert Advisors). Attach the EA to a chart inside MT5 (Navigator → drag onto chart).</div>`;
  }
  $('#sideList').innerHTML = html;
  $('#eaFile')?.addEventListener('change', async (e) => {
    for (const f of e.target.files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = ''; buf.forEach((b) => (bin += String.fromCharCode(b)));
      try { await client.uploadExpert(f.name, btoa(bin)); log(`Installed EA ${f.name}`); } catch (err) { log(`EA upload failed: ${err.message}`); alert(err.message); }
    }
    renderEAList();
  });
}
$('#sideList').addEventListener('click', async (e) => {
  const d = e.target.dataset.del;
  if (d && confirm(`Remove ${d} from MQL5\\Experts?`)) { await client.deleteExpert(d).catch((err) => alert(err.message)); renderEAList(); }
});
$('#eaBtn').onclick = () => { state.sideTab = 'ea'; renderSide(); };

// ---------------- Dialogs ----------------
const dlg = $('#dlg');
function openDialog(title, navItems, renderPane, onSave) {
  let cur = navItems[0];
  const draw = () => {
    $('#dlgBody').innerHTML = `<div class="dlg-h">${title}<div class="grow"></div><button class="icon" id="dlgX">✕</button></div>
      <div class="dlg-c">${navItems.length > 1 ? `<div class="dlg-nav">${navItems.map((n) => `<button data-nav="${n}" class="${n === cur ? 'active' : ''}">${n}</button>`).join('')}</div>` : ''}<div class="dlg-p" id="dlgP"></div></div>
      ${onSave ? '<div class="dlg-f"><button id="dlgCancel">Cancel</button><button id="dlgOk" class="primary">Ok</button></div>' : ''}`;
    renderPane(cur, $('#dlgP'));
    $('#dlgX').onclick = () => dlg.close();
    if (onSave) { $('#dlgCancel').onclick = () => dlg.close(); $('#dlgOk').onclick = () => { onSave(); dlg.close(); }; }
    $('#dlgBody').querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { cur = b.dataset.nav; draw(); }));
  };
  draw();
  dlg.showModal();
}

function fieldHtml(key, f, val) {
  if (f.type === 'bool') return `<label class="field"><span>${f.label}</span><input type="checkbox" data-k="${key}" ${val ? 'checked' : ''}></label>`;
  if (f.type === 'select') return `<label class="field"><span>${f.label}</span><select data-k="${key}">${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  return `<label class="field"><span>${f.label}</span><input type="${f.type}" data-k="${key}" value="${String(val ?? '').replace(/"/g, '&quot;')}" ${f.step ? `step="${f.step}"` : ''}></label>`;
}

function openSettings(startTab) {
  const draft = { ...settings };
  const navs = Object.keys(SETTINGS_SCHEMA);
  if (startTab) navs.unshift(...navs.splice(navs.indexOf(startTab), 1));
  openDialog('Settings', navs, (sec, el) => {
    el.innerHTML = Object.entries(SETTINGS_SCHEMA[sec]).map(([k, f]) => fieldHtml(k, f, draft[k])).join('') +
      (sec === 'MT5: Server' ? '<div class="row" style="margin-top:10px"><button id="mt5Connect" class="primary">Connect to MT5</button><span id="mt5Status"></span></div>' : '');
    el.querySelectorAll('[data-k]').forEach((inp) => (inp.onchange = () => {
      const f = SETTINGS_SCHEMA[sec][inp.dataset.k];
      draft[inp.dataset.k] = f.type === 'bool' ? inp.checked : f.type === 'number' ? +inp.value : inp.value;
    }));
    const btn = el.querySelector('#mt5Connect');
    if (btn) btn.onclick = async () => {
      $('#mt5Status').textContent = 'Connecting…';
      client.url = draft.bridgeUrl;
      try {
        const st = await client.connect();
        if (!st.connected || draft.login) await client.login({ login: draft.login, password: draft.password, server: draft.server, path: draft.terminalPath });
        await client.connect();
        $('#mt5Status').textContent = client.connected ? 'Connected ✓' : 'Bridge reachable but terminal not logged in';
      } catch (e) { $('#mt5Status').textContent = `Failed: ${e.message}`; }
    };
  }, async () => {
    settings = draft; saveSettings(settings);
    client.url = settings.bridgeUrl;
    applyChartOptions();
    await init(false);
  });
}
$('#settingsBtn').onclick = () => openSettings();

function openIndicators() {
  openDialog('Indicators, Metrics & Strategies', ['Built-ins', 'My Pine scripts'], (sec, el) => {
    const items = sec === 'Built-ins' ? Object.keys(BUILTINS).map((n) => ({ n, a: `b:${n}` })) : state.scripts.map((s) => ({ n: s.name, a: `p:${s.id}` }));
    el.innerHTML = items.map((i) => `<button class="list-btn" data-add="${esc(i.a)}">${esc(i.n)}</button>`).join('');
    el.onclick = (e) => {
      const a = e.target.dataset.add;
      if (!a) return;
      if (a.startsWith('b:')) { const n = a.slice(2); state.indicators.push({ kind: 'builtin', name: n, params: { ...BUILTINS[n].params } }); }
      else { const s = state.scripts.find((x) => x.id === a.slice(2)); state.indicators.push({ kind: 'pine', name: s.name, scriptId: s.id, params: {} }); }
      persistInds(); renderIndicators(); dlg.close();
    };
  });
}
$('#indBtn').onclick = openIndicators;

function editIndicator(idx) {
  const ind = state.indicators[idx];
  let fields = [];
  if (ind.kind === 'builtin') fields = Object.entries(ind.params).map(([k, v]) => ({ k, v }));
  else {
    const sc = state.scripts.find((s) => s.id === ind.scriptId);
    try { fields = compilePine(sc.code, barsArrays(), ind.params).inputs.filter((i) => typeof i.def !== 'string').map((i) => ({ k: i.title, v: ind.params[i.title] ?? i.def })); } catch { /* ignore */ }
  }
  const draft = {};
  openDialog(`${ind.name} — Inputs`, ['Inputs'], (_, el) => {
    el.innerHTML = fields.map((f) => `<label class="field"><span>${f.k}</span><input type="number" step="any" data-k="${f.k}" value="${f.v}"></label>`).join('') || 'No numeric inputs.';
    el.querySelectorAll('[data-k]').forEach((i) => (i.onchange = () => (draft[i.dataset.k] = +i.value)));
  }, () => { Object.assign(ind.params, draft); persistInds(); renderIndicators(); });
}

// ---------------- Pine editor ----------------
function showBottom(tab) {
  $('#bottom').classList.remove('hidden');
  document.querySelectorAll('#bottomTabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#bottom .pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
}
$('#bottomTabs').onclick = (e) => { if (e.target.dataset.tab) showBottom(e.target.dataset.tab); };
$('#bottomClose').onclick = () => $('#bottom').classList.add('hidden');
$('#pineBtn').onclick = () => { showBottom('pine'); renderPineList(); };

let curScript = state.scripts[0]?.id;
function renderPineList() {
  $('#pineList').innerHTML = state.scripts.map((s) => `<option value="${s.id}" ${s.id === curScript ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#pineCode').value = state.scripts.find((s) => s.id === curScript)?.code || '';
}
function saveScripts() { store.set('mt5tv.scripts', state.scripts); }
$('#pineList').onchange = (e) => { curScript = e.target.value; renderPineList(); };
$('#pineNew').onclick = () => {
  const id = 's' + Date.now();
  state.scripts.push({ id, name: 'Untitled script', code: '//@version=5\nindicator("My script", overlay=true)\nplot(ta.sma(close, 20), "SMA", color=color.blue)\n' });
  curScript = id; saveScripts(); renderPineList();
};
function saveCurrent() {
  const s = state.scripts.find((x) => x.id === curScript);
  if (!s) return null;
  s.code = $('#pineCode').value;
  try {
    const r = compilePine(s.code, barsArrays());
    s.name = r.title;
    $('#pineMsg').className = ''; $('#pineMsg').textContent = `Compiled “${r.title}”: ${r.plots.length} plot(s), ${r.inputs.length} input(s).`;
  } catch (e) { $('#pineMsg').className = 'err'; $('#pineMsg').textContent = `Compile error: ${e.message}`; return null; }
  saveScripts(); renderPineList(); renderIndicators();
  return s;
}
$('#pineSave').onclick = saveCurrent;
$('#pineAdd').onclick = () => {
  const s = saveCurrent();
  if (!s) return;
  state.indicators.push({ kind: 'pine', name: s.name, scriptId: s.id, params: {} });
  persistInds(); renderIndicators();
};
$('#pineDel').onclick = () => {
  if (!confirm('Delete this script?')) return;
  state.scripts = state.scripts.filter((s) => s.id !== curScript);
  state.indicators = state.indicators.filter((i) => i.scriptId !== curScript);
  curScript = state.scripts[0]?.id; saveScripts(); persistInds(); renderPineList(); renderIndicators();
};
$('#pineFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const id = 's' + Date.now();
  state.scripts.push({ id, name: f.name.replace(/\.\w+$/, ''), code: await f.text() });
  curScript = id; saveScripts(); renderPineList(); saveCurrent();
};
$('#pineCode').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target, p = t.selectionStart; t.value = t.value.slice(0, p) + '    ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = p + 4; }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrent(); }
});

// ---------------- Drawing tools ----------------
const svg = $('#draw');
let pending = null;
const key = () => `${state.symbol}`;
function drawingsList() { return (state.drawings[key()] ||= []); }
document.querySelectorAll('#drawbar [data-tool]').forEach((b) => (b.onclick = () => {
  if (b.dataset.tool === 'clear') { state.drawings[key()] = []; store.set('mt5tv.drawings', state.drawings); redrawDrawings(); return; }
  state.tool = b.dataset.tool; pending = null;
  document.querySelectorAll('#drawbar [data-tool]').forEach((x) => x.classList.toggle('active', x === b));
  svg.classList.toggle('drawing', state.tool !== 'cursor');
}));
function toPoint(e) {
  const r = svg.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  return { time: chart.timeScale().coordinateToTime(x), price: mainSeries.coordinateToPrice(y) };
}
svg.addEventListener('click', (e) => {
  const p = toPoint(e);
  if (p.time == null || p.price == null) return;
  const one = { hline: 1, vline: 1 }[state.tool];
  if (one) { drawingsList().push({ t: state.tool, a: p }); finish(); return; }
  if (!pending) { pending = p; return; }
  drawingsList().push({ t: state.tool, a: pending, b: p }); pending = null; finish();
});
function finish() { store.set('mt5tv.drawings', state.drawings); redrawDrawings(); }
function redrawDrawings() {
  if (!mainSeries) return;
  const ts = chart.timeScale();
  const X = (t) => ts.timeToCoordinate(t), Y = (p) => mainSeries.priceToCoordinate(p);
  const W = svg.clientWidth;
  let h = '';
  for (const d of drawingsList()) {
    const ax = X(d.a.time), ay = Y(d.a.price);
    if (d.t === 'hline' && ay != null) h += `<line x1="0" x2="${W}" y1="${ay}" y2="${ay}" stroke="#2962FF"/>`;
    if (d.t === 'vline' && ax != null) h += `<line x1="${ax}" x2="${ax}" y1="0" y2="100%" stroke="#2962FF"/>`;
    if (!d.b) continue;
    const bx = X(d.b.time), by = Y(d.b.price);
    if ([ax, ay, bx, by].some((v) => v == null)) continue;
    if (d.t === 'trend') h += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#2962FF" stroke-width="2"/>`;
    if (d.t === 'rect') h += `<rect x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" width="${Math.abs(bx - ax)}" height="${Math.abs(by - ay)}" fill="#2962FF22" stroke="#2962FF"/>`;
    if (d.t === 'fib') [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((lv) => {
      const pr = d.b.price + (d.a.price - d.b.price) * lv, y = Y(pr);
      h += `<line x1="${Math.min(ax, bx)}" x2="${Math.max(ax, bx)}" y1="${y}" y2="${y}" stroke="#FF9800"/><text x="${Math.min(ax, bx) + 2}" y="${y - 2}" fill="#FF9800" font-size="11">${lv} (${pr.toFixed(2)})</text>`;
    });
  }
  svg.innerHTML = h;
}
chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(redrawDrawings));
new ResizeObserver(() => requestAnimationFrame(redrawDrawings)).observe($('#chart'));

// Crosshair legend OHLC
chart.subscribeCrosshairMove((p) => {
  if (!p.time || !settings.showOHLC) return;
  const b = state.bars.find((x) => x.time === p.time);
  const first = $('#legend div');
  if (b && first) {
    const d = state.symbols.find((s) => s.name === state.symbol)?.digits ?? 2;
    const span = first.querySelector('span') || first.appendChild(document.createElement('span'));
    span.className = b.close >= b.open ? 'up' : 'down';
    span.textContent = ` O ${b.open.toFixed(d)} H ${b.high.toFixed(d)} L ${b.low.toFixed(d)} C ${b.close.toFixed(d)}`;
  }
});

// ---------------- Boot ----------------
async function init(first = true) {
  const st = await client.connect();
  $('#conn').textContent = client.connected ? `MT5 · ${st.server || ''} ${st.login || ''}` : 'Demo data (MT5 bridge offline)';
  $('#conn').className = `conn ${client.connected ? 'on' : 'off'}`;
  state.symbols = await client.symbols();
  if (first) log(client.connected ? 'Connected to MT5 bridge' : 'MT5 bridge not reachable — showing demo data');
  await loadChart();
}
applyChartOptions();
renderPineList();
init();
setInterval(() => client.connected && refreshTradeLevels(), 5000);
