import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FlaskConical, Loader2, Copy, Check } from 'lucide-react';
import { loadDatasets, loadTestBars, asTested, daysAgo, today } from '@/lib/backtest/data';
import { quantFeatures, featureVector } from '@/lib/quant/features';
import { Button } from '@/components/ui/button';
import ChartLoader from '@/components/quant/ChartLoader';
import { useToast } from '@/components/ui/use-toast';

const TFS = ['M5', 'M15', 'M30', 'H1', 'H4'];
const RANGES = [{ label: '3 months', days: 90 }, { label: '6 months', days: 180 }, { label: '1 year', days: 365 }, { label: '3 years', days: 1095 }];
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

// A row of bars (one per category) scaled to the largest, with the value on the right
function Bars({ data, label, value, color = 'bg-primary', fmt = (v) => v }) {
  const max = Math.max(...data.map((d) => Math.abs(value(d))), 1e-9);
  return (
    <ol className="space-y-1">
      {data.map((d, i) => {
        const v = value(d); const w = (Math.abs(v) / max) * 100;
        return (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{label(d)}</span>
            <span className="flex-1 h-3 rounded bg-border/40 overflow-hidden"><span className={`block h-full ${v < 0 ? 'bg-destructive' : color}`} style={{ width: `${w}%` }} /></span>
            <span className="w-16 shrink-0 text-right tabular-nums">{fmt(v)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// A histogram of return buckets (centre = no change), its tallest bar scaled to full height
function Histogram({ hist }) {
  const max = Math.max(...hist.map((b) => b.count), 1);
  return (
    <div className="flex items-end gap-0.5 h-28" data-testid="lab-hist">
      {hist.map((b, i) => (
        <div key={i} title={`${b.from}% to ${b.to}%: ${b.count}`} className="flex-1 rounded-t bg-primary/70 hover:bg-primary" style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 2 : 0 }} />
      ))}
    </div>
  );
}

// ATR regime as a filled line (volatility over the period)
function Spark({ points }) {
  if (!points.length) return null;
  const xs = points.map((_, i) => (i / (points.length - 1)) * 100);
  const vs = points.map((p) => p.v); const lo = Math.min(...vs), hi = Math.max(...vs) || 1;
  const y = (v) => 100 - ((v - lo) / (hi - lo || 1)) * 100;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-24" data-testid="lab-atr">
      <path d={`${d} L100,100 L0,100 Z`} fill="hsl(var(--primary))" opacity="0.12" />
      <path d={d} fill="none" stroke="hsl(var(--primary))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Card({ title, hint, children }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-4 shadow-raised">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-[11px] text-muted-foreground mb-2">{hint}</p>}
      {children}
    </section>
  );
}

// Market Lab: the quant-data engine made visible. Pick a market + timeframe and it computes and charts the feature
// pack (volatility, return distribution, autocorrelation, session structure) the AI and an ML filter use.
export default function MarketLab() {
  const { toast } = useToast();
  const [datasets, setDatasets] = useState([]);
  const [symbol, setSymbol] = useState('');
  const [tf, setTf] = useState('M5');
  const [days, setDays] = useState(180);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadDatasets().then((d) => { setDatasets(d); setSymbol((s) => s || d[0]?.symbol || ''); }).catch(() => {}); }, []);

  const analyze = async () => {
    const ds = datasets.find((d) => d.symbol === symbol);
    if (!ds) return;
    setBusy(true); setErr(''); setF(null);
    try {
      setPhase(`Loading ${symbol} ${tf}…`);
      const { bars } = await loadTestBars(asTested(ds, tf), { tf, from: daysAgo(days), to: today() });
      setPhase('Computing features…');
      const feat = quantFeatures(bars);
      if (!feat) throw new Error('Not enough bars in that range — pick a longer range or a smaller timeframe.');
      setF(feat);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    setBusy(false); setPhase('');
  };

  const copyVector = () => {
    navigator.clipboard?.writeText(JSON.stringify({ symbol, tf, ...featureVector(f) }, null, 2));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
    toast({ title: 'Feature vector copied', description: 'The flat numeric row an ML model trains on.' });
  };

  const stat = (label, val) => (
    <div><div className="text-[11px] text-muted-foreground">{label}</div><div className="font-heading text-lg tabular-nums">{val}</div></div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <FlaskConical className="w-4 h-4 text-primary" />
        <h1 className="font-heading text-lg font-semibold">Market Lab</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">The quant profile of a market — the same features the AI and an ML filter read</span>
      </header>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 space-y-4">
        <div className="bg-card border border-border rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Market</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2" data-testid="lab-symbol">
              {datasets.map((d) => <option key={d.symbol} value={d.symbol}>{d.symbol} — {d.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Timeframe</span>
            <select value={tf} onChange={(e) => setTf(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2" data-testid="lab-tf">
              {TFS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Range</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border border-border bg-background px-2" data-testid="lab-range">
              {RANGES.map((rg) => <option key={rg.days} value={rg.days}>{rg.label}</option>)}
            </select>
          </label>
          <Button onClick={analyze} disabled={busy || !symbol} data-testid="lab-run">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-1" />}Analyze</Button>
          {phase && <span className="text-xs text-muted-foreground">{phase}</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>

        {busy && !f && <div className="flex justify-center py-16"><ChartLoader className="w-20 h-12" /></div>}

        {f && (
          <div className="space-y-4" data-testid="lab-results">
            <Card title={`${symbol} · ${tf} · ${f.meta.from} → ${f.meta.to}`} hint={`${f.meta.bars.toLocaleString()} candles`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {stat('Period return', pct(f.meta.periodReturnPct))}
                {stat('Up bars', `${f.returns.upRatePct}%`)}
                {stat('Median bar range', f.volatility.barTR.median)}
                {stat('95th pct range', f.volatility.barTR.p95)}
              </div>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card title="Volatility by hour" hint="Average candle range per server hour (New York + 7h). The busy hours to trade, the dead hours to avoid.">
                <Bars data={f.volatility.byHour} label={(d) => `${String(d.hour).padStart(2, '0')}:00`} value={(d) => d.avgRange} />
              </Card>
              <Card title="By session" hint="Where the movement is.">
                <Bars data={f.volatility.bySession} label={(d) => d.name} value={(d) => d.avgRange} />
                <h3 className="text-xs font-semibold mt-4 mb-1">By weekday</h3>
                <Bars data={f.volatility.byWeekday.filter((d) => d.n)} label={(d) => d.day} value={(d) => d.avgRange} />
              </Card>
              <Card title="Return distribution" hint={`Per-bar % returns. Mean ${f.returns.meanPct}%, std ${f.returns.stdPct}%, skew ${f.returns.skew}, kurtosis ${f.returns.kurtosis} (fat tails = big outlier moves).`}>
                <Histogram hist={f.returns.hist} />
              </Card>
              <Card title="Volatility regime (ATR)" hint="How choppy vs calm the market has been across the range.">
                <Spark points={f.atr} />
              </Card>
              <Card title="Momentum & autocorrelation" hint="Does a move continue or reverse? Positive autocorrelation = trending; negative = mean-reverting.">
                <Bars data={f.autocorr} label={(d) => `lag ${d.lag}`} value={(d) => d.value} fmt={(v) => v} />
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div>P(up after up): <b className="tabular-nums">{f.structure.momentumBiasPct}%</b></div>
                  <div>Base up rate: <b className="tabular-nums">{f.structure.baseUpRatePct}%</b></div>
                  <div>Breakout rate: <b className="tabular-nums">{f.structure.breakoutRatePct}%</b></div>
                  <div>Gaps: <b className="tabular-nums">{f.structure.gapRatePct}%</b> (median {f.structure.medianGap})</div>
                  <div>Longest up run: <b className="tabular-nums">{f.structure.longestUpRun}</b></div>
                  <div>Longest down run: <b className="tabular-nums">{f.structure.longestDownRun}</b></div>
                </div>
              </Card>
              <Card title="For machine learning" hint="This market as one flat numeric row — the input an ML signal filter trains on. Build the filter on a bot that already has an edge; it sharpens a winner, it can't rescue a loser.">
                <Button size="sm" variant="outline" onClick={copyVector} data-testid="lab-vector">{copied ? <Check className="w-3.5 h-3.5 mr-1 text-chart-2" /> : <Copy className="w-3.5 h-3.5 mr-1" />}Copy feature vector</Button>
                <pre className="mt-2 text-[10px] text-muted-foreground max-h-28 overflow-auto bg-background/50 rounded p-2">{JSON.stringify(featureVector(f), null, 1)}</pre>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
