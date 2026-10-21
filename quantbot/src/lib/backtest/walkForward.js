// Walk-forward / out-of-sample robustness: a strategy that only makes money in one stretch of history is overfit and
// will not repeat live. This splits a run's trades by time into consecutive windows and into an in-sample / out-of-
// sample split, so you can see whether the edge holds across the whole period or just got lucky once. Pure, unit-tested.
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function agg(trades) {
  let net = 0, gw = 0, gl = 0;
  for (const t of trades) { net += t.pnl; if (t.pnl > 0) gw += t.pnl; else gl += -t.pnl; }
  return { net: round(net), trades: trades.length, pf: round(gl ? gw / gl : (gw ? 3 : 0)) };
}

// trades: the sim's closed trades ({ exitTime, pnl }). windows: how many consecutive time windows to split into.
// splitPct: the in-sample / out-of-sample boundary (0.7 = optimise-era is the first 70% of time, prove on the last 30%).
export function walkForward(trades, { windows = 4, splitPct = 0.7 } = {}) {
  const ts = (trades || []).filter((t) => Number.isFinite(t.exitTime) && Number.isFinite(t.pnl)).sort((a, b) => a.exitTime - b.exitTime);
  // Too few trades to judge consistency honestly — say so rather than pretend.
  if (ts.length < windows * 5) return { enough: false, totalWindows: windows, windows: [], profitableWindows: 0, consistencyPct: 0, is: agg(ts), oos: { net: 0, trades: 0, pf: 0 }, oosHolds: false, score: 0 };

  const t0 = ts[0].exitTime, t1 = ts[ts.length - 1].exitTime, span = (t1 - t0) || 1;
  const buckets = Array.from({ length: windows }, () => []);
  for (const t of ts) buckets[Math.min(windows - 1, Math.floor(((t.exitTime - t0) / span) * windows))].push(t);
  const win = buckets.map((b, k) => ({ from: day(t0 + (span * k) / windows), to: day(t0 + (span * (k + 1)) / windows), ...agg(b) }));

  const judged = win.filter((w) => w.trades > 0);
  const profitable = judged.filter((w) => w.net > 0).length;
  const consistencyPct = round((profitable / (judged.length || 1)) * 100, 0);

  const splitT = t0 + span * splitPct;
  const is = agg(ts.filter((t) => t.exitTime < splitT));
  const oos = agg(ts.filter((t) => t.exitTime >= splitT));
  const oosHolds = oos.trades >= 5 && oos.net > 0 && oos.pf >= 1;

  // 0..1: mostly "profitable across windows", with a real out-of-sample bonus. This is what keep-best should chase.
  const score = round(0.6 * (profitable / (judged.length || 1)) + 0.4 * (oosHolds ? 1 : oos.net > 0 ? 0.5 : 0), 3);
  return { enough: true, totalWindows: windows, windows: win, profitableWindows: profitable, consistencyPct, is, oos, oosHolds, score };
}

// One-line verdict for a report or a UI pill
export function robustnessVerdict(wf) {
  if (!wf || !wf.enough) return 'not enough trades to judge robustness';
  if (wf.oosHolds && wf.consistencyPct >= 75) return `robust: profitable in ${wf.profitableWindows}/${wf.totalWindows} windows, holds out-of-sample`;
  if (wf.oosHolds) return `holds out-of-sample, but uneven (${wf.profitableWindows}/${wf.totalWindows} windows profitable)`;
  if (wf.oos.net > 0) return `weak out-of-sample (OOS net ${wf.oos.net}, PF ${wf.oos.pf}) — likely overfit`;
  return `overfit: loses out-of-sample (OOS net ${wf.oos.net}) despite the full-period result`;
}
