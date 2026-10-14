import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { daysAgo, today } from '@/lib/backtest/data';

// What to fetch ahead of time. Tests download what they need anyway; this just saves waiting later.
const PLANS = [
  { id: 'hourly', label: 'H1, H4 and D1, full history', parts: (m) => [{ tf: 'D1', from: m.dayStart }, { tf: 'H1', from: m.hourStart }] },
  { id: 'minute1', label: 'M1 to M30, last 12 months', parts: () => [{ tf: 'M15', from: daysAgo(365) }] },
  { id: 'minute5', label: 'M1 to M30, last 5 years', parts: () => [{ tf: 'M15', from: daysAgo(5 * 365) }] },
  { id: 'minuteAll', label: 'M1 to M30, full history', parts: (m) => [{ tf: 'M15', from: m.minuteStart }] },
];

const stored = (s) => (s.files ? `${s.first} to ${s.last} (${s.mb} MB)` : 'none yet');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function MarketRow({ market, onDone }) {
  const [plan, setPlan] = useState('hourly');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  const download = async () => {
    setError('');
    try {
      for (const part of PLANS.find((p) => p.id === plan).parts(market)) {
        const res = await fetch('/api/market/prepare', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: market.symbol, tf: part.tf, from: part.from, to: today() }),
        });
        let j = await res.json();
        if (!res.ok) throw new Error(j.error);
        while (j.state === 'running') { setJob(j); await wait(500); j = await (await fetch(`/api/market/jobs/${j.id}`)).json(); }
        if (j.state === 'error') throw new Error(j.error);
      }
    } catch (e) {
      setError(e.message);
    }
    setJob(null);
    onDone();
  };

  return (
    <div className="py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{market.symbol}</span>
        <span className="text-xs text-muted-foreground">{market.name} · daily from {market.dayStart.slice(0, 4)}, intraday from {market.minuteStart.slice(0, 4)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Saved: minute {stored(market.stored.minute)} · hourly {stored(market.stored.hour)} · daily {stored(market.stored.day)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger className="h-9 w-64" aria-label={`${market.symbol} download`}><SelectValue /></SelectTrigger>
          <SelectContent>{PLANS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={download} disabled={!!job}><Download className="w-4 h-4 mr-1" />Download</Button>
      </div>
      {job && (
        <div className="space-y-1">
          <Progress value={job.total ? (job.done / job.total) * 100 : 0} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">{job.done} of {job.total || '?'} files</p>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// XAUUSD and US100 from Dukascopy, in broker time (UTC+2 / UTC+3 like MT5)
export default function BuiltInMarketsCard() {
  const [markets, setMarkets] = useState(null);
  const reload = () => fetch('/api/market/info').then((r) => r.json()).then((i) => setMarkets(i.markets));
  useEffect(() => { reload(); }, []);

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <h3 className="font-medium">Built-in markets</h3>
      <p className="text-xs text-muted-foreground">
        Free Dukascopy history, saved on this PC. Tests download what they need automatically; download ahead here to skip the wait.
        Minute history is large (about 1 MB per month per market).
      </p>
      {!markets ? <p className="text-sm text-muted-foreground mt-3">Loading…</p> : (
        <div className="divide-y divide-border">{markets.map((m) => <MarketRow key={m.symbol} market={m} onDone={reload} />)}</div>
      )}
    </div>
  );
}
