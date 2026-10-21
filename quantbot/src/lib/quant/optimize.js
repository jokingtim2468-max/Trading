// Parameter optimization ("ML trials"): take the script the model wrote, try variations of its signal/exit inputs,
// backtest each, and keep the variant that holds up best OUT-OF-SAMPLE — not the one with the prettiest in-sample
// curve. The winner is the same script with tuned numbers, so it stays a real .pine/.mq5 the copier can run (unlike a
// neural net, which can't be baked back into Pine/MQL5). Pure except for the injected `backtest` function, so unit-tested.
import { scoreOf } from '../agents/loopfixScore.js';

// Inputs worth tuning are the signal/exit knobs — not position size, firm caps, magic numbers or slippage, which
// don't change whether the strategy has an edge.
const TUNABLE = /(tp|ratio|atr|period|length|len|mult|factor|threshold|stop|pad|band|dev|smooth|fast|slow|rsi|ema|sma|lookback|trail|offset)/i;
const SKIP = /(magic|slippage|slip|lots|risk|size|dailyprofit|dailyloss|lossfloor|profitcap|cap|balance|spread)/i;

// Numeric input declarations: Pine `x = input.float(2.0, ...)` / `input.int(14, ...)` / `input(14, ...)`;
// MQL5 `input double TpRatio = 2.0;` / `input int Period = 14;`. -> [{ name, value, kind, tunable }]
export function parseInputs(code, language) {
  const out = [];
  const seen = new Set();
  const add = (name, raw, kind) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    out.push({ name, value, kind, tunable: TUNABLE.test(name) && !SKIP.test(name) });
  };
  if (language === 'Pine') {
    for (const m of code.matchAll(/(\w+)\s*=\s*input\.(int|float)\s*\(\s*(-?\d+(?:\.\d+)?)/g)) add(m[1], m[3], m[2]);
    for (const m of code.matchAll(/(\w+)\s*=\s*input\s*\(\s*(-?\d+(?:\.\d+)?)/g)) add(m[1], m[2], m[2].includes('.') ? 'float' : 'int');
  } else {
    for (const m of code.matchAll(/input\s+(int|double|long|ulong|float)\s+(\w+)\s*=\s*(-?\d+(?:\.\d+)?)/g)) add(m[2], m[3], /int|long/.test(m[1]) ? 'int' : 'float');
  }
  return out;
}

// Replace one input's default value in the source, matching by name so nothing else is touched.
export function applyInputs(code, language, values) {
  let out = code;
  for (const [name, v] of Object.entries(values)) {
    const val = String(v);
    if (language === 'Pine') {
      out = out.replace(new RegExp(`(${name}\\s*=\\s*input(?:\\.(?:int|float))?\\s*\\(\\s*)(-?\\d+(?:\\.\\d+)?)`), `$1${val}`);
    } else {
      out = out.replace(new RegExp(`(input\\s+(?:int|double|long|ulong|float)\\s+${name}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)`), `$1${val}`);
    }
  }
  return out;
}

// A deterministic spread of trial values around a default: ±40% for floats, ±50% (min 1 step) for ints.
function candidates(inp) {
  const base = inp.value;
  const factors = [0.6, 0.8, 1.2, 1.4];
  const vals = factors.map((f) => (inp.kind === 'int' ? Math.max(1, Math.round(base * f)) : Math.round(base * f * 1000) / 1000));
  return [...new Set(vals)].filter((v) => v !== base);
}

// Build up to `trials` parameter sets by perturbing the tunable inputs one or two at a time (cheap, readable search).
export function trialSets(inputs, trials = 6) {
  const tunable = inputs.filter((i) => i.tunable);
  if (!tunable.length) return [];
  const sets = [];
  for (const inp of tunable) { for (const v of candidates(inp)) { sets.push({ [inp.name]: v }); if (sets.length >= trials) return sets; } }
  // If there's room, a couple of combined tweaks of the two most-tunable inputs
  if (tunable.length >= 2 && sets.length < trials) {
    const [a, b] = tunable;
    for (const va of candidates(a)) for (const vb of candidates(b)) { sets.push({ [a.name]: va, [b.name]: vb }); if (sets.length >= trials) return sets; }
  }
  return sets.slice(0, trials);
}

// Run the vanilla script and the trial variants; keep the best by out-of-sample robustness score. backtest(code) ->
// { results, errors } (the same shape backtestScript returns). onPhase(text) for progress.
export async function optimizeScript({ code, language, trials = 6, backtest, onPhase = () => {} }) {
  onPhase('backtesting the script as written…');
  const vanillaRes = await backtest(code);
  const vanilla = { code, params: null, ...scoreOf(vanillaRes.results), results: vanillaRes.results };
  const inputs = parseInputs(code, language);
  const sets = trialSets(inputs, trials);
  let best = vanilla;
  const tried = [];
  for (let i = 0; i < sets.length; i++) {
    onPhase(`optimization trial ${i + 1} of ${sets.length}…`);
    const variantCode = applyInputs(code, language, sets[i]);
    if (variantCode === code) continue;
    const res = await backtest(variantCode);
    const sc = scoreOf(res.results);
    tried.push({ params: sets[i], score: sc.score, oosHolds: sc.oosHolds, pf: sc.pf, net: sc.net });
    if (sc.score > best.score) best = { code: variantCode, params: sets[i], ...sc, results: res.results };
  }
  return {
    vanilla: { score: vanilla.score, pf: vanilla.pf, net: vanilla.net, ddPct: vanilla.ddPct, oosHolds: vanilla.oosHolds, robust: vanilla.robust },
    best,
    improved: best !== vanilla,
    tunable: inputs.filter((i) => i.tunable).map((i) => i.name),
    tried,
  };
}
