import { AnimatePresence, motion } from 'framer-motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { firmsForSize, presetOf } from '@/lib/backtest/propRules';
import { reducedMotion } from '@/lib/clickOrigin';

const k = (n) => `$${(n / 1000).toLocaleString('en-US')}K`;

// The account the test runs on: a size (default $10K) and optionally a prop firm + its account type, whose rules the
// result is judged against. Firms that don't offer the size slide off to the right of the screen; ones that do
// slide in.
export default function AccountPicker({ presets, value, onChange, allowAll = false }) {
  const sizes = presets?.sizes || [10000];
  const firms = firmsForSize(presets, value.size);
  const models = value.firm ? firms[value.firm] || [] : [];
  const preset = value.firm && value.model ? presetOf(presets, value.firm, value.model, value.size) : null;
  const slide = reducedMotion()
    ? { initial: false, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: -16 }, animate: { opacity: 1, x: 0 }, exit: { x: '110vw', opacity: 0.4, transition: { duration: 0.55, ease: [0.55, 0, 0.9, 0.4] } } };

  // A new size keeps the firm/type if they still exist at that size, else drops back to what's available
  const setSize = (size) => {
    const f = firmsForSize(presets, size);
    const firm = value.firm === 'all' ? 'all' : value.firm && f[value.firm] ? value.firm : null;
    const model = firm && firm !== 'all' ? (f[firm].includes(value.model) ? value.model : f[firm][0]) : null;
    onChange({ size, firm, model });
  };
  const setFirm = (firm) => onChange({ ...value, firm, model: firm && firm !== 'all' ? firms[firm][0] : null });
  const all = value.firm === 'all';
  const count = presets?.presets?.length || 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3" data-testid="account-picker">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 w-36">
          <span className="text-xs text-muted-foreground">Account size</span>
          <Select value={String(value.size)} onValueChange={(v) => setSize(Number(v))}>
            <SelectTrigger className="h-10" aria-label="Account size"><SelectValue /></SelectTrigger>
            <SelectContent>{sizes.map((s) => <SelectItem key={s} value={String(s)}>{k(s)}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <div className="space-y-1 flex-1 min-w-[240px]">
          <span className="text-xs text-muted-foreground">Prop firm rules</span>
          <div className="flex flex-wrap gap-2 relative" data-testid="firm-chips">
            <AnimatePresence mode="popLayout" initial={false}>
              {[null, ...(allowAll ? ['all'] : []), ...Object.keys(firms)].map((f) => (
                <motion.button key={f || 'none'} layout type="button" {...slide} onClick={() => setFirm(f)} data-firm={f || 'none'}
                  aria-pressed={value.firm === f}
                  className={`h-10 px-3 rounded-lg border text-sm whitespace-nowrap ${value.firm === f ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}>
                  {f === 'all' ? `All accounts (${count})` : f || 'No firm (plain account)'}
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {value.firm && !all && (
            <motion.label key="model" className="space-y-1 w-52" {...slide}>
              <span className="text-xs text-muted-foreground">{value.firm} account type</span>
              <Select value={value.model || ''} onValueChange={(m) => onChange({ ...value, model: m })}>
                <SelectTrigger className="h-10" aria-label="Account type"><SelectValue /></SelectTrigger>
                <SelectContent>{models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </motion.label>
          )}
        </AnimatePresence>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="account-rules">
        {all
          ? <>Testing every account the firms offer: {count} account types across {new Set(presets.presets.map((p) => p.size)).size} sizes, each run at its own balance. The result ranks them and names the best one; the main numbers are for the {k(value.size)} run.</>
          : preset
          ? <>Testing a {k(preset.size)} {preset.firm} {preset.model}{preset.stage === 'funded' ? ' (funded)' : ''}: {preset.profit_target ? `target $${preset.profit_target.toLocaleString()} · ` : ''}max loss ${preset.max_drawdown.toLocaleString()} ({preset.drawdown_type === 'eod_trailing' ? 'end-of-day trailing' : 'static'}){preset.broker_daily_limit ? ` · daily loss $${preset.broker_daily_limit.toLocaleString()}` : ''}{(preset.stage === 'funded' ? preset.consistency_funded : preset.consistency_eval) ? ` · ${preset.stage === 'funded' ? preset.consistency_funded : preset.consistency_eval}% consistency` : ''}. The result says whether it passes and when.</>
          : <>A plain {k(value.size)} account, no firm rules. {Object.keys(firms).length ? `${Object.keys(firms).length} firm${Object.keys(firms).length > 1 ? 's offer' : ' offers'} this size.` : 'No firm in the presets offers this size.'}</>}
      </p>
    </div>
  );
}
