import { useEffect, useMemo, useState } from 'react';
import { Rocket, AlertTriangle, Download } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const usd = (v) => (v == null ? '–' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const k = (n) => `$${Number(n).toLocaleString('en-US')}`;
// Gold: $100 per 1.00 move per MT5 lot, $100 per GC contract, $10 per MGC micro
const lotsFor = (risk, stop, perPoint) => Math.floor((risk / (stop * perPoint)) * 100) / 100;

const Field = ({ label, children }) => (
  <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>
);
const Pick = ({ value, onChange, options, testid, placeholder }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger data-testid={testid}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}</SelectContent>
  </Select>
);
const Row = ({ k: key, v, hint }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-border first:border-0">
    <span className="text-muted-foreground text-sm">{key}</span>
    <span className="text-sm font-medium tabular-nums text-right">{v}{hint && <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>}</span>
  </div>
);

// "Add / Configure Account Profile": firm, model, size and platform pick a pre-calibrated profile from the presets;
// Deploy creates the account (or applies the profile to the chosen one) and writes its MT5 EA settings file
export default function ProfileConfigurator({ open, onClose, presets, account, accounts = [], onDeployed }) {
  const firms = Object.keys(presets?.firms || {});
  const [firm, setFirm] = useState('Lucid Trading');
  const [model, setModel] = useState('LucidFlex');
  const [size, setSize] = useState('25000');
  const [platform, setPlatform] = useState('Tradovate');
  const [target, setTarget] = useState('new');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!open) return;
    setErr(''); setDone(null);
    const p = account?.preset_id && presets?.presets.find((x) => x.id === account.preset_id);
    setTarget(account ? account.id : 'new');
    if (p) { setFirm(p.firm); setModel(p.model); setSize(String(p.size)); }
    if (account?.platform) setPlatform(account.platform);
  }, [open, account?.id]);

  const models = presets?.firms[firm]?.models || [];
  useEffect(() => { if (models.length && !models.includes(model)) setModel(models[0]); }, [firm]);
  const preset = useMemo(() => presets?.presets.find((p) => p.firm === firm && p.model === model && p.size === Number(size)) || null, [presets, firm, model, size]);
  const has = (s) => presets?.presets.some((p) => p.firm === firm && p.model === model && p.size === s);
  const platforms = (presets?.platforms || []).map((p) => ({ value: p.id, label: p.label + (p.unsupported ? ' (not yet)' : ''), disabled: !!p.unsupported }));
  const consistency = preset ? (preset.stage === 'funded' ? preset.consistency_funded : preset.consistency_eval) : null;
  const exampleStop = 3;

  const deploy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/fleet/deploy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset_id: preset.id, platform, ...(target !== 'new' ? { account_id: target } : {}) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Deploy failed');
      setDone(j);
      onDeployed?.(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="profile-configurator">
        <SheetHeader>
          <SheetTitle>Add / Configure Account Profile</SheetTitle>
          <SheetDescription>Pick the firm, model, size and platform; the matching profile sets the risk, daily limits, kill switch and payout buffer.</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-3">
          <Field label="Proprietary firm"><Pick value={firm} onChange={setFirm} testid="cfg-firm" options={firms.map((f) => ({ value: f, label: f }))} /></Field>
          <Field label="Account model"><Pick value={model} onChange={setModel} testid="cfg-model" options={models.map((m) => ({ value: m, label: m === 'LucidFlex' ? 'LucidFlex (Recommended 🏆)' : m }))} /></Field>
          <Field label="Account size"><Pick value={size} onChange={setSize} testid="cfg-size" options={(presets?.sizes || []).map((s) => ({ value: String(s), label: `${k(s)}${has(s) ? '' : ' (no profile)'}`, disabled: !has(s) }))} /></Field>
          <Field label="Execution platform"><Pick value={platform} onChange={setPlatform} testid="cfg-platform" options={platforms} /></Field>
          <Field label="Apply to">
            <Pick value={target} onChange={setTarget} testid="cfg-target" options={[{ value: 'new', label: 'A new account' }, ...accounts.map((a) => ({ value: a.id, label: a.account }))]} />
          </Field>
        </div>

        {!preset ? (
          <p className="mt-5 text-sm text-muted-foreground" data-testid="cfg-none">No profile for {firm} {model} {k(size)} yet: its numbers weren't in the presets. Pick another size or model.</p>
        ) : (
          <div className="mt-5 rounded-xl border border-border bg-card p-4 animate-in fade-in-0 zoom-in-95 duration-pop ease-pop calm:animate-none" data-testid="cfg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">{preset.firm} · {preset.model} · {k(preset.size)}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{preset.stage}</span>
            </div>
            <Row k="Risk per trade" v={`${usd(preset.risk_usd)} (${preset.risk_pct}%)`} hint={`${exampleStop}-pt stop: ${lotsFor(preset.risk_usd, exampleStop, 100)} MT5 lots · ${lotsFor(preset.risk_usd, exampleStop, 10).toFixed(0)} MGC micros`} />
            <Row k="Take profit" v={`1:${preset.tp_ratio.toFixed(1)} (+${usd(preset.risk_usd * preset.tp_ratio)})`} />
            <Row k="Daily profit ceiling" v={usd(preset.daily_profit_cap)} hint={consistency ? `consistency cap ${consistency}%` : 'no consistency rule'} />
            <Row k="Daily stop floor" v={usd(preset.daily_loss_floor)} hint={preset.broker_daily_limit ? `firm's daily limit ${usd(-preset.broker_daily_limit)}` : 'no firm daily limit'} />
            <Row k="Kill switch" v={`${preset.kill_switch_losses} losing trades a day`} />
            <Row k="Stop floor / ATR" v={`${preset.stop_floor_pts} pts · ATR(${preset.atr_period}) +${preset.atr_stop_pad}`} />
            <Row k="Profit target / max drawdown" v={`${preset.profit_target ? usd(preset.profit_target) : 'none'} / ${usd(preset.max_drawdown)}`} hint={preset.drawdown_type === 'eod_trailing' ? 'end-of-day trailing' : 'static'} />
            <Row k="Payout buffer kept" v={usd(preset.buffer_usd ?? preset.size * 0.025)} hint={preset.payout_days ? `${preset.payout_days}-day payout cycle` : ''} />
            {preset.max_contracts && <Row k="Max contracts" v={preset.max_contracts} />}
          </div>
        )}

        <div className="mt-4 flex gap-2 rounded-lg border border-chart-4/40 bg-chart-4/10 p-3 text-xs" data-testid="cfg-warning">
          <AlertTriangle className="w-4 h-4 shrink-0 text-chart-4" />
          <span>The exhaustion engine lost money in QuantBot's test on 2004-2026 gold (profit factor 0.87 after spread). These limits cap the damage per day; they can't make a losing strategy pass. Run it on a demo first.</span>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        {done && (
          <div className="mt-3 rounded-lg bg-chart-2/10 border border-chart-2/30 p-3 text-sm space-y-1.5" data-testid="cfg-done">
            <p><b>{done.account.label}</b> is set to {done.preset.id}.</p>
            {platform === 'MT5' && <a className="inline-flex items-center gap-1 text-primary underline" href={done.set_file}><Download className="w-3.5 h-3.5" />EA settings (.set) for QB_ExhaustionEngine</a>}
            {platform !== 'MT5' && <p className="text-xs text-muted-foreground">In TradingView, set the Exhaustion Engine's inputs to these numbers and point its alert at your QuantBot signal address.</p>}
          </div>
        )}
        <Button className="mt-4 w-full" disabled={!preset || busy} onClick={deploy} data-testid="cfg-deploy"><Rocket className="w-4 h-4 mr-1.5" />{busy ? 'Deploying…' : 'Deploy to VPS Fleet'}</Button>
      </SheetContent>
    </Sheet>
  );
}
