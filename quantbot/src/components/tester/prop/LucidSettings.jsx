import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { LUCID_SIZES } from '@/lib/prop/lucidPro';

export default function LucidSettings({ s, set }) {
  return (
    <div className="flex flex-wrap items-end gap-4 bg-card border border-border rounded-xl p-4">
      <div>
        <h3 className="text-sm font-semibold">LucidPro account</h3>
        <p className="text-xs text-muted-foreground">Evaluation, then funded with payouts</p>
      </div>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">Account size</span>
        <Select value={String(s.size)} onValueChange={(v) => set('size', Number(v))}>
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LUCID_SIZES.map((v) => <SelectItem key={v} value={String(v)}>${v / 1000}K</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 h-9">
        <Switch checked={s.dllOn} onCheckedChange={(v) => set('dllOn', v)} />
        <span className="text-sm">Daily loss limit</span>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">Lots per 1 mini contract</span>
        <Input type="number" min={0.01} step={0.1} value={s.lotsPerMini} onChange={(e) => set('lotsPerMini', e.target.value)} className="w-32 h-9" />
      </label>
    </div>
  );
}