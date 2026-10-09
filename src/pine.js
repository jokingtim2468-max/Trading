// Pine Script interpreter (vectorised subset of Pine v5/v6).
// Supports: indicator()/study(), input.*, variable assignment (= and :=),
// arithmetic/comparison/logical ops, ternary, history operator x[n],
// ta.* functions, math.*, color.*, plot(), hline(), plotshape() markers.
import * as ta from './indicators.js';

const COLORS = {
  red: '#F23645', green: '#089981', blue: '#2962FF', orange: '#FF9800', yellow: '#FFEB3B',
  purple: '#9C27B0', aqua: '#00BCD4', teal: '#009688', white: '#FFFFFF', black: '#000000',
  gray: '#787B86', silver: '#B2B5BE', lime: '#00E676', maroon: '#880E4F', navy: '#311B92',
  olive: '#808000', fuchsia: '#E040FB',
};

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:(\/\/[^\n]*)|(\d+\.?\d*(?:e[+-]?\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{6,8})|([A-Za-z_][\w.]*)|(:=|==|!=|<=|>=|\?|[-+*/%<>()=,:\[\]\n]))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(start))) break;
      throw new Error(`Unexpected character near: ${src.slice(start, start + 15)}`);
    }
    if (m[1]) continue;
    if (m[2]) toks.push({ t: 'num', v: parseFloat(m[2]) });
    else if (m[3]) toks.push({ t: 'str', v: m[3].slice(1, -1) });
    else if (m[4]) toks.push({ t: 'color', v: m[4] });
    else if (m[5]) toks.push({ t: 'id', v: m[5] });
    else if (m[6]) toks.push({ t: 'op', v: m[6] });
  }
  return toks;
}

class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  isOp(v) { const p = this.peek(); return p && p.t === 'op' && p.v === v; }
  expect(v) { if (!this.isOp(v)) throw new Error(`Expected '${v}'`); this.next(); }

  program() {
    const stmts = [];
    for (;;) {
      while (this.isOp('\n')) this.next();
      if (!this.peek()) break;
      stmts.push(this.statement());
    }
    return stmts;
  }
  statement() {
    let p = this.peek();
    if (p.t === 'id' && (p.v === 'var' || p.v === 'varip' || p.v === 'float' || p.v === 'int' || p.v === 'bool' || p.v === 'series' || p.v === 'simple')) {
      const nx = this.toks[this.i + 1];
      if (nx && nx.t === 'id') this.next();
      p = this.peek();
    }
    const nx = this.toks[this.i + 1];
    if (p.t === 'id' && nx && nx.t === 'op' && (nx.v === '=' || nx.v === ':=')) {
      this.next(); this.next();
      return { k: 'assign', name: p.v, expr: this.expr() };
    }
    return { k: 'expr', expr: this.expr() };
  }
  expr() { return this.ternary(); }
  ternary() {
    const c = this.binary(0);
    if (this.isOp('?')) { this.next(); const a = this.expr(); this.expect(':'); const b = this.expr(); return { k: 'tern', c, a, b }; }
    return c;
  }
  binary(minPrec) {
    const PREC = { or: 1, and: 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    let left = this.unary();
    for (;;) {
      const p = this.peek();
      if (!p) break;
      const op = p.t === 'op' || (p.t === 'id' && (p.v === 'and' || p.v === 'or')) ? p.v : null;
      const prec = op && PREC[op];
      if (!prec || prec < minPrec) break;
      this.next();
      const right = this.binary(prec + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }
  unary() {
    if (this.isOp('-')) { this.next(); return { k: 'neg', a: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    const p = this.peek();
    if (p && p.t === 'id' && p.v === 'not') { this.next(); return { k: 'not', a: this.unary() }; }
    return this.postfix(this.primary());
  }
  postfix(node) {
    for (;;) {
      if (this.isOp('[')) { this.next(); const off = this.expr(); this.expect(']'); node = { k: 'hist', a: node, off }; }
      else break;
    }
    return node;
  }
  primary() {
    const p = this.next();
    if (!p) throw new Error('Unexpected end of script');
    if (p.t === 'num') return { k: 'num', v: p.v };
    if (p.t === 'str') return { k: 'str', v: p.v };
    if (p.t === 'color') return { k: 'str', v: p.v };
    if (p.t === 'op' && p.v === '(') { const e = this.expr(); this.expect(')'); return e; }
    if (p.t === 'op' && p.v === '[') {
      const items = [];
      while (!this.isOp(']')) { items.push(this.expr()); if (this.isOp(',')) this.next(); }
      this.next();
      return { k: 'tuple', items };
    }
    if (p.t === 'id') {
      if (this.isOp('(')) {
        this.next();
        const args = [], kw = {};
        while (this.isOp('\n')) this.next();
        while (!this.isOp(')')) {
          const a = this.peek(), b = this.toks[this.i + 1];
          if (a.t === 'id' && b && b.t === 'op' && b.v === '=') { this.next(); this.next(); kw[a.v] = this.expr(); }
          else args.push(this.expr());
          while (this.isOp('\n')) this.next();
          if (this.isOp(',')) this.next();
          while (this.isOp('\n')) this.next();
        }
        this.next();
        return { k: 'call', name: p.v, args, kw };
      }
      return { k: 'id', v: p.v };
    }
    throw new Error(`Unexpected token '${p.v}'`);
  }
}

const isArr = Array.isArray;
function lift2(a, b, f) {
  if (!isArr(a) && !isArr(b)) return f(a, b);
  const n = isArr(a) ? a.length : b.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = f(isArr(a) ? a[i] : a, isArr(b) ? b[i] : b);
  return out;
}
const lift1 = (a, f) => (isArr(a) ? a.map(f) : f(a));
const series = (v, n) => (isArr(v) ? v : new Array(n).fill(v));

export function runPine(source, bars, inputOverrides = {}) {
  const ast = new Parser(tokenize(source.replace(/\r/g, ''))).program();
  const n = bars.close.length;
  const env = {
    open: bars.open, high: bars.high, low: bars.low, close: bars.close, volume: bars.volume,
    hl2: bars.high.map((h, i) => (h + bars.low[i]) / 2),
    hlc3: bars.high.map((h, i) => (h + bars.low[i] + bars.close[i]) / 3),
    ohlc4: bars.open.map((o, i) => (o + bars.high[i] + bars.low[i] + bars.close[i]) / 4),
    bar_index: bars.close.map((_, i) => i), na: NaN, true: true, false: false,
  };
  const result = { title: 'Script', overlay: false, plots: [], hlines: [], markers: [], inputs: [] };
  let inputIdx = 0;

  const fns = {
    indicator: (a, kw) => { result.title = a[0] ?? kw.title ?? result.title; result.overlay = !!(kw.overlay ?? a[1] ?? false); },
    plot: (a, kw) => { result.plots.push({ name: kw.title ?? a[1] ?? `Plot ${result.plots.length + 1}`, data: series(a[0], n), color: kw.color ?? a[2] ?? '#2962FF', width: kw.linewidth ?? 1, type: kw.style === 'histogram' ? 'histogram' : 'line' }); },
    hline: (a, kw) => { result.hlines.push({ price: a[0], name: kw.title ?? a[1] ?? '', color: kw.color ?? '#787B86' }); },
    plotshape: (a, kw) => {
      const cond = series(a[0], n);
      const above = (kw.location ?? 'location.abovebar') === 'location.abovebar';
      cond.forEach((c, i) => c && c === c && result.markers.push({ index: i, position: above ? 'aboveBar' : 'belowBar', color: kw.color ?? '#2962FF', shape: above ? 'arrowDown' : 'arrowUp', text: kw.text ?? '' }));
    },
    input: (a, kw) => {
      const idx = inputIdx++;
      const def = a[0] ?? kw.defval;
      const title = kw.title ?? a[1] ?? `Input ${idx + 1}`;
      result.inputs.push({ title, def: isArr(def) ? 'source' : def });
      if (title in inputOverrides) return inputOverrides[title];
      return def;
    },
    'na': (a) => lift1(a[0], (v) => v !== v),
    'nz': (a) => lift1(a[0], (v) => (v !== v ? (a[1] ?? 0) : v)),
    'ta.sma': (a) => ta.sma(series(a[0], n), a[1]),
    'ta.ema': (a) => ta.ema(series(a[0], n), a[1]),
    'ta.rma': (a) => ta.rma(series(a[0], n), a[1]),
    'ta.wma': (a) => ta.wma(series(a[0], n), a[1]),
    'ta.rsi': (a) => ta.rsi(series(a[0], n), a[1]),
    'ta.stdev': (a) => ta.stdev(series(a[0], n), a[1]),
    'ta.atr': (a) => ta.atr(bars.high, bars.low, bars.close, a[0]),
    'ta.tr': () => ta.tr(bars.high, bars.low, bars.close),
    'ta.highest': (a) => (a.length === 1 ? ta.highest(bars.high, a[0]) : ta.highest(series(a[0], n), a[1])),
    'ta.lowest': (a) => (a.length === 1 ? ta.lowest(bars.low, a[0]) : ta.lowest(series(a[0], n), a[1])),
    'ta.vwap': () => ta.vwap(bars.high, bars.low, bars.close, bars.volume),
    'ta.stoch': (a) => ta.stoch(series(a[0], n), series(a[1], n), series(a[2], n), a[3]),
    'ta.macd': (a) => { const m = ta.macd(series(a[0], n), a[1], a[2], a[3]); return { tuple: [m.line, m.signal, m.hist] }; },
    'ta.bb': (a) => { const b = ta.bb(series(a[0], n), a[1], a[2]); return { tuple: [b.basis, b.upper, b.lower] }; },
    'ta.change': (a) => { const s = series(a[0], n), l = a[1] ?? 1; return s.map((v, i) => (i < l ? NaN : v - s[i - l])); },
    'ta.crossover': (a) => { const x = series(a[0], n), y = series(a[1], n); return x.map((v, i) => i > 0 && v > y[i] && x[i - 1] <= y[i - 1]); },
    'ta.crossunder': (a) => { const x = series(a[0], n), y = series(a[1], n); return x.map((v, i) => i > 0 && v < y[i] && x[i - 1] >= y[i - 1]); },
    'math.abs': (a) => lift1(a[0], Math.abs),
    'math.sqrt': (a) => lift1(a[0], Math.sqrt),
    'math.log': (a) => lift1(a[0], Math.log),
    'math.round': (a) => lift1(a[0], Math.round),
    'math.max': (a) => a.reduce((x, y) => lift2(x, y, Math.max)),
    'math.min': (a) => a.reduce((x, y) => lift2(x, y, Math.min)),
    'math.pow': (a) => lift2(a[0], a[1], Math.pow),
    '__idx': (a) => a[0].tuple[a[1]],
    'color.new': (a) => a[0],
    'color.rgb': (a) => `rgb(${a[0]},${a[1]},${a[2]})`,
  };
  fns.study = fns.indicator;
  fns.strategy = fns.indicator;
  for (const t of ['int', 'float', 'bool', 'string', 'source', 'color', 'timeframe', 'symbol', 'session', 'price']) fns[`input.${t}`] = fns.input;

  function ev(node) {
    switch (node.k) {
      case 'num': case 'str': return node.v;
      case 'id': {
        if (node.v in env) return env[node.v];
        if (node.v.startsWith('color.')) return COLORS[node.v.slice(6)] ?? '#2962FF';
        if (node.v.startsWith('location.') || node.v.startsWith('shape.') || node.v.startsWith('plot.style_')) return node.v.replace('plot.style_', '');
        if (node.v === 'math.pi') return Math.PI;
        throw new Error(`Undeclared identifier '${node.v}'`);
      }
      case 'neg': return lift1(ev(node.a), (v) => -v);
      case 'not': return lift1(ev(node.a), (v) => !v);
      case 'tern': { const c = ev(node.c), a = ev(node.a), b = ev(node.b); if (!isArr(c)) return c ? a : b; return c.map((v, i) => (v ? (isArr(a) ? a[i] : a) : isArr(b) ? b[i] : b)); }
      case 'hist': { const s = ev(node.a), o = ev(node.off); if (!isArr(s)) return s; return s.map((_, i) => (i - o >= 0 ? s[i - o] : NaN)); }
      case 'tuple': return { tuple: node.items.map(ev) };
      case 'bin': {
        const a = ev(node.a), b = ev(node.b);
        const ops = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '%': (x, y) => x % y,
          '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y, '==': (x, y) => x === y, '!=': (x, y) => x !== y,
          and: (x, y) => !!(x && y), or: (x, y) => !!(x || y) };
        return lift2(a, b, ops[node.op]);
      }
      case 'call': {
        const f = fns[node.name];
        if (!f) throw new Error(`Function '${node.name}' is not supported yet`);
        const kw = {};
        for (const k in node.kw) kw[k] = ev(node.kw[k]);
        return f(node.args.map(ev), kw);
      }
    }
  }

  for (const st of ast) {
    if (st.k === 'assign') {
      const v = ev(st.expr);
      env[st.name] = v;
    } else ev(st.expr);
  }
  return result;
}

// Tuple destructuring `[a, b, c] = f(...)` is rewritten before parsing.
export function compilePine(source, bars, overrides) {
  const rewritten = source.replace(/^\s*\[([^\]]+)\]\s*=\s*(.+)$/gm, (_, names, rhs) => {
    const ns = names.split(',').map((s) => s.trim());
    const tmp = `__t${Math.random().toString(36).slice(2, 8)}`;
    return [`${tmp} = ${rhs}`, ...ns.map((nm, i) => `${nm} = __idx(${tmp}, ${i})`)].join('\n');
  });
  return runPine(rewritten, bars, overrides);
}
