import { useState } from 'react';
import { Eye, EyeOff, LineChart, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { POP } from '@/lib/clickOrigin';
import { runIndicator, isMql5, UnsupportedPine } from '@/lib/indicators/pine';

// Ready-made ones, one click to add
const BUILT_IN = [
  ['EMA 20 / 50', 'indicator("EMA 20 / 50", overlay=true)\nplot(ta.ema(close, 20), "EMA 20", color=color.orange)\nplot(ta.ema(close, 50), "EMA 50", color=color.blue)'],
  ['VWAP', 'indicator("VWAP", overlay=true)\nplot(ta.vwap(hlc3), "VWAP", color=color.purple)'],
  ['Bollinger Bands', 'indicator("Bollinger Bands", overlay=true)\n[m, u, l] = ta.bb(close, 20, 2)\nplot(m, "Basis", color=color.orange)\nplot(u, "Upper", color=color.blue)\nplot(l, "Lower", color=color.blue)'],
  ['RSI 14', 'indicator("RSI 14", overlay=false)\nplot(ta.rsi(close, 14), "RSI", color=color.purple)\nhline(70)\nhline(30)'],
  ['MACD', 'indicator("MACD", overlay=false)\n[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m, "MACD", color=color.blue)\nplot(s, "Signal", color=color.orange)\nplot(h, "Histogram", color=color.gray)'],
  ['ATR 14', 'indicator("ATR 14", overlay=false)\nplot(ta.atr(14), "ATR", color=color.red)'],
];

// Pine or MQL5 source -> { name, lang, code, pine }. Pine the chart can run is kept as is; MQL5 and Pine using loops,
// var or functions are rewritten into simple Pine by the model first. onBusy(text) reports a rewrite in progress.
export async function compileIndicator(source, bars, onBusy = () => {}) {
  const src = String(source || '').trim();
  let pine = src, why = isMql5(src) ? 'it is MQL5' : '';
  if (!why && bars) {
    try { runIndicator(src, bars); } catch (e) { if (e instanceof UnsupportedPine) why = e.message; else throw e; }
  }
  if (why) {
    onBusy(isMql5(src) ? 'Rewriting the MQL5 indicator for the chart…' : `Rewriting for the chart (${why})…`);
    const r = await fetch('/api/terminal/indicator', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: src, why }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The rewrite failed');
    pine = j.pine;
  }
  const name = bars ? runIndicator(pine, bars).title : (pine.match(/indicator\s*\(\s*["']([^"']+)/)?.[1] || 'Indicator');
  return { name, lang: isMql5(src) ? 'MQL5' : 'Pine', code: src, pine };
}

// Indicators on the chart: paste Pine Script or MQL5. Pine runs directly; MQL5 (and Pine using loops, var or
// functions) is rewritten into simple Pine by the local / chosen model first, then runs the same way.
export default function IndicatorsPanel({ list, onChange, bars, errors }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const add = async (source, preset) => {
    if (!String(source || '').trim()) return;
    setMsg('');
    try {
      const ind = await compileIndicator(source, bars, setBusy);
      onChange([...list, { id: `I-${Date.now()}`, ...ind, on: true }]);
    } catch (e) { setMsg(`Couldn't add it: ${e.message}`); return; } finally { setBusy(''); }
    if (!preset) setCode('');
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="h-8 px-2.5 rounded-md inline-flex items-center gap-1.5 hover:bg-[#2a2e39]" data-testid="open-indicators">
          <LineChart className="w-4 h-4" />Indicators{list.length ? ` (${list.filter((x) => x.on).length})` : ''}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`${POP} w-[420px] rounded-[14px] border-[#363a45] bg-[#1e222d]/95 backdrop-blur-xl p-3.5 text-[13px] text-[#d1d4dc] shadow-[0_18px_48px_rgba(0,0,0,.55)]`} data-testid="indicators-panel">
        {list.length > 0 && (
          <div className="space-y-1 mb-3">
            {list.map((x) => (
              <div key={x.id} className="flex items-center gap-2 h-8 px-2 rounded-md bg-[#131722]" data-testid="indicator-row">
                <span className={`truncate flex-1 ${x.on ? '' : 'text-[#787b86]'}`}>{x.name}</span>
                {errors[x.id] && <span className="text-[11px] text-[#f23645] truncate max-w-[140px]" title={errors[x.id]}>{errors[x.id]}</span>}
                <span className="text-[10px] px-1.5 rounded bg-[#2a2e39] text-[#9598a1]">{x.lang}</span>
                <button type="button" aria-label={x.on ? 'Hide' : 'Show'} onClick={() => onChange(list.map((y) => (y.id === x.id ? { ...y, on: !y.on } : y)))} className="w-6 h-6 rounded flex items-center justify-center hover:bg-[#2a2e39]">{x.on ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
                <button type="button" aria-label="Remove" onClick={() => onChange(list.filter((y) => y.id !== x.id))} className="w-6 h-6 rounded flex items-center justify-center hover:bg-[#f23645] hover:text-white" data-testid="indicator-remove"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-[#787b86] mb-1.5">Quick add</div>
        <div className="flex flex-wrap gap-1 mb-3">
          {BUILT_IN.map(([n, c]) => <button key={n} type="button" onClick={() => add(c, true)} className="h-7 px-2 rounded-md text-xs bg-[#131722] hover:bg-[#2a2e39]" data-testid="indicator-builtin">{n}</button>)}
        </div>
        <div className="text-xs text-[#787b86] mb-1.5">Paste a Pine Script or MQL5 indicator</div>
        <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={7} spellCheck={false} placeholder={'//@version=5\nindicator("My MA", overlay=true)\nplot(ta.sma(close, 20))'}
          className="w-full rounded-md bg-[#131722] border border-[#363a45] p-2 font-mono text-[11px] outline-none focus:border-[#2962ff]" data-testid="indicator-code" />
        <div className="flex items-center gap-2 mt-2">
          <button type="button" disabled={!code.trim() || !!busy} onClick={() => add(code)} className="h-8 px-3 rounded-md bg-[#2962ff] text-white disabled:opacity-40" data-testid="indicator-add">Add to chart</button>
          <span className="text-[11px] text-[#9598a1]" data-testid="indicator-msg">{busy || msg}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
