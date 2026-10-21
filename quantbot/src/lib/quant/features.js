// The quant-data engine: turns raw candles into the numbers and series a quant looks at before trusting a market —
// and the exact feature pack an ML signal filter would train on. Pure (no app imports), so it is unit-tested and can
// run in a worker. Input bars: { time, open, high, low, close, volume?, spread? } as arrays/typed arrays.
const r = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const std = (a, m = mean(a)) => (a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0);

// London/NY/Asia on broker server time (UTC+2/3 ≈ New York + 7h), matching the backtest engine's bar times.
const SESSION = (h) => (h >= 9 && h < 13 ? 'Asia' : h >= 13 && h < 17 ? 'Pre-London' : h >= 17 && h < 21 ? 'London' : h >= 21 || h < 1 ? 'New York' : 'Off');

export function quantFeatures(bars) {
  const n = bars.time.length;
  if (n < 50) return null;

  const ret = new Array(n - 1);          // per-bar % return
  const tr = new Array(n - 1);           // true range (points)
  const gaps = new Array(n - 1);         // open vs previous close (points)
  const hour = Array.from({ length: 24 }, () => ({ range: 0, n: 0, ret: 0 }));
  const wday = Array.from({ length: 7 }, () => ({ range: 0, n: 0, ret: 0 }));
  const sess = {};
  let upAfterUp = 0, ups = 0, prevUp = false, breakout = 0, runUp = 0, runDn = 0, maxUp = 0, maxDn = 0;

  for (let i = 1; i < n; i++) {
    const rr = ((bars.close[i] - bars.close[i - 1]) / bars.close[i - 1]) * 100;
    ret[i - 1] = rr;
    tr[i - 1] = Math.max(bars.high[i], bars.close[i - 1]) - Math.min(bars.low[i], bars.close[i - 1]);
    gaps[i - 1] = Math.abs(bars.open[i] - bars.close[i - 1]);
    const up = rr > 0;
    if (prevUp && up) upAfterUp++;
    if (prevUp) ups++;      // count of bars that followed an up bar
    if (up) { runUp++; runDn = 0; maxUp = Math.max(maxUp, runUp); } else { runDn++; runUp = 0; maxDn = Math.max(maxDn, runDn); }
    if (bars.high[i] > bars.high[i - 1] || bars.low[i] < bars.low[i - 1]) breakout++; // moved beyond the prior bar
    prevUp = up;
    const d = new Date(bars.time[i]);
    const h = hour[d.getUTCHours()]; h.range += bars.high[i] - bars.low[i]; h.ret += rr; h.n++;
    const w = wday[d.getUTCDay()]; w.range += bars.high[i] - bars.low[i]; w.ret += rr; w.n++;
    const s = sess[SESSION(d.getUTCHours())] || (sess[SESSION(d.getUTCHours())] = { range: 0, n: 0, ret: 0 });
    s.range += bars.high[i] - bars.low[i]; s.ret += rr; s.n++;
  }

  // Return distribution: 21 buckets across ±3 standard deviations
  const m = mean(ret), sd = std(ret, m);
  const B = 21, lo = m - 3 * sd, step = (6 * sd) / B || 1;
  const hist = Array.from({ length: B }, (_, k) => ({ from: r(lo + k * step, 3), to: r(lo + (k + 1) * step, 3), count: 0 }));
  for (const x of ret) { const k = Math.max(0, Math.min(B - 1, Math.floor((x - lo) / step))); hist[k].count++; }

  // Autocorrelation of returns at lags 1..5 (does a move tend to continue or reverse?)
  const autocorr = [];
  for (let lag = 1; lag <= 5; lag++) {
    let num = 0, den = 0;
    for (let i = 0; i < ret.length; i++) { const a = ret[i] - m; den += a * a; if (i >= lag) num += a * (ret[i - lag] - m); }
    autocorr.push({ lag, value: r(den ? num / den : 0, 3) });
  }

  // ATR(14) sampled to ~120 points for a regime line
  const atr = [], P = 14;
  for (let i = P; i < tr.length; i++) atr.push({ t: bars.time[i + 1], v: mean(tr.slice(i - P, i)) });
  const atrLine = atr.filter((_, i) => i % Math.max(1, Math.ceil(atr.length / 120)) === 0).map((p) => ({ t: p.t, v: r(p.v) }));

  const skew = sd ? mean(ret.map((x) => ((x - m) / sd) ** 3)) : 0;
  const kurt = sd ? mean(ret.map((x) => ((x - m) / sd) ** 4)) : 0;
  const upRate = ret.filter((x) => x > 0).length / ret.length;

  return {
    meta: { bars: n, from: new Date(bars.time[0]).toISOString().slice(0, 10), to: new Date(bars.time[n - 1]).toISOString().slice(0, 10), periodReturnPct: r(((bars.close[n - 1] - bars.close[0]) / bars.close[0]) * 100) },
    returns: { meanPct: r(m, 4), stdPct: r(sd, 4), skew: r(skew), kurtosis: r(kurt), upRatePct: r(upRate * 100, 1), hist },
    volatility: {
      barTR: { median: r(median(tr)), p80: r([...tr].sort((a, b) => a - b)[Math.floor(0.8 * (tr.length - 1))]), p95: r([...tr].sort((a, b) => a - b)[Math.floor(0.95 * (tr.length - 1))]) },
      byHour: hour.map((h, i) => ({ hour: i, avgRange: h.n ? r(h.range / h.n) : 0, avgRetPct: h.n ? r(h.ret / h.n, 4) : 0, n: h.n })),
      byWeekday: wday.map((w, i) => ({ day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], avgRange: w.n ? r(w.range / w.n) : 0, avgRetPct: w.n ? r(w.ret / w.n, 4) : 0, n: w.n })),
      bySession: Object.entries(sess).map(([name, s]) => ({ name, avgRange: r(s.range / s.n), avgRetPct: r(s.ret / s.n, 4), n: s.n })).sort((a, b) => b.avgRange - a.avgRange),
    },
    autocorr,
    structure: {
      momentumBiasPct: r((ups ? upAfterUp / ups : 0) * 100, 1),  // P(up | previous bar up)
      baseUpRatePct: r(upRate * 100, 1),                          // vs the unconditional rate
      breakoutRatePct: r((breakout / (n - 1)) * 100, 1),          // bars that extend beyond the prior bar (trend vs chop)
      longestUpRun: maxUp, longestDownRun: maxDn,
      medianGap: r(median(gaps)), gapRatePct: r((gaps.filter((g) => g > 0).length / gaps.length) * 100, 1),
    },
    atr: atrLine,
  };
}

// A flat row of numbers per feature group — what an ML model would take as its input vector (one row per market/run)
export function featureVector(f) {
  if (!f) return null;
  const v = {};
  v.ret_mean = f.returns.meanPct; v.ret_std = f.returns.stdPct; v.ret_skew = f.returns.skew; v.ret_kurt = f.returns.kurtosis; v.up_rate = f.returns.upRatePct;
  v.tr_median = f.volatility.barTR.median; v.tr_p95 = f.volatility.barTR.p95;
  f.autocorr.forEach((a) => { v[`autocorr_${a.lag}`] = a.value; });
  v.momentum_bias = f.structure.momentumBiasPct; v.breakout_rate = f.structure.breakoutRatePct; v.gap_rate = f.structure.gapRatePct;
  f.volatility.byHour.forEach((h) => { v[`range_h${h.hour}`] = h.avgRange; });
  return v;
}
