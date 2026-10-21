// A small Pine Script (v4-v6) indicator interpreter for the chart. Whole series are computed at once, so it covers the
// usual indicator shape: inputs, variables built from ta.* / math.* and arithmetic, plot() and hline(). Anything it
// can't run (loops, var state, user functions) throws an UnsupportedPine error; the app then asks the model to
// rewrite the script into this subset. MQL5 indicators always take that route.

export class UnsupportedPine extends Error {}
const no = (m) => { throw new UnsupportedPine(m); };

export const isMql5 = (code) => /\bOnCalculate\s*\(|#property\s+indicator|SetIndexBuffer\s*\(/.test(code);

const COLORS = {
  red: '#f23645', green: '#089981', blue: '#2962ff', orange: '#ff9800', yellow: '#ffeb3b', purple: '#9c27b0', fuchsia: '#e040fb', lime: '#00e676',
  aqua: '#00bcd4', teal: '#00897b', navy: '#311b92', maroon: '#880e4f', olive: '#808000', silver: '#b2b5be', gray: '#787b86', white: '#ffffff', black: '#363a45',
};
const PALETTE = ['#2962ff', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#089981', '#f23645'];

// ---- Tokens and parser ----
const TOKEN = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{6,8})|([A-Za-z_][\w.]*)|(:=|==|!=|>=|<=|=>|\+=|-=|\*=|\/=|[-+*/%<>=?:(),[\]]))/y;
function lex(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(src);
    if (!m) no(`can't read "${src.slice(TOKEN.lastIndex, TOKEN.lastIndex + 20).trim()}"`);
    if (m[1]) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) out.push({ t: 'str', v: m[2].slice(1, -1) });
    else if (m[3]) out.push({ t: 'color', v: m[3] });
    else if (m[4]) out.push(['and', 'or', 'not', 'true', 'false', 'na'].includes(m[4]) ? { t: 'op', v: m[4] } : { t: 'id', v: m[4] });
    else out.push({ t: 'op', v: m[5] });
  }
  return out;
}

function parser(tokens) {
  let i = 0;
  const peek = (v) => tokens[i] && tokens[i].t === 'op' && tokens[i].v === v;
  const eat = (v) => { if (!peek(v)) no(`expected "${v}"`); i++; };
  const PREC = [['or'], ['and'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  function expr() {
    const c = bin(0);
    if (peek('?')) { i++; const a = expr(); eat(':'); const b = expr(); return { k: 'tern', c, a, b }; }
    return c;
  }
  function bin(lvl) {
    if (lvl === PREC.length) return unary();
    let l = bin(lvl + 1);
    while (tokens[i] && tokens[i].t === 'op' && PREC[lvl].includes(tokens[i].v)) { const op = tokens[i++].v; l = { k: 'bin', op, l, r: bin(lvl + 1) }; }
    return l;
  }
  function unary() {
    if (peek('-')) { i++; return { k: 'neg', e: unary() }; }
    if (peek('+')) { i++; return unary(); }
    if (peek('not')) { i++; return { k: 'not', e: unary() }; }
    return postfix(atom());
  }
  function postfix(e) {
    while (peek('[')) { i++; const n = expr(); eat(']'); e = { k: 'hist', e, n }; }
    return e;
  }
  function atom() {
    const tk = tokens[i++];
    if (!tk) no('unexpected end of line');
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'str') return { k: 'str', v: tk.v };
    if (tk.t === 'color') return { k: 'str', v: tk.v };
    if (tk.t === 'op' && (tk.v === 'true' || tk.v === 'false')) return { k: 'num', v: tk.v === 'true' ? 1 : 0 };
    if (tk.t === 'op' && tk.v === 'na') return { k: 'num', v: NaN };
    if (tk.t === 'op' && tk.v === '(') { const e = expr(); eat(')'); return e; }
    if (tk.t === 'id') {
      if (peek('(')) {
        i++;
        const args = [], named = {};
        while (!peek(')')) {
          if (tokens[i]?.t === 'id' && tokens[i + 1]?.t === 'op' && tokens[i + 1].v === '=') { const k = tokens[i].v; i += 2; named[k] = expr(); } else args.push(expr());
          if (!peek(')')) eat(',');
        }
        eat(')');
        return { k: 'call', f: tk.v, args, named };
      }
      return { k: 'id', v: tk.v };
    }
    no(`unexpected "${tk.v}"`);
  }
  return { expr, done: () => i >= tokens.length, tokens, at: () => i, set: (n) => { i = n; } };
}

// ---- Series maths (Float64Array, NaN = na) ----
const N = (n) => new Float64Array(n).fill(NaN);
const isS = (x) => x instanceof Float64Array;
const map2 = (a, b, n, f) => { const o = new Float64Array(n); for (let k = 0; k < n; k++) o[k] = f(isS(a) ? a[k] : a, isS(b) ? b[k] : b); return o; };
const ser = (x, n) => (isS(x) ? x : new Float64Array(n).fill(Number(x)));
const sma = (s, len) => { const n = s.length, o = N(n); let sum = 0, cnt = 0; for (let k = 0; k < n; k++) { const v = s[k]; if (Number.isNaN(v)) { sum = 0; cnt = 0; continue; } sum += v; cnt++; if (cnt > len) sum -= s[k - len]; if (cnt >= len) o[k] = sum / len; } return o; };
const emaA = (s, alpha, seed) => { const n = s.length, o = N(n); let prev = NaN, cnt = 0, acc = 0; for (let k = 0; k < n; k++) { const v = s[k]; if (Number.isNaN(v)) continue; if (Number.isNaN(prev)) { acc += v; cnt++; if (cnt >= seed) { prev = acc / seed; o[k] = prev; } continue; } prev = alpha * v + (1 - alpha) * prev; o[k] = prev; } return o; };
const ema = (s, len) => emaA(s, 2 / (len + 1), len);
const rma = (s, len) => emaA(s, 1 / len, len);
const wma = (s, len) => { const n = s.length, o = N(n), d = (len * (len + 1)) / 2; for (let k = len - 1; k < n; k++) { let x = 0; for (let j = 0; j < len; j++) x += s[k - j] * (len - j); o[k] = x / d; } return o; };
const win = (s, len, f) => { const n = s.length, o = N(n); for (let k = len - 1; k < n; k++) o[k] = f(s.subarray(k - len + 1, k + 1)); return o; };
const stdev = (s, len) => win(s, len, (w) => { const m = w.reduce((a, b) => a + b, 0) / w.length; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length); });
const shift = (s, k) => { const n = s.length, o = N(n); for (let j = k; j < n; j++) o[j] = s[j - k]; return o; };

function runPine(code, bars) {
  const n = bars.close.length;
  const src = { open: bars.open, high: bars.high, low: bars.low, close: bars.close, volume: bars.volume || N(n), time: Float64Array.from(bars.time) };
  const f = (a) => Float64Array.from(a);
  for (const k of ['open', 'high', 'low', 'close', 'volume']) src[k] = f(src[k]);
  const env = {
    ...src,
    hl2: map2(src.high, src.low, n, (a, b) => (a + b) / 2),
    hlc3: f(Array.from({ length: n }, (_, k) => (src.high[k] + src.low[k] + src.close[k]) / 3)),
    ohlc4: f(Array.from({ length: n }, (_, k) => (src.open[k] + src.high[k] + src.low[k] + src.close[k]) / 4)),
    bar_index: f(Array.from({ length: n }, (_, k) => k)),
  };
  const tr = () => { const o = N(n); for (let k = 0; k < n; k++) o[k] = k ? Math.max(src.high[k] - src.low[k], Math.abs(src.high[k] - src.close[k - 1]), Math.abs(src.low[k] - src.close[k - 1])) : src.high[k] - src.low[k]; return o; };
  const len = (x) => { const v = isS(x) ? x[n - 1] : Number(x); if (!(v >= 1)) no('a length must be a whole number of 1 or more'); return Math.round(v); };
  const rsi = (s, l) => { const ch = map2(s, shift(s, 1), n, (a, b) => a - b); const up = rma(map2(ch, 0, n, (a) => Math.max(a, 0)), l), dn = rma(map2(ch, 0, n, (a) => Math.max(-a, 0)), l); return map2(up, dn, n, (u, d) => (d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d))); };
  const cross = (a, b, dir) => { const A = ser(a, n), B = ser(b, n), o = new Float64Array(n); for (let k = 1; k < n; k++) { const up = A[k] > B[k] && A[k - 1] <= B[k - 1], dn = A[k] < B[k] && A[k - 1] >= B[k - 1]; o[k] = dir > 0 ? +up : dir < 0 ? +dn : +(up || dn); } return o; };
  const FN = {
    'ta.sma': (s, l) => sma(ser(s, n), len(l)), 'ta.ema': (s, l) => ema(ser(s, n), len(l)), 'ta.rma': (s, l) => rma(ser(s, n), len(l)), 'ta.wma': (s, l) => wma(ser(s, n), len(l)),
    'ta.hma': (s, l) => { const L = len(l); return wma(map2(wma(ser(s, n), Math.max(1, Math.floor(L / 2))), wma(ser(s, n), L), n, (a, b) => 2 * a - b), Math.max(1, Math.round(Math.sqrt(L)))); },
    'ta.vwma': (s, l) => { const L = len(l); return map2(sma(map2(s, src.volume, n, (a, b) => a * b), L), sma(src.volume, L), n, (a, b) => a / b); },
    'ta.rsi': (s, l) => rsi(ser(s, n), len(l)), 'ta.tr': () => tr(), 'ta.atr': (l) => rma(tr(), len(l)), 'ta.stdev': (s, l) => stdev(ser(s, n), len(l)),
    'ta.highest': (s, l) => (l === undefined ? win(src.high, len(s), (w) => Math.max(...w)) : win(ser(s, n), len(l), (w) => Math.max(...w))),
    'ta.lowest': (s, l) => (l === undefined ? win(src.low, len(s), (w) => Math.min(...w)) : win(ser(s, n), len(l), (w) => Math.min(...w))),
    'ta.change': (s, l = 1) => map2(ser(s, n), shift(ser(s, n), len(l)), n, (a, b) => a - b), 'ta.mom': (s, l) => map2(ser(s, n), shift(ser(s, n), len(l)), n, (a, b) => a - b),
    'ta.roc': (s, l) => map2(ser(s, n), shift(ser(s, n), len(l)), n, (a, b) => (100 * (a - b)) / b),
    'ta.cum': (s) => { const o = new Float64Array(n); let c = 0; for (let k = 0; k < n; k++) { c += Number.isNaN(s[k]) ? 0 : s[k]; o[k] = c; } return o; },
    'ta.crossover': (a, b) => cross(a, b, 1), 'ta.crossunder': (a, b) => cross(a, b, -1), 'ta.cross': (a, b) => cross(a, b, 0),
    'ta.vwap': (s = env.hlc3) => { const o = N(n); let pv = 0, v = 0, day = null; for (let k = 0; k < n; k++) { const d = Math.floor(src.time[k] / 86400000); if (d !== day) { day = d; pv = 0; v = 0; } const vol = src.volume[k] || 1; pv += s[k] * vol; v += vol; o[k] = pv / v; } return o; },
    'ta.macd': (s, a, b, c) => { const m = map2(ema(ser(s, n), len(a)), ema(ser(s, n), len(b)), n, (x, y) => x - y); const sig = ema(m, len(c)); return [m, sig, map2(m, sig, n, (x, y) => x - y)]; },
    'ta.bb': (s, l, mult) => { const mid = sma(ser(s, n), len(l)), dev = stdev(ser(s, n), len(l)); return [mid, map2(mid, map2(dev, mult, n, (x, y) => x * y), n, (x, y) => x + y), map2(mid, map2(dev, mult, n, (x, y) => x * y), n, (x, y) => x - y)]; },
    'ta.stoch': (s, h, l, L) => { const hh = win(ser(h, n), len(L), (w) => Math.max(...w)), ll = win(ser(l, n), len(L), (w) => Math.min(...w)); const o = N(n); for (let k = 0; k < n; k++) o[k] = (100 * (s[k] - ll[k])) / (hh[k] - ll[k]); return o; },
    'math.abs': (x) => map2(x, 0, n, Math.abs), 'math.sqrt': (x) => map2(x, 0, n, Math.sqrt), 'math.log': (x) => map2(x, 0, n, Math.log), 'math.exp': (x) => map2(x, 0, n, Math.exp),
    'math.round': (x) => map2(x, 0, n, Math.round), 'math.floor': (x) => map2(x, 0, n, Math.floor), 'math.ceil': (x) => map2(x, 0, n, Math.ceil),
    'math.pow': (a, b) => map2(a, b, n, Math.pow), 'math.max': (...a) => a.reduce((x, y) => map2(x, y, n, Math.max)), 'math.min': (...a) => a.reduce((x, y) => map2(x, y, n, Math.min)),
    'math.avg': (...a) => map2(a.reduce((x, y) => map2(x, y, n, (p, q) => p + q)), a.length, n, (p, q) => p / q),
    nz: (x, r = 0) => map2(x, r, n, (a, b) => (Number.isNaN(a) ? b : a)), na: (x) => map2(x, 0, n, (a) => +Number.isNaN(a)),
    fixnan: (x) => { const o = Float64Array.from(ser(x, n)); for (let k = 1; k < n; k++) if (Number.isNaN(o[k])) o[k] = o[k - 1]; return o; },
    'color.new': (c) => c, 'color.rgb': (r, g, b) => `rgb(${r},${g},${b})`,
  };
  // Pine v4 names (sma, ema, rsi, ...) map onto ta.* / math.*
  for (const k of Object.keys(FN)) { const short = k.split('.')[1]; if (short && !FN[short] && k.startsWith('ta.')) FN[short] = FN[k]; }
  Object.assign(FN, { abs: FN['math.abs'], max: FN['math.max'], min: FN['math.min'], sqrt: FN['math.sqrt'], log: FN['math.log'], pow: FN['math.pow'], round: FN['math.round'], avg: FN['math.avg'] });

  const ev = (e) => {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'id':
        if (e.v in env) return env[e.v];
        if (e.v.startsWith('color.')) return COLORS[e.v.slice(6)] || '#2962ff';
        if (/^(ta\.tr|tr)$/.test(e.v)) return tr();
        return no(`"${e.v}" isn't defined`);
      case 'neg': return map2(ev(e.e), 0, n, (a) => -a);
      case 'not': return map2(ev(e.e), 0, n, (a) => +!a);
      case 'hist': { const v = ev(e.e); return isS(v) ? shift(v, len(ev(e.n))) : v; }
      case 'tern': { const c = ev(e.c), a = ev(e.a), b = ev(e.b); if (typeof a === 'string' || typeof b === 'string') return a; return map2(map2(c, a, n, (x, y) => (x ? y : NaN)), map2(c, b, n, (x, y) => (x ? NaN : y)), n, (x, y) => (Number.isNaN(x) ? y : x)); }
      case 'bin': {
        const a = ev(e.l), b = ev(e.r);
        const OPS = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '%': (x, y) => x % y, '>': (x, y) => +(x > y), '<': (x, y) => +(x < y), '>=': (x, y) => +(x >= y), '<=': (x, y) => +(x <= y), '==': (x, y) => +(x === y), '!=': (x, y) => +(x !== y), and: (x, y) => +(!!x && !!y), or: (x, y) => +(!!x || !!y) };
        if (!isS(a) && !isS(b)) return OPS[e.op](a, b);
        return map2(a, b, n, OPS[e.op]);
      }
      case 'call': {
        const fn = e.f;
        if (/^input(\.\w+)?$/.test(fn)) { const d = e.args[0] ?? e.named.defval; return d ? ev(d) : 0; }
        if (!FN[fn]) return no(`${fn}() isn't supported`);
        return FN[fn](...e.args.map(ev));
      }
      default: return no('unknown expression');
    }
  };

  // Logical lines: drop comments, join wrapped lines (open brackets or a line ending in an operator / comma)
  const raw = code.replace(/\r/g, '').split('\n').map((l) => l.replace(/\/\/.*$/, ''));
  const lines = [];
  let buf = '';
  for (const l of raw) {
    buf = buf ? `${buf} ${l.trim()}` : l;
    const depth = (buf.match(/[([]/g) || []).length - (buf.match(/[)\]]/g) || []).length;
    if (depth > 0 || /(,|[-+*/?:]|\band|\bor)\s*$/.test(buf.trim())) continue;
    if (buf.trim()) lines.push(buf);
    buf = '';
  }
  if (buf.trim()) lines.push(buf);

  let title = 'Indicator', overlay = false, pi = 0;
  const plots = [], hlines = [];
  for (const line of lines) {
    if (/^\s+\S/.test(line)) no('indented blocks (if / for / functions) need the rewrite');
    const s = line.trim();
    if (/^(strategy)\s*\(/.test(s)) no('this is a strategy, not an indicator');
    if (/^(for|while|if|switch|var|varip|import|export|type|method)\b/.test(s) || /=>/.test(s)) no(`"${s.split(/\s/)[0]}" needs the rewrite`);
    const toks = lex(s);
    // Tuple assignment: [a, b, c] = ta.macd(...)
    if (toks[0]?.v === '[' && toks.some((t) => t.v === '=')) {
      const eq = toks.findIndex((t) => t.v === '=');
      const names = toks.slice(1, eq - 1).filter((t) => t.t === 'id').map((t) => t.v);
      const p = parser(toks.slice(eq + 1)); const val = ev(p.expr());
      if (!Array.isArray(val)) no('only ta.macd / ta.bb return several values');
      names.forEach((nm, k) => { env[nm] = val[k]; });
      continue;
    }
    // Assignment: [type] name = expr  /  name := expr  /  name += expr
    let j = 0;
    if (toks[0]?.t === 'id' && /^(float|int|bool|color|string|series|simple|const)$/.test(toks[0].v) && toks[1]?.t === 'id') j = 1;
    if (toks[j]?.t === 'id' && toks[j + 1]?.t === 'op' && ['=', ':=', '+=', '-=', '*=', '/='].includes(toks[j + 1].v)) {
      const name = toks[j].v, op = toks[j + 1].v;
      const p = parser(toks.slice(j + 2)); let val = ev(p.expr());
      if (!p.done()) no(`couldn't read the end of "${s}"`);
      if (op !== '=' && op !== ':=') { if (!(name in env)) no(`"${name}" isn't defined`); val = map2(env[name], val, n, { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y }[op[0]]); }
      env[name] = val;
      continue;
    }
    const p = parser(toks); const e = p.expr();
    if (!p.done()) no(`couldn't read the end of "${s}"`);
    if (e.k !== 'call') no(`"${s}" isn't a statement this runs`);
    if (e.f === 'indicator' || e.f === 'study') {
      const t = e.args[0] || e.named.title; if (t) title = String(ev(t));
      if (e.named.overlay) overlay = !!ev(e.named.overlay);
      continue;
    }
    if (e.f === 'plot') {
      const v = ev(e.args[0]);
      const t = e.named.title ?? e.args[1];
      const c = e.named.color ?? e.args[2];
      const color = c ? ev(c) : null;
      plots.push({ name: t ? String(ev(t)) : `Plot ${plots.length + 1}`, color: typeof color === 'string' ? color : PALETTE[pi++ % PALETTE.length], width: e.named.linewidth ? Number(ev(e.named.linewidth)) : 1.5, values: ser(v, n) });
      continue;
    }
    if (e.f === 'hline') { const v = ev(e.args[0]); const c = e.named.color ? ev(e.named.color) : '#787b86'; hlines.push({ price: Number(v), color: typeof c === 'string' ? c : '#787b86' }); continue; }
    if (/^(plotshape|plotchar|plotarrow|plotcandle|plotbar|bgcolor|barcolor|fill|alertcondition|alert|label\.new|line\.new|box\.new|table\.\w+)$/.test(e.f)) continue;
    no(`${e.f}() isn't supported`);
  }
  if (!plots.length && !hlines.length) no('the script has no plot()');
  return { title, overlay, plots, hlines };
}

// Run a Pine indicator on the bars: { title, overlay, plots: [{ name, color, width, values }], hlines }
export function runIndicator(code, bars) {
  if (isMql5(code)) no('MQL5 indicators are rewritten to Pine first');
  return runPine(String(code), bars);
}
