import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { planScaling } from '@/lib/scalingPlan';

const $ = (v) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const SIZES = [[10000, 99], [25000, 289], [50000, 399], [100000, 499], [200000, 1249]];

function Num({ label, value, onChange, step = 0.01, hint, testid }) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid}
        className="w-full h-9 rounded-md border border-border bg-background px-2 tabular-nums" />
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

// FTMO US (OANDA) path from your strategy's numbers: challenges bought, passed, funded, payouts and the scaling plan,
// simulated 400 times. The daily return and swing should come from a backtest on unseen data, not a hope.
export default function ScalingPlanner() {
  const [mean, setMean] = useState(0.05);
  const [sd, setSd] = useState(0.8);
  const [sizeI, setSizeI] = useState(4);
  const [accounts, setAccounts] = useState(2);
  const [months, setMonths] = useState(36);
  const [size, fee] = SIZES[sizeI];
  const cap = 400000;
  const n = Math.max(1, Math.min(accounts, Math.floor(cap / size)));
  const r = useMemo(() => planScaling({ mean, sd, size, fee, accounts: n, months, runs: 400 }), [mean, sd, size, fee, n, months]);
  const show = r.months.filter((m) => m.month <= 6 || m.month % 3 === 0);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 h-14 glass-bar flex items-center gap-3 px-4">
        <Link to="/" className="p-2 rounded-md hover:bg-accent"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="font-heading text-lg font-semibold">Scaling planner</h1>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">FTMO US (OANDA): challenges to $2M, simulated from your strategy's numbers</span>
      </header>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
        <div className="bg-card border border-border rounded-2xl p-5 grid sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="planner-inputs">
          <Num label="Average day (% of account)" value={mean} onChange={setMean} hint="From a test on unseen data" testid="plan-mean" />
          <Num label="Daily swing (% SD)" value={sd} onChange={setSd} step={0.05} hint="How much a day varies" testid="plan-sd" />
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Account size</span>
            <select value={sizeI} onChange={(e) => setSizeI(Number(e.target.value))} className="w-full h-9 rounded-md border border-border bg-background px-2">
              {SIZES.map(([s, f], i) => <option key={s} value={i}>${(s / 1000).toLocaleString()}K · fee ${f}</option>)}
            </select>
          </label>
          <Num label="Accounts at once" value={accounts} onChange={setAccounts} step={1} hint={`Cap $400K: max ${Math.floor(cap / size)}`} />
          <Num label="Months" value={months} onChange={setMonths} step={6} />
        </div>
        <div className="grid sm:grid-cols-4 gap-3" data-testid="planner-summary">
          {[['Challenge pass rate', `${(100 * r.passRate).toFixed(0)}%`], ['Median months to funded', Number.isFinite(r.medianMonthsToFunded) ? r.medianMonthsToFunded.toFixed(1) : 'never'],
            [`Median net after ${months} mo`, $(r.medianNet)], ['Bad case / good case (10% / 90%)', `${$(r.p10Net)} / ${$(r.p90Net)}`]].map(([k, v]) => (
            <div key={k} className="bg-card border border-border rounded-xl p-3"><div className="text-[11px] text-muted-foreground">{k}</div><div className="font-heading text-xl">{v}</div></div>
          ))}
        </div>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm tabular-nums" data-testid="planner-table">
            <thead className="text-xs text-muted-foreground"><tr className="border-b border-border">{['Month', 'Funded capital', 'Payouts so far', 'Fees so far', 'Net'].map((h) => <th key={h} className="text-left font-normal px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>{show.map((m) => (
              <tr key={m.month} className="border-b border-border/50"><td className="px-3 py-1.5">{m.month}</td><td className="px-3">{$(m.funded)}</td><td className="px-3">{$(m.payouts)}</td><td className="px-3">{$(m.fees)}</td>
                <td className={`px-3 ${m.net >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>{$(m.net)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Medians of 400 simulated paths. Rules: 2-Step 10% then 5%, 5% daily loss, 10% max loss, 4 trading days, fee refunded with the first reward, rewards every 14 trading days at 80%, +25% every 4 months up to $2M (FTMO also asks for 10% profit over those 4 months and 2 rewards, not modelled). Daily returns are random around your average, so a strategy with no edge (average 0) still shows lucky passes: that is luck, not income.</p>
      </div>
    </div>
  );
}
