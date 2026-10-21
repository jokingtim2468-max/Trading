// Deploy readiness: one honest PASS / FAIL on whether a script is safe to put on a real account, from everything we
// already measure (walk-forward out-of-sample, drawdown, trade count, consistency, Monte Carlo). A backtest looking
// good is not a reason to trade it — this is the gate between the workshop and a live prop account. Pure, unit-tested.
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);

// results: the per-market array backtestScript returns ({ metrics, robust }). mc: optional Monte Carlo { score }.
// maxDDLimitPct: the firm/account max-drawdown rule, so the check is against what would actually bust the account.
export function deployReadiness({ results = [], mc = null, maxDDLimitPct = 20 } = {}) {
  const ok = results.filter((x) => x.metrics && Number.isFinite(x.metrics.profitFactor));
  const checks = [];
  const add = (name, ok_, severity, detail) => checks.push({ name, ok: ok_, severity, detail });

  if (!ok.length) {
    add('Has a backtest', false, 'fail', 'no usable backtest result');
    return { pass: false, grade: 'FAIL', score: 0, checks, reasons: ['no usable backtest result'] };
  }

  const avg = (f) => ok.reduce((a, x) => a + f(x.metrics), 0) / ok.length;
  const trades = ok.reduce((a, x) => a + (x.metrics.trades || 0), 0);
  const pf = avg((m) => Math.min(m.profitFactor, 5));
  const ddPct = avg((m) => m.maxDDPct || 0);
  const net = ok.reduce((a, x) => a + (x.metrics.net || 0), 0);
  const wf = ok.filter((x) => x.robust && x.robust.enough);
  const oosHolds = wf.length > 0 && wf.every((x) => x.robust.oosHolds);
  const consistency = wf.length ? Math.min(...wf.map((x) => x.robust.consistencyPct)) : null;

  // fail = do not deploy; warn = deploy only with caution
  add('Enough trades (30+)', trades >= 30, trades >= 30 ? (trades >= 100 ? 'ok' : 'warn') : 'fail', `${trades} trades${trades < 100 && trades >= 30 ? ' — thin, treat the stats as rough' : ''}`);
  add('Profitable (net > 0)', net > 0, net > 0 ? 'ok' : 'fail', `net ${Math.round(net)}`);
  add('Profit factor > 1.1', pf > 1.1, pf > 1.1 ? (pf >= 1.3 ? 'ok' : 'warn') : 'fail', `PF ${r1(pf)}`);
  add(`Drawdown within ${maxDDLimitPct}%`, ddPct < maxDDLimitPct, ddPct < maxDDLimitPct ? (ddPct < maxDDLimitPct * 0.6 ? 'ok' : 'warn') : 'fail', `max DD ${r1(ddPct)}%`);
  add('Holds out-of-sample', oosHolds, wf.length ? (oosHolds ? 'ok' : 'fail') : 'warn', wf.length ? (oosHolds ? 'edge repeats on unseen data' : 'fails out-of-sample — likely overfit') : 'not enough trades to judge');
  if (consistency != null) add('Consistent across windows', consistency >= 50, consistency >= 50 ? (consistency >= 75 ? 'ok' : 'warn') : 'fail', `profitable in ${consistency}% of time windows`);
  if (mc && Number.isFinite(mc.score)) add('Monte Carlo survival', mc.score >= 50, mc.score >= 50 ? (mc.score >= 70 ? 'ok' : 'warn') : 'fail', `score ${Math.round(mc.score)}/100`);

  const fails = checks.filter((c) => c.severity === 'fail');
  const warns = checks.filter((c) => c.severity === 'warn');
  const pass = fails.length === 0;
  const grade = fails.length ? 'FAIL' : warns.length ? 'CAUTION' : 'PASS';
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  const reasons = [...fails, ...warns].map((c) => `${c.name}: ${c.detail}`);
  return { pass, grade, score, checks, reasons };
}

export const readinessLine = (rd) => `Deploy readiness: ${rd.grade} (${rd.score}/100)${rd.reasons.length ? ` — ${rd.reasons.slice(0, 3).join('; ')}` : ''}`;
