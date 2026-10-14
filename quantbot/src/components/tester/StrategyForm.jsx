import { Textarea } from '@/components/ui/textarea';

export default function StrategyForm({ strategy, onStrategy, rules, onRules }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Strategy</label>
        <Textarea
          value={strategy} onChange={(e) => onStrategy(e.target.value)}
          placeholder="Paste your strategy here: plain-English rules, MQL4/MQL5, Pine Script, Python, or any other code."
          className="min-h-[260px] font-mono text-xs bg-card"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Rules to test against</label>
        <Textarea
          value={rules} onChange={(e) => onRules(e.target.value)}
          placeholder={'One rule per line, e.g.\nMax risk 1% per trade\nEvery trade has a stop loss\nNo martingale or grid\nMax daily loss 4%\nOnly trade London and NY sessions'}
          className="min-h-[140px] text-sm bg-card"
        />
      </div>
    </div>
  );
}