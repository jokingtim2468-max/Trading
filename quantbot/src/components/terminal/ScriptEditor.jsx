import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { compileIndicator } from '@/components/terminal/IndicatorsPanel';

const BLANK = '//@version=5\nindicator("My script", overlay=true)\nlen = input.int(20, "Length")\nplot(ta.ema(close, len), "EMA", color=color.orange)\n';

// Pine Editor tab under the chart (like TradingView's): write or paste Pine Script or MQL5, then "Add to chart" or
// "Update on chart" for the script picked on the left
export default function ScriptEditor({ list, onChange, bars }) {
  const [pick, setPick] = useState(null); // indicator id, or null for a new script
  const [code, setCode] = useState(BLANK);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ ok: true, text: '' });
  const nums = useRef(null);
  const cur = list.find((x) => x.id === pick);
  useEffect(() => { if (pick && !cur) { setPick(null); setCode(BLANK); } }, [pick, cur]);

  const open = (x) => { setPick(x?.id || null); setCode(x ? x.code : BLANK); setMsg({ ok: true, text: '' }); };
  const save = async () => {
    setMsg({ ok: true, text: '' });
    try {
      const ind = await compileIndicator(code, bars, setBusy);
      if (cur) onChange(list.map((x) => (x.id === cur.id ? { ...x, ...ind, on: true } : x)));
      else { const id = `I-${Date.now()}`; onChange([...list, { id, ...ind, on: true }]); setPick(id); }
      setMsg({ ok: true, text: `${ind.name} ${cur ? 'updated' : 'added'} on the chart${ind.pine !== ind.code ? ' (rewritten to Pine for the chart)' : ''}` });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  };
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.target, a = t.selectionStart;
      setCode(code.slice(0, a) + '    ' + code.slice(t.selectionEnd));
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 4; });
    }
  };
  const lines = code.split('\n').length;

  return (
    <div className="flex h-full min-h-0" data-testid="script-editor">
      <div className="w-44 shrink-0 border-r border-[#2a2e39] overflow-y-auto p-1.5 space-y-0.5">
        <button type="button" onClick={() => open(null)} className={`w-full h-7 px-2 rounded-md text-left text-xs inline-flex items-center gap-1.5 ${!pick ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid="editor-new"><Plus className="w-3.5 h-3.5" />New script</button>
        {list.map((x) => (
          <button key={x.id} type="button" onClick={() => open(x)} className={`w-full h-7 px-2 rounded-md text-left text-xs truncate ${pick === x.id ? 'bg-[#2a2e39] text-white' : 'hover:bg-[#2a2e39]'}`} data-testid="editor-script">
            {x.name} <span className="text-[#5d606b]">{x.lang}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 flex overflow-hidden bg-[#131722]">
          <pre ref={nums} className="shrink-0 w-10 py-2 pr-2 text-right font-mono text-[11px] leading-[18px] text-[#5d606b] select-none overflow-hidden">{Array.from({ length: lines }, (_, k) => k + 1).join('\n')}</pre>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onKey} spellCheck={false} wrap="off"
            onScroll={(e) => { if (nums.current) nums.current.scrollTop = e.target.scrollTop; }}
            className="flex-1 py-2 px-2 bg-transparent font-mono text-[12px] leading-[18px] text-[#d1d4dc] outline-none resize-none" data-testid="editor-code" aria-label="Script code" />
        </div>
        <div className="h-9 shrink-0 flex items-center gap-3 px-2 border-t border-[#2a2e39]">
          <button type="button" disabled={!!busy || !code.trim()} onClick={save} className="h-7 px-3 rounded-md bg-[#2962ff] text-white text-xs disabled:opacity-40" data-testid="editor-save">{cur ? 'Update on chart' : 'Add to chart'}</button>
          <span className="text-[11px] text-[#5d606b]">Pine Script or MQL5 · Ctrl+S</span>
          <span className={`text-[11px] truncate ${busy ? 'text-[#9598a1]' : msg.ok ? 'text-[#089981]' : 'text-[#f23645]'}`} data-testid="editor-msg">{busy || msg.text}</span>
        </div>
      </div>
    </div>
  );
}
